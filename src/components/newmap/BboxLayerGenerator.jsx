import React, { useState, useRef } from 'react';
import { RefreshCw, Check, Waves, Droplets, Mountain } from 'lucide-react';
import { LAYER_DEFS, getLayerDimensions } from '@/lib/mapLayerStore';
import { rasterizeTiles } from './TileRasterizer';

const OSM_OVERPASS = 'https://overpass-api.de/api/interpreter';
const HEIGHTMAP_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function getHeightmapSize(mapWidth, mapHeight) {
  return { width: mapWidth * 2 + 1, height: mapHeight * 2 + 1 };
}

async function fetchOverpass(query) {
  const res = await fetch(OSM_OVERPASS, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
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
function paintSeaFromCoastline(imageData, coastElements, toXY, W, H) {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W; maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  mctx.imageSmoothingEnabled = false;
  mctx.fillStyle = 'rgb(255,255,255)';
  mctx.fillRect(0, 0, W, H);

  if (coastElements.length > 0) {
    const chains = chainPolylines(coastElements.map(e => e.geometry));
    mctx.strokeStyle = 'rgb(0,0,0)';
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
  }

  const md = mctx.getImageData(0, 0, W, H).data;
  const visited = new Uint8Array(W * H);
  const queue = [];
  const enq = (x, y) => {
    const idx = y * W + x; if (visited[idx]) return;
    const i = idx * 4;
    if (md[i] === 0 && md[i + 1] === 0 && md[i + 2] === 0) return; // black barrier
    visited[idx] = 1; queue.push(x, y);
  };
  for (let x = 0; x < W; x++) { enq(x, 0); enq(x, H - 1); }
  for (let y = 0; y < H; y++) { enq(0, y); enq(W - 1, y); }
  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++], y = queue[qi++];
    const i = (y * W + x) * 4;
    md[i] = 0; md[i + 1] = 0; md[i + 2] = 0; md[i + 3] = 255; // mark sea
    if (x > 0) enq(x - 1, y); if (x < W - 1) enq(x + 1, y);
    if (y > 0) enq(x, y - 1); if (y < H - 1) enq(x, y + 1);
  }

  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (md[i] === 0 && md[i + 1] === 0 && md[i + 2] === 0 && md[i + 3] === 255) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
}

/** Post-process features/rivers imageData: normalize blue, thin to 1px, set origin white. */
function postProcessRivers(imageData) {
  const { width, height, data } = imageData;
  const isRiver = (i) => data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255 && data[i + 3] > 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i + 2] > 100 && data[i + 2] > data[i] + 20 && data[i + 2] > data[i + 1] + 20) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  let originSet = false;
  for (let y = 0; y < height && !originSet; y++) {
    for (let x = 0; x < width && !originSet; x++) {
      const i = (y * width + x) * 4;
      if (isRiver(i)) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255; originSet = true; }
    }
  }
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!isRiver(i)) continue;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (isRiver((ny * width + nx) * 4)) count++;
        }
        if (count > 2) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; changed = true; }
      }
    }
    if (!changed) break;
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

  // ── STEP 1: Heightmap ─────────────────────────────────────────────────────
  // Fetch Terrarium elevation tiles, clamp all pixels to min (1,1,1). Pure grayscale, no blue.
  const generateHeightmap = async () => {
    setStatus('Fetching elevation tiles (Terrarium)…');
    setRasterProgress({ heights: { done: 0, total: 1 } });
    let imageData;
    try {
      imageData = await rasterizeTiles(
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

    // Clamp all pixels to min (1,1,1) — black is reserved for sea in M2TW
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) { d[i] = 1; d[i + 1] = 1; d[i + 2] = 1; d[i + 3] = 255; }
      else if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) { d[i] = 1; d[i + 1] = 1; d[i + 2] = 1; }
    }

    setStatus(`Heightmap ready — ${W}×${H} px, land clamped to ≥(1,1,1).`);
    pushHeightmap(imageData, { heightmap: true, sea: false, lakes: false, waterRiver: false });
  };

  // ── STEP 2: Sea (OSM coastline) ───────────────────────────────────────────
  // Uses barrier-line flood-fill on the existing heightmap. No re-fetch of elevation.
  const paintSea = async () => {
    if (!heightmapRef.current) { setStatus('Generate the heightmap first (Step 1).'); return; }
    setStatus('Fetching coastline from OpenStreetMap…');

    let elements = [];
    try {
      const data = await fetchOverpass(`[out:json][timeout:120];(way["natural"="coastline"](${bboxStr}););out geom;`);
      elements = (data.elements || []).filter(e => e.geometry?.length > 1);
    } catch (e) { setStatus(`Error: ${e.message}`); return; }

    if (elements.length === 0) {
      setStatus('No coastline found in this bbox — area may be fully inland. Skip this step.');
      return;
    }

    // Clone the current heightmap so we don't mutate the stored ref
    const imageData = new ImageData(
      new Uint8ClampedArray(heightmapRef.current.data),
      heightmapRef.current.width, heightmapRef.current.height
    );

    paintSeaFromCoastline(imageData, elements, toXY, W, H);

    setStatus(`Sea painted — ${elements.length} coastline ways.`);
    pushHeightmap(imageData, { sea: true });
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
    postProcessRivers(imageData);
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

      {/* Step 1: Heightmap */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-amber-600 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">1</span>
          <p className="text-[10px] text-slate-300 font-semibold">Heightmap</p>
          {generated.heightmap && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Fetches Terrarium elevation tiles as grayscale. All pixels clamped to min <code className="text-amber-300">(1,1,1)</code>. No sea pixels yet.
        </p>
        <button onClick={async () => { setGenerating(true); await generateHeightmap(); setGenerating(false); }} disabled={generating}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.heightmap ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-amber-700 border-amber-600 text-white hover:bg-amber-600'}`}>
          <Mountain className={`w-3 h-3 ${generating && rasterPct !== null ? 'animate-pulse' : ''}`} />
          {generated.heightmap ? '✓ Re-fetch Heightmap' : 'Fetch Heightmap'}
          {rasterPct !== null && <span className="ml-auto font-mono text-amber-200">{rasterPct}%</span>}
        </button>
      </div>

      {/* Step 2: Sea */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-cyan-700 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">2</span>
          <p className="text-[10px] text-slate-300 font-semibold">Sea (OSM Coastline)</p>
          {generated.sea && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        <p className="text-[9px] text-slate-500">
          Fetches <code className="text-amber-300">natural=coastline</code>, draws a 1px black barrier line, then flood-fills sea from map edges as <code className="text-amber-300">(0,0,255)</code>. Applied on top of the heightmap. Skip for inland-only maps.
        </p>
        <button onClick={async () => { setGenerating(true); await paintSea(); setGenerating(false); }} disabled={generating || !generated.heightmap}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.sea ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-cyan-800 border-cyan-600 text-white hover:bg-cyan-700'}`}>
          <Waves className={`w-3 h-3 ${generating ? 'animate-pulse' : ''}`} />
          {generated.sea ? '✓ Re-paint Sea' : 'Paint Sea from Coastline'}
        </button>
        {!generated.heightmap && <p className="text-[9px] text-amber-500">⚠ Complete Step 1 first</p>}
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
        <button onClick={async () => { setGenerating(true); await paintLakes(); setGenerating(false); }} disabled={generating || !generated.heightmap}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.lakes ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-blue-800 border-blue-600 text-white hover:bg-blue-700'}`}>
          <Droplets className={`w-3 h-3 ${generating ? 'animate-pulse' : ''}`} />
          {generated.lakes ? '✓ Re-paint Water Bodies' : 'Paint Water Bodies'}
        </button>
        {!generated.heightmap && <p className="text-[9px] text-amber-500">⚠ Complete Step 1 first</p>}
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