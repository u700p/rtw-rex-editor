import React, { useState, useRef } from 'react';
import { Check, Droplets, Mountain, AlertTriangle, Download } from 'lucide-react';
import { LAYER_DEFS, getLayerDimensions } from '@/lib/mapLayerStore';
import { rasterizeTiles } from './TileRasterizer';
import SvgMapDownloader from './SvgMapDownloader';

const OSM_OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
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

/** Mercator Y helper — same projection used by TileRasterizer */
function latToMercN(lat) {
  const latRad = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

/**
 * Build a coordinate→pixel mapper that uses Web Mercator Y projection,
 * matching how the heightmap tiles are rendered by TileRasterizer.
 * X is still linear (longitude is equirectangular in Web Mercator).
 */
function makeToXY(bbox, W, H) {
  const mercNorth = latToMercN(bbox.north);
  const mercSouth = latToMercN(bbox.south);
  const mercRange = mercNorth - mercSouth;
  return (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (W - 1)),
    Math.round(((mercNorth - latToMercN(lat)) / mercRange) * (H - 1)),
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

/** Compute approximate pixel area of a polygon (Shoelace, integer pixel coords). */
function pixelArea(pts, toXY) {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = toXY(pts[i].lat, pts[i].lon);
    const [xj, yj] = toXY(pts[j].lat, pts[j].lon);
    area += (xj + xi) * (yj - yi);
  }
  return Math.abs(area) / 2;
}

/** Paint OSM polygon elements as solid blue (0,0,255) onto an existing ImageData.
 *  Relations are assembled by chaining their outer-ring members into one closed path
 *  (nonzero fill), so large multipolygon lakes render solid rather than as rings. */
function paintPolygonsBlue(imageData, elements, toXY, W, H, minPixelArea = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgb(0,0,255)';

  const drawRing = (pts) => {
    if (pts.length < 3) return;
    // Skip tiny features (ponds, ditches, noise)
    if (pixelArea(pts, toXY) < minPixelArea) return;
    ctx.beginPath();
    pts.forEach(({ lat, lon }, i) => {
      const [x, y] = toXY(lat, lon);
      i === 0 ? ctx.moveTo(x + 0.5, y + 0.5) : ctx.lineTo(x + 0.5, y + 0.5);
    });
    ctx.closePath();
    ctx.fill('nonzero'); // solid fill — no evenodd holes
  };

  for (const el of elements) {
    if (el.type === 'way' && el.geometry?.length > 2) {
      drawRing(el.geometry);
    } else if (el.type === 'relation' && el.members) {
      // Collect outer-ring member ways and chain them into one or more closed rings
      const outerWays = el.members
        .filter(m => m.type === 'way' && m.geometry?.length > 1 && (m.role === 'outer' || m.role === ''))
        .map(m => m.geometry);
      // If no roles specified, use all way members
      const ways = outerWays.length > 0 ? outerWays
        : el.members.filter(m => m.type === 'way' && m.geometry?.length > 1).map(m => m.geometry);
      const rings = chainPolylines(ways);
      for (const ring of rings) drawRing(ring);
    }
  }

  const overlay = ctx.getImageData(0, 0, W, H).data;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (overlay[i + 3] > 128) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; }
  }
}

/** Draw a pure pixel-perfect line using Bresenham's algorithm. No antialiasing. */
function bresenhamLine(data, width, height, x0, y0, x1, y1, r, g, b) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
      const i = (y0 * width + x0) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export default function BboxLayerGenerator({ bbox, mapWidth, mapHeight, onLayerUpdate, onDone }) {
  const [generating, setGenerating] = useState(false);
  const [rasterProgress, setRasterProgress] = useState({});
  const [generated, setGenerated] = useState({});

  const heightmapRef = useRef(null);
  // Separate water layer image datas for individual downloads (transparent bg)
  const lakesImageDataRef = useRef(null);
  const lagoonsImageDataRef = useRef(null);
  const [heightmapStatus, setHeightmapStatus] = useState('');

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const { width: W, height: H } = getHeightmapSize(mapWidth, mapHeight);
  const toXY = makeToXY(bbox, W, H);

  const downloadImageData = (imageData, filename) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  };

  // Download an imageData keeping only painted (non-transparent) pixels, rest transparent
  const downloadLayerTransparent = (imageData, filename) => {
    if (!imageData) return;
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    // Copy then make fully-transparent pixels stay transparent
    ctx.putImageData(imageData, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  };

  const pushHeightmap = (imageData, extraGenerated = {}) => {
    heightmapRef.current = imageData;
    onLayerUpdate('heights', { imageData, visible: true, opacity: 0.8, dirty: true });
    setGenerated(p => ({ ...p, ...extraGenerated }));
  };

  const paintSeaLevel = () => {
    if (!heightmapRef.current) return;
    const src = heightmapRef.current;
    const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = copy.data;
    let count = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
        count++;
      }
    }
    setHeightmapStatus(`✓ Re-painted ${count} sea-level pixels.`);
    pushHeightmap(copy, { seaLevel: true });
  };

  // ── STEP 1: Heightmap ─────────────────────────────────────────────────────
  // Fetch Terrarium elevation tiles (grayscale). Pixels with value 0 = sea level → (0,0,255).
  // All other pixels stay as grayscale land elevation.
  const generateHeightmap = async () => {
    setHeightmapStatus('Fetching elevation tiles (Terrarium)…');
    setRasterProgress({ heights: { done: 0, total: 1 } });

    let elevData;
    try {
      elevData = await rasterizeTiles(
        HEIGHTMAP_URL, bbox, W, H,
        (done, total) => setRasterProgress({ heights: { done, total } }),
        { grayscale: true }
      );
    } catch (e) {
      setHeightmapStatus(`Error fetching elevation: ${e.message}`);
      setRasterProgress({});
      return;
    }
    setRasterProgress({});

    // Sea pixels are already (0,0,255) — handled inside rasterizeTiles grayscale mode.
    const seaCount = elevData.data.reduce((n, _, i) => (i % 4 === 2 && elevData.data[i] === 255 && elevData.data[i - 1] === 0 && elevData.data[i - 2] === 0) ? n + 1 : n, 0);
    setHeightmapStatus(`✓ Heightmap ready — ${seaCount} sea pixels (0,0,255), land grayscale 1–255.`);
    pushHeightmap(elevData, { heightmap: true, seaLevel: true });
  };

  // ── STEP 2: Water Bodies ──────────────────────────────────────────────────
  const [waterOpts, setWaterOpts] = useState({ sea: true, lagoon: false, lake: false });
  const [minWaterPixels, setMinWaterPixels] = useState(16);
  const [waterStatus, setWaterStatus] = useState('');

  const paintWaterBodies = async () => {
    if (!heightmapRef.current) { setWaterStatus('Generate the heightmap first (Step 1).'); return; }
    if (!waterOpts.sea && !waterOpts.lagoon && !waterOpts.lake) { setWaterStatus('Select at least one water type.'); return; }

    setWaterStatus('Fetching water bodies from OpenStreetMap…');

    // Build per-type queries so we can store separate download layers
    const typeQueries = [];
    if (waterOpts.sea) {
      typeQueries.push({ key: 'sea', query: `[out:json][timeout:120];\n(\n  way["natural"="water"]["water"="sea"](${bboxStr});\n  relation["natural"="water"]["water"="sea"](${bboxStr});\n  way["place"="sea"](${bboxStr});\n  relation["place"="sea"](${bboxStr});\n  way["place"="ocean"](${bboxStr});\n  relation["place"="ocean"](${bboxStr});\n);\nout geom;` });
    }
    if (waterOpts.lagoon) {
      typeQueries.push({ key: 'lagoon', query: `[out:json][timeout:120];\n(\n  way["water"="lagoon"](${bboxStr});\n  relation["water"="lagoon"](${bboxStr});\n);\nout geom;` });
    }
    if (waterOpts.lake) {
      typeQueries.push({ key: 'lake', query: `[out:json][timeout:120];\n(\n  way["water"="lake"](${bboxStr});\n  relation["water"="lake"](${bboxStr});\n);\nout geom;` });
    }

    const allElements = [];
    const byType = {};

    for (const { key, query } of typeQueries) {
      setWaterStatus(`Fetching ${key}s…`);
      try {
        const data = await fetchOverpass(query);
        const els = (data.elements || []).filter(e =>
          (e.type === 'way' && e.geometry?.length > 1) ||
          (e.type === 'relation' && e.members?.some(m => m.geometry?.length > 1))
        );
        byType[key] = els;
        allElements.push(...els);
      } catch (e) { setWaterStatus(`Error fetching ${key}: ${e.message}`); return; }
    }

    if (allElements.length === 0) { setWaterStatus('No water bodies found in this area.'); return; }

    setWaterStatus('Painting water bodies onto heightmap…');

    // Build separate per-type transparent download layers
    const makeBlankImageData = () => new ImageData(new Uint8ClampedArray(W * H * 4), W, H);

    if (byType.lake?.length) {
      const lakesID = makeBlankImageData();
      paintPolygonsBlue(lakesID, byType.lake, toXY, W, H, minWaterPixels);
      lakesImageDataRef.current = lakesID;
    }
    if (byType.lagoon?.length) {
      const lagoonsID = makeBlankImageData();
      paintPolygonsBlue(lagoonsID, byType.lagoon, toXY, W, H, minWaterPixels);
      lagoonsImageDataRef.current = lagoonsID;
    }

    // Paint all onto the heightmap
    const imageData = new ImageData(
      new Uint8ClampedArray(heightmapRef.current.data),
      heightmapRef.current.width, heightmapRef.current.height
    );
    paintPolygonsBlue(imageData, allElements, toXY, W, H, minWaterPixels);
    setWaterStatus(`✓ Painted ${allElements.length} features.`);
    pushHeightmap(imageData, { lakes: true });
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
        <p>Lat: <span className="text-slate-200 font-mono">{bbox.south.toFixed(6)}° → {bbox.north.toFixed(6)}°</span></p>
        <p>Lng: <span className="text-slate-200 font-mono">{bbox.west.toFixed(6)}° → {bbox.east.toFixed(6)}°</span></p>
        <p>Output: <span className="text-amber-300 font-mono">{mapWidth}×{mapHeight}</span> (×2+1: <span className="text-amber-300 font-mono">{W}×{H}</span>)</p>
        <button
          onClick={() => {
            const lines = [
              `# BboxLayerGenerator — Selected Area Coordinates`,
              `# Generated: ${new Date().toISOString()}`,
              ``,
              `north=${bbox.north.toFixed(6)}`,
              `south=${bbox.south.toFixed(6)}`,
              `west=${bbox.west.toFixed(6)}`,
              `east=${bbox.east.toFixed(6)}`,
              ``,
              `map_width=${mapWidth}`,
              `map_height=${mapHeight}`,
              `heightmap_width=${W}`,
              `heightmap_height=${H}`,
            ].join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }));
            a.download = 'bbox_coords.txt';
            a.click();
          }}
          className="mt-1.5 w-full flex items-center justify-center gap-2 px-2 py-1 rounded text-[9px] border border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors font-semibold"
        >
          <Download className="w-3 h-3" /> Download bbox_coords.txt
        </button>
      </div>

      {/* Step 1: Heightmap */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-amber-600 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">1</span>
          <p className="text-[10px] text-slate-300 font-semibold">Heightmap</p>
          {generated.heightmap && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        {heightmapStatus && (
          <p className={`text-[9px] px-2 py-1 rounded border ${heightmapStatus.startsWith('✓') ? 'bg-green-900/20 border-green-600/30 text-green-400' : heightmapStatus.startsWith('Error') ? 'bg-red-900/20 border-red-600/30 text-red-400' : 'bg-amber-900/20 border-amber-600/30 text-amber-300'}`}>{heightmapStatus}</p>
        )}
        <p className="text-[9px] text-slate-500">
          Fetches Terrarium elevation tiles as grayscale. The lowest ground value is clamped to <code className="text-amber-300">(1,1,1)</code> — pure black <code className="text-amber-300">(0,0,0)</code> is reserved for sea.
        </p>
        {/* Notice about low-lying land */}
        <div className="flex items-start gap-1.5 bg-amber-900/25 border border-amber-600/30 rounded px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[9px] text-amber-300 leading-snug">
            Land at or near sea level (deltas, coastal plains, polders) may have an elevation value of <code>0</code> in the Terrarium data and will appear as sea <code>(0,0,255)</code> in the game. You may need to manually paint those areas in the heightmap editor.
          </p>
        </div>
        <button onClick={async () => { setGenerating(true); await generateHeightmap(); setGenerating(false); }} disabled={generating}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.heightmap ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-amber-700 border-amber-600 text-white hover:bg-amber-600'}`}>
          <Mountain className={`w-3 h-3 ${generating && rasterPct !== null ? 'animate-pulse' : ''}`} />
          {generated.heightmap ? '✓ Re-fetch Heightmap' : 'Fetch Heightmap'}
          {rasterPct !== null && <span className="ml-auto font-mono text-amber-200">{rasterPct}%</span>}
        </button>
        {generated.heightmap && (
          <button onClick={() => downloadImageData(heightmapRef.current, 'heightmap.png')}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors font-semibold bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
            <Download className="w-3 h-3" /> Download Heightmap (PNG)
          </button>
        )}
        {/* 1b: sea-level flood fill */}
        {generated.heightmap && (
          <div className="border border-slate-600 rounded p-2 space-y-1.5 bg-slate-800/40">
            <p className="text-[9px] text-slate-400 font-semibold">1b — Paint Sea-Level Pixels</p>
            <p className="text-[9px] text-slate-500 leading-snug">
              Sea-level pixels are painted automatically on fetch. Use this to re-apply if you've manually edited the heightmap and want to restore any <code className="text-amber-300">(0,0,0)</code> pixels back to sea <code className="text-amber-300">(0,0,255)</code>.
            </p>
            <button onClick={paintSeaLevel} disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold bg-blue-900/40 border-blue-600/50 text-blue-300 hover:bg-blue-800/50">
              <Droplets className="w-3 h-3" />
              Re-paint Sea Level (elevation 0 → blue)
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Water Bodies */}
      <div className="border border-slate-700 rounded p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold bg-blue-700 text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0">2</span>
          <p className="text-[10px] text-slate-300 font-semibold">Water Bodies</p>
          {generated.lakes && <Check className="w-3 h-3 text-green-400 ml-auto" />}
        </div>
        {waterStatus && (
          <p className={`text-[9px] px-2 py-1 rounded border ${waterStatus.startsWith('✓') ? 'bg-green-900/20 border-green-600/30 text-green-400' : waterStatus.startsWith('Error') ? 'bg-red-900/20 border-red-600/30 text-red-400' : 'bg-blue-900/20 border-blue-600/30 text-blue-300'}`}>{waterStatus}</p>
        )}
        <p className="text-[9px] text-slate-500">
          Paint selected water body types as sea <code className="text-amber-300">(0,0,255)</code> on the heightmap.
        </p>
        <div className="space-y-1">
          {[
            { key: 'sea',    label: 'Seas & Oceans',  desc: 'natural=water/water=sea' },
            { key: 'lagoon', label: 'Lagoons',         desc: 'water=lagoon' },
            { key: 'lake',   label: 'Lakes',           desc: 'water=lake' },
          ].map(opt => (
            <label key={opt.key} className="flex items-start gap-2 cursor-pointer group">
              <input type="checkbox" checked={waterOpts[opt.key]}
                onChange={e => setWaterOpts(p => ({ ...p, [opt.key]: e.target.checked }))}
                className="mt-0.5 accent-blue-400" />
              <span className="flex-1">
                <span className="text-[10px] text-slate-300 font-medium">{opt.label}</span>
                <span className="text-[9px] text-slate-600 ml-1.5 font-mono">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400">Min size (px²)</span>
            <span className="text-[9px] font-mono text-amber-300">{minWaterPixels}</span>
          </div>
          <input type="range" min={1} max={200} value={minWaterPixels}
            onChange={e => setMinWaterPixels(Number(e.target.value))}
            className="w-full accent-blue-400 h-1" />
          <p className="text-[9px] text-slate-600">Water bodies smaller than this pixel area are skipped (removes tiny ponds).</p>
        </div>
        <button onClick={async () => { setGenerating(true); await paintWaterBodies(); setGenerating(false); }} disabled={generating || !generated.heightmap}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${generated.lakes ? 'bg-green-800/30 border-green-600/40 text-green-300 hover:bg-green-700/40' : 'bg-blue-800 border-blue-600 text-white hover:bg-blue-700'}`}>
          <Droplets className={`w-3 h-3 ${generating ? 'animate-pulse' : ''}`} />
          {generated.lakes ? '✓ Re-paint Water Bodies' : 'Paint Water Bodies'}
        </button>
        {!generated.heightmap && <p className="text-[9px] text-amber-500">⚠ Complete Step 1 first</p>}
        {/* Separate layer downloads (transparent bg) */}
        {(lakesImageDataRef.current || lagoonsImageDataRef.current) && (
          <div className="space-y-1 pt-1 border-t border-slate-700">
            <p className="text-[9px] text-slate-500 font-semibold">Download separate layers (transparent bg)</p>
            {lakesImageDataRef.current && (
              <button onClick={() => downloadLayerTransparent(lakesImageDataRef.current, 'lakes.png')}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors font-semibold bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                <Download className="w-3 h-3" /> Download Lakes (PNG, transparent)
              </button>
            )}
            {lagoonsImageDataRef.current && (
              <button onClick={() => downloadLayerTransparent(lagoonsImageDataRef.current, 'lagoons.png')}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors font-semibold bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                <Download className="w-3 h-3" /> Download Lagoons (PNG, transparent)
              </button>
            )}
          </div>
        )}
      </div>

      {/* SVG Reference Map Downloads */}
      <SvgMapDownloader bbox={bbox} />

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

      <button onClick={onDone}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] bg-green-700 border border-green-600 text-white hover:bg-green-600 transition-colors font-semibold">
        <Check className="w-3.5 h-3.5" /> Proceed to Edit Layers →
      </button>
    </div>
  );
}