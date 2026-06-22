import React, { useState, useRef } from 'react';
import { RefreshCw, Check, Waves, Droplets, Mountain } from 'lucide-react';
import { LAYER_DEFS, getLayerDimensions } from '@/lib/mapLayerStore';
import { rasterizeTiles } from './TileRasterizer';

const OSM_OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const HEIGHTMAP_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function getHeightmapSize(mapWidth, mapHeight) {
  return { width: mapWidth * 2 + 1, height: mapHeight * 2 + 1 };
}

async function fetchOverpass(query) {
  let lastErr;
  for (const mirror of OSM_OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Overpass mirrors failed: ${lastErr?.message}`);
}

function makeToXY(bbox, W, H) {
  return (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (W - 1)),
    Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (H - 1)),
  ];
}

/** Chain polyline segments sharing endpoints into longer continuous strokes. */
function chainPolylines(polylines) {
  if (!polylines.length) return [];
  const PREC = 4;
  const k = (pt) => `${pt.lat.toFixed(PREC)},${pt.lon.toFixed(PREC)}`;
  const endpointMap = new Map();
  const used = new Array(polylines.length).fill(false);
  polylines.forEach((pl, idx) => {
    const sk = k(pl[0]), ek = k(pl[pl.length - 1]);
    [sk, ek].forEach(key => { if (!endpointMap.has(key)) endpointMap.set(key, []); });
    endpointMap.get(sk).push({ idx, isStart: true });
    endpointMap.get(ek).push({ idx, isStart: false });
  });
  const chains = [];
  for (let start = 0; start < polylines.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    let chain = [...polylines[start]];
    for (let dir = 0; dir < 2; dir++) {
      let extended = true;
      while (extended) {
        extended = false;
        const endPt = dir === 0 ? chain[chain.length - 1] : chain[0];
        for (const { idx, isStart } of (endpointMap.get(k(endPt)) ?? [])) {
          if (used[idx]) continue;
          used[idx] = true;
          const seg = polylines[idx];
          if (dir === 0) chain = chain.concat(isStart ? seg.slice(1) : [...seg].reverse().slice(1));
          else chain = (isStart ? [...seg].reverse() : seg).concat(chain.slice(1));
          extended = true;
          break;
        }
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Paint OSM polygon elements as solid blue (0,0,255) onto an existing ImageData.
 * Uses a barrier-line flood-fill approach for coastline-style ways,
 * or direct polygon fill for closed area ways (lakes, water bodies).
 */
function paintPolygonsBlue(imageData, elements, toXY, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,255,1)';
  ctx.strokeStyle = 'rgba(0,0,255,1)';
  ctx.lineWidth = 2;

  for (const el of elements) {
    const draw = (pts) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(({ lat, lon }, i) => {
        const [x, y] = toXY(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.stroke();
    };
    if (el.type === 'way' && el.geometry?.length > 1) draw(el.geometry);
    else if (el.type === 'relation' && el.members) {
      for (const m of el.members) if (m.type === 'way' && m.geometry?.length > 1) draw(m.geometry);
    }
  }

  const overlay = ctx.getImageData(0, 0, W, H).data;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (overlay[i + 3] > 0) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
}

/**
 * Paint sea using the OSM coastline barrier-line + flood-fill approach.
 * Draws coastline as 1px black lines on a white canvas, then flood-fills from edges.
 * Border-reachable non-black pixels = sea → painted blue on imageData.
 */
function paintSeaFromCoastline_UNUSED(imageData, coastElements, toXY, W, H) {
  if (coastElements.length === 0) return;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W; maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  mctx.imageSmoothingEnabled = false;
  // Start fully black = everything is sea
  mctx.fillStyle = 'rgb(0,0,0)';
  mctx.fillRect(0, 0, W, H);

  // Draw coastline as white 1px barrier lines
  const chains = chainPolylines(coastElements.map(e => e.geometry));
  mctx.strokeStyle = 'rgb(255,255,255)';
  mctx.lineWidth = 1; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
  for (const chain of chains) {
    if (chain.length < 2) continue;
    mctx.beginPath();
    chain.forEach(({ lat, lon }, i) => {
      const [x, y] = toXY(lat, lon);
      i === 0 ? mctx.moveTo(x + 0.5, y + 0.5) : mctx.lineTo(x + 0.5, y + 0.5);
    });
    mctx.stroke();
  }

  const md = mctx.getImageData(0, 0, W, H).data;

  // Flood-fill land from all 4 edges.
  // White pixels are passable (land-reachable), black pixels block (stay sea).
  const visited = new Uint8Array(W * H);
  const queue = [];
  const enq = (x, y) => {
    const idx = y * W + x; if (visited[idx]) return;
    const i = idx * 4;
    if (md[i] === 0 && md[i + 1] === 0 && md[i + 2] === 0) return; // black = barrier / sea
    visited[idx] = 1; queue.push(x, y);
  };
  for (let x = 0; x < W; x++) { enq(x, 0); enq(x, H - 1); }
  for (let y = 0; y < H; y++) { enq(0, y); enq(W - 1, y); }
  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++], y = queue[qi++];
    const i = (y * W + x) * 4;
    // Mark as confirmed land (white stays white — already is, just mark visited)
    if (x > 0) enq(x - 1, y); if (x < W - 1) enq(x + 1, y);
    if (y > 0) enq(x, y - 1); if (y < H - 1) enq(x, y + 1);
  }

  // Pixels NOT visited AND not on the white barrier = sea → paint blue
  const d = imageData.data;
  for (let idx = 0; idx < W * H; idx++) {
    const mi = idx * 4;
    // Sea = black in mask AND not reached by land flood-fill
    if (!visited[idx] && md[mi] === 0) {
      const i = mi;
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
}



const RIVER_DETAIL_LEVELS = [
  { id: 'major',  label: 'Major rivers only',       filter: 'river' },
  { id: 'medium', label: 'Rivers + canals',          filter: 'river|canal' },
  { id: 'all',    label: 'Rivers, streams & canals', filter: 'river|stream|canal' },
];

export default function BboxLayerGenerator({ bbox, mapWidth, mapHeight, onLayerUpdate, onDone }) {
  const [status, setStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [rasterProgress, setRasterProgress] = useState({});
  const [generated, setGenerated] = useState({});
  const [riverDetail, setRiverDetail] = useState('major');
  const [includeLakes, setIncludeLakes] = useState(true);
  const [includeWaterRiver, setIncludeWaterRiver] = useState(false);

  // Store the current heightmap ImageData in a ref so overlay steps can read & modify it
  const heightmapRef = useRef(null);

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const { width: W, height: H } = getHeightmapSize(mapWidth, mapHeight);
  const toXY = makeToXY(bbox, W, H);

  const pushHeightmap = (imageData, extraGenerated = {}) => {
    heightmapRef.current = imageData;
    onLayerUpdate('heights', { imageData, visible: true, opacity: 0.8, dirty: true });
    setGenerated(p => ({ ...p, ...extraGenerated }));
  };

  // ── STEP 1: Coastline Base ────────────────────────────────────────────────
  // Fetch OSM coastline, barrier-line flood-fill to mark sea vs land.
  // Result: land = (1,1,1), sea = (0,0,255). No elevation yet.
  const generateCoastlineBase = async () => {
    setStatus('Fetching coastline from OpenStreetMap…');

    let elements = [];
    try {
      const data = await fetchOverpass(`[out:json][timeout:120];(way["natural"="coastline"](${bboxStr}););out geom;`);
      elements = (data.elements || []).filter(e => e.geometry?.length > 1);
    } catch (e) { setStatus(`Error: ${e.message}`); return; }

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    if (elements.length === 0) {
      // No coastline — entire bbox is land
      ctx.fillStyle = 'rgb(1,1,1)';
      ctx.fillRect(0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      setStatus('No coastline found — entire area treated as land (1,1,1).');
      pushHeightmap(imageData, { coastline: true, heightmap: false, sea: false, lakes: false });
      return;
    }

    // Fill entire canvas as land (1,1,1), draw coastline as 1px black barrier
    ctx.fillStyle = 'rgb(1,1,1)';
    ctx.fillRect(0, 0, W, H);
    const chains = chainPolylines(elements.map(e => e.geometry));
    ctx.strokeStyle = 'rgb(0,0,0)'; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const chain of chains) {
      if (chain.length < 2) continue;
      ctx.beginPath();
      chain.forEach(({ lat, lon }, i) => {
        const [x, y] = toXY(lat, lon);
        i === 0 ? ctx.moveTo(x + 0.5, y + 0.5) : ctx.lineTo(x + 0.5, y + 0.5);
      });
      ctx.stroke();
    }

    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;

    // Flood-fill sea from all 4 edges. Black barrier pixels block propagation.
    // Edge-reachable non-black pixels = sea → painted (0,0,255).
    const visited = new Uint8Array(W * H);
    const queue = [];
    const enq = (x, y) => {
      const idx = y * W + x; if (visited[idx]) return;
      const i = idx * 4;
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) return; // coastline barrier
      visited[idx] = 1; queue.push(x, y);
    };
    for (let x = 0; x < W; x++) { enq(x, 0); enq(x, H - 1); }
    for (let y = 0; y < H; y++) { enq(0, y); enq(W - 1, y); }
    let qi = 0;
    while (qi < queue.length) {
      const x = queue[qi++], y = queue[qi++];
      const i = (y * W + x) * 4;
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; // sea blue
      if (x > 0) enq(x - 1, y); if (x < W - 1) enq(x + 1, y);
      if (y > 0) enq(x, y - 1); if (y < H - 1) enq(x, y + 1);
    }
    // Convert remaining black coastline barrier pixels → land (1,1,1)
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) {
        d[i] = 1; d[i + 1] = 1; d[i + 2] = 1; d[i + 3] = 255;
      }
    }

    setStatus(`Coastline base ready — ${elements.length} ways. Land=(1,1,1), sea=(0,0,255).`);
    pushHeightmap(imageData, { coastline: true, heightmap: false, sea: false, lakes: false });
  };

  // ── STEP 2: Heightmap Relief ──────────────────────────────────────────────
  // Fetch Terrarium elevation tiles. Apply grayscale elevation ONLY to land pixels
  // (non-blue). Sea pixels (0,0,255) from Step 1 are preserved untouched.
  const generateHeightmap = async () => {
    if (!heightmapRef.current) { setStatus('Generate the coastline base first (Step 1).'); return; }
    setStatus('Fetching elevation tiles (Terrarium)…');
    setRasterProgress({ heights: { done: 0, total: 1 } });

    let elevData;
    try {
      elevData = await rasterizeTiles(
        HEIGHTMAP_URL, bbox, W, H,
        (done, total) => setRasterProgress({ heights: { done, total } }),
        { grayscale: true }
      );
    } catch (e) {
      setStatus(`Error fetching elevation: ${e.message}`);
      setRasterProgress({});
      return;
    }
    setRasterProgress({});

    // Clone current coastline base to preserve sea mask
    const imageData = new ImageData(
      new Uint8ClampedArray(heightmapRef.current.data),
      heightmapRef.current.width, heightmapRef.current.height
    );
    const d = imageData.data;
    const ed = elevData.data;

    // For every land pixel (not blue), replace with elevation grayscale
    for (let i = 0; i < d.length; i += 4) {
      const isSea = d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255;
      if (!isSea) {
        // Apply elevation value, clamped to min 1
        d[i] = ed[i]; d[i + 1] = ed[i + 1]; d[i + 2] = ed[i + 2]; d[i + 3] = 255;
        if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) { d[i] = 1; d[i + 1] = 1; d[i + 2] = 1; }
      }
    }

    setStatus(`Heightmap relief applied to land pixels — sea preserved.`);
    pushHeightmap(imageData, { heightmap: true });
  };

  // ── STEP 3: Lakes ─────────────────────────────────────────────────────────
  const paintLakes = async () => {
    if (!heightmapRef.current) { setStatus('Generate the heightmap first (Step 1).'); return; }

    const tags = [];
    if (includeLakes) tags.push('"water"="lake"', '"water"="reservoir"', '"natural"="water"');
    if (includeWaterRiver) tags.push('"water"="river"');
    if (tags.length === 0) { setStatus('Select at least one water type.'); return; }

    setStatus('Fetching water bodies from OpenStreetMap…');
    const tagFilters = tags.map(t => `way[${t}](${bboxStr});\nrelation[${t}](${bboxStr});`).join('\n');
    const osmQuery = `[out:json][timeout:120];(\n${tagFilters}\n);out geom;`;

    let elements = [];
    try {
      const data = await fetchOverpass(osmQuery);
      elements = (data.elements || []).filter(e =>
        (e.type === 'way' && e.geometry?.length > 1) ||
        (e.type === 'relation' && e.members?.some(m => m.geometry?.length > 1))
      );
    } catch (e) { setStatus(`Error: ${e.message}`); return; }

    if (elements.length === 0) { setStatus('No water bodies found in this area.'); return; }

    const imageData = new ImageData(
      new Uint8ClampedArray(heightmapRef.current.data),
      heightmapRef.current.width, heightmapRef.current.height
    );

    paintPolygonsBlue(imageData, elements, toXY, W, H);

    setStatus(`Water bodies painted — ${elements.length} features.`);
    pushHeightmap(imageData, { lakes: true });
  };

  // ── STEP 4: Rivers (features layer) ──────────────────────────────────────
  const generateRivers = async () => {
    const detail = RIVER_DETAIL_LEVELS.find(d => d.id === riverDetail) ?? RIVER_DETAIL_LEVELS[0];
    setStatus(`Fetching rivers (${detail.label})…`);
    const osmQuery = `[out:json][timeout:90];
(
  way["waterway"~"^(${detail.filter})$"](${bboxStr});
  relation["waterway"~"^(${detail.filter})$"](${bboxStr});
);
out geom;`;

    const def = LAYER_DEFS.find(d => d.id === 'features') ?? LAYER_DEFS.find(d => d.id === 'map_features');
    const { width, height } = def ? getLayerDimensions(def, mapWidth, mapHeight) : { width: mapWidth, height: mapHeight };
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const rToXY = makeToXY(bbox, width, height);
    ctx.clearRect(0, 0, width, height);

    let elements = [];
    try {
      const data = await fetchOverpass(osmQuery);
      elements = (data.elements || []).filter(e =>
        (e.type === 'way' && e.geometry?.length > 1) ||
        (e.type === 'relation' && e.members?.some(m => m.geometry?.length > 1))
      );
    } catch (e) { setStatus(`Error: ${e.message}`); return; }

    if (!elements.length) { setStatus('No waterways found.'); return; }

    const polylines = [];
    for (const el of elements) {
      if (el.type === 'way') polylines.push(el.geometry);
      else if (el.type === 'relation') for (const m of el.members) if (m.type === 'way' && m.geometry?.length > 1) polylines.push(m.geometry);
    }
    const chains = chainPolylines(polylines);
    ctx.strokeStyle = 'rgb(0,0,255)'; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const chain of chains) {
      if (chain.length < 2) continue;
      ctx.beginPath();
      chain.forEach(({ lat, lon }, i) => { const [x, y] = rToXY(lat, lon); i === 0 ? ctx.moveTo(x + 0.5, y + 0.5) : ctx.lineTo(x + 0.5, y + 0.5); });
      ctx.stroke();
    }
    const imageData = ctx.getImageData(0, 0, width, height);
    setStatus(`Rivers: ${chains.length} chains from ${polylines.length} segments.`);
    onLayerUpdate('features', { imageData, visible: true, opacity: 0.9, dirty: true });
    setGenerated(p => ({ ...p, features: true }));
  };

  const handleImportFile = (layerId, file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const def = LAYER_DEFS.find(d => d.id === layerId);
      const { width, height } = def ? getLayerDimensions(def, mapWidth, mapHeight) : { width: mapWidth, height: mapHeight };
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, width, height);
      onLayerUpdate(layerId, { imageData: ctx.getImageData(0, 0, width, height), visible: true, opacity: 0.85, dirty: true });
      setGenerated(p => ({ ...p, [layerId]: true }));
    };
    img.src = URL.createObjectURL(file);
  };

  const prog = rasterProgress.heights;
  const rasterPct = prog ? Math.round((prog.done / Math.max(prog.total, 1)) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Bbox info */}
      <div className="bg-slate-800 rounded p-2 text-[10px] text-slate-400 space-y-0.5">
        <p className="text-slate-300 font-semibold mb-1">Bounding Box</p>
        <p>Lat: <span className="text-slate-200 font-mono">{bbox.south.toFixed(3)}° → {bbox.north.toFixed(3)}°</span></p>
        <p>Lng: <span className="text-slate-200 font-mono">{bbox.west.toFixed(3)}° → {bbox.east.toFixed(3)}°</span></p>
        <p>Output: <span className="text-amber-300 font-mono">{mapWidth}×{mapHeight}</span> (×2+1: <span className="text-amber-300 font-mono">{W}×{H}</span>)</p>
      </div>

      {/* Step 1: Coastline Base */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-cyan-700 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">1</span>
          <p className="text-[10px] text-slate-300 font-semibold">Coastline Base</p>
          {generated.coastline && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Fetches <code className="text-amber-300">natural=coastline</code>, draws a 1px barrier, flood-fills sea from edges. Result: land = <code className="text-amber-300">(1,1,1)</code>, sea = <code className="text-amber-300">(0,0,255)</code>. Skip for fully inland maps.
        </p>
        <button onClick={async () => { setGenerating(true); await generateCoastlineBase(); setGenerating(false); }} disabled={generating}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.coastline ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-cyan-800 border-cyan-600 text-white hover:bg-cyan-700'}`}>
          <Waves className={`w-3 h-3 ${generating ? 'animate-pulse' : ''}`} />
          {generated.coastline ? '✓ Re-generate Coastline Base' : 'Generate Coastline Base'}
        </button>
      </div>

      {/* Step 2: Heightmap Relief */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-amber-600 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">2</span>
          <p className="text-[10px] text-slate-300 font-semibold">Heightmap Relief</p>
          {generated.heightmap && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Fetches Terrarium elevation tiles and applies grayscale relief <strong>only to land pixels</strong>. Sea pixels <code className="text-amber-300">(0,0,255)</code> from Step 1 are preserved exactly.
        </p>
        <button onClick={async () => { setGenerating(true); await generateHeightmap(); setGenerating(false); }} disabled={generating || !generated.coastline}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.heightmap ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-amber-700 border-amber-600 text-white hover:bg-amber-600'}`}>
          <Mountain className={`w-3 h-3 ${generating && rasterPct !== null ? 'animate-pulse' : ''}`} />
          {generated.heightmap ? '✓ Re-fetch Relief' : 'Fetch Elevation Relief'}
          {rasterPct !== null && <span className="ml-auto font-mono text-amber-200">{rasterPct}%</span>}
        </button>
        {!generated.coastline && <p className="text-[9px] text-amber-500">⚠ Complete Step 1 first</p>}
      </div>

      {/* Step 3: Lakes / Water bodies */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-blue-700 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">3</span>
          <p className="text-[10px] text-slate-300 font-semibold">Lakes &amp; Water Bodies</p>
          {generated.lakes && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Paints OSM water area polygons as <code className="text-amber-300">(0,0,255)</code> on top of the heightmap.
        </p>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeLakes} onChange={e => setIncludeLakes(e.target.checked)} className="accent-blue-400" />
            <span className="text-[10px] text-slate-300"><code className="text-amber-300">water=lake</code> / <code className="text-amber-300">reservoir</code> / <code className="text-amber-300">natural=water</code></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeWaterRiver} onChange={e => setIncludeWaterRiver(e.target.checked)} className="accent-blue-400" />
            <span className="text-[10px] text-slate-300"><code className="text-amber-300">water=river</code> <span className="text-slate-500">(wide river areas)</span></span>
          </label>
        </div>
        <button onClick={async () => { setGenerating(true); await paintLakes(); setGenerating(false); }} disabled={generating || !generated.coastline}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.lakes ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-blue-800 border-blue-600 text-white hover:bg-blue-700'}`}>
          <Droplets className={`w-3 h-3 ${generating ? 'animate-pulse' : ''}`} />
          {generated.lakes ? '✓ Re-paint Water Bodies' : 'Paint Water Bodies'}
        </button>
        {!generated.coastline && <p className="text-[9px] text-amber-500">⚠ Complete Step 1 first</p>}
      </div>

      {/* Step 4: Rivers (features layer) */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-indigo-700 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">4</span>
          <p className="text-[10px] text-slate-300 font-semibold">Rivers (Features Layer)</p>
          {generated.features && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Fetches <code className="text-amber-300">waterway</code> lines, chains into continuous strokes, renders 1px blue on the features layer.
        </p>
        <div className="bg-slate-800 border border-slate-700 rounded p-2 space-y-1">
          {RIVER_DETAIL_LEVELS.map(d => (
            <label key={d.id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="riverDetail" value={d.id} checked={riverDetail === d.id} onChange={() => setRiverDetail(d.id)} className="accent-indigo-400" />
              <span className={`text-[10px] ${riverDetail === d.id ? 'text-indigo-300' : 'text-slate-400'}`}>{d.label}</span>
            </label>
          ))}
        </div>
        <button onClick={async () => { setGenerating(true); await generateRivers(); setGenerating(false); }} disabled={generating}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.features ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-indigo-800 border-indigo-600 text-white hover:bg-indigo-700'}`}>
          <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
          {generated.features ? '✓ Re-fetch Rivers' : 'Fetch Rivers'}
        </button>
      </div>

      {/* Manual imports */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">Import Manually</p>
        <div className="space-y-1.5">
          {[{ id: 'climates', label: 'Climates (PNG)' }, { id: 'ground', label: 'Ground Types (PNG)' }].map(({ id, label }) => (
            <label key={id} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] border cursor-pointer transition-colors ${generated[id] ? 'bg-green-800/30 border-green-600/40 text-green-300' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
              {generated[id] ? <Check className="w-3 h-3 shrink-0" /> : null}
              {label}
              <input type="file" accept="image/*" className="hidden" onChange={e => { handleImportFile(id, e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          ))}
        </div>
      </div>

      {status && (
        <p className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-600/30 rounded px-2 py-1.5">{status}</p>
      )}

      <button onClick={onDone}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] bg-green-700 border border-green-600 text-white hover:bg-green-600 transition-colors font-semibold">
        <Check className="w-3.5 h-3.5" /> Proceed to Edit Layers →
      </button>
    </div>
  );
}