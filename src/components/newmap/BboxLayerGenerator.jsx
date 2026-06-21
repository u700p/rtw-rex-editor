import React, { useState, useRef } from 'react';
import { ExternalLink, RefreshCw, Check, Download, AlertCircle } from 'lucide-react';
import { LAYER_DEFS, getLayerDimensions } from '@/lib/mapLayerStore';
import { rasterizeTiles } from './TileRasterizer';

// Tile URL templates to rasterize
const RASTER_SOURCES = [
  {
    id: 'heights',
    label: 'Heightmap (Terrarium)',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    grayscale: true,
  },
  {
    id: 'topo_ref',
    label: 'Topographic (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  },
];

function getRasterSize(layerId, mapWidth, mapHeight) {
  if (layerId === 'heights' || layerId === 'topo_ref') {
    return { width: mapWidth * 2 + 1, height: mapHeight * 2 + 1 };
  }
  return { width: mapWidth, height: mapHeight };
}

const OSM_OVERPASS = 'https://overpass-api.de/api/interpreter';

// River detail levels: what waterway types to include
const RIVER_DETAIL_LEVELS = [
  { id: 'major',  label: 'Major rivers only',      filter: 'river' },
  { id: 'medium', label: 'Rivers + canals',         filter: 'river|canal' },
  { id: 'all',    label: 'Rivers, streams & canals', filter: 'river|stream|canal' },
];

async function fetchOverpass(query, endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function makeBboxCanvas(bbox, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const toXY = (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1)),
    Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (height - 1)),
  ];
  return { canvas, ctx, toXY };
}

/**
 * Post-process river ImageData:
 * - All river pixels become pure blue (0, 0, 255)
 * - Remove any river pixel that has more than 2 river neighbors (8-directional)
 *   by iterating until stable (max 5 passes)
 */
function postProcessRivers(imageData) {
  const { width, height, data } = imageData;

  const isRiver = (i) => data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255 && data[i + 3] > 0;

  // First: set starting pixel (top-left-most river pixel) to white (255,255,255)
  // and ensure all river pixels are pure blue
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    // Any blue-dominant pixel → pure blue river
    if (a > 0 && b > 100 && b > r + 20 && b > g + 20) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
    }
  }

  // Find the first river pixel (top-to-bottom, left-to-right) → mark as white (origin)
  let originSet = false;
  for (let y = 0; y < height && !originSet; y++) {
    for (let x = 0; x < width && !originSet; x++) {
      const i = (y * width + x) * 4;
      if (isRiver(i)) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
        originSet = true;
      }
    }
  }

  // Thin rivers: remove pixels with > 2 river neighbors, up to 5 passes
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!isRiver(i)) continue;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (isRiver(ni)) count++;
          }
        }
        if (count > 2) {
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return imageData;
}

export default function BboxLayerGenerator({ bbox, mapWidth, mapHeight, onLayerUpdate, onDone }) {
  const [status, setStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [rasterProgress, setRasterProgress] = useState({});
  const [generated, setGenerated] = useState({});
  const [riverDetail, setRiverDetail] = useState('major');
  const [seaThreshold, setSeaThreshold] = useState(10); // grayscale brightness ≤ this = sea on heightmap

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const generateRivers = async () => {
    const detail = RIVER_DETAIL_LEVELS.find(d => d.id === riverDetail) ?? RIVER_DETAIL_LEVELS[0];
    setStatus(`Fetching rivers from OpenStreetMap (${detail.label})…`);

    const osmQuery = `[out:json][timeout:90];
(
  way["waterway"~"^(${detail.filter})$"](${bboxStr});
);
out geom;`;

    const def = LAYER_DEFS.find(d => d.id === 'features') ?? LAYER_DEFS.find(d => d.id === 'map_features');
    const { width, height } = def
      ? getLayerDimensions(def, mapWidth, mapHeight)
      : { width: mapWidth, height: mapHeight };
    const { canvas, ctx, toXY } = makeBboxCanvas(bbox, width, height);

    // Start background transparent
    ctx.clearRect(0, 0, width, height);

    let elements = [];
    try {
      const data = await fetchOverpass(osmQuery, OSM_OVERPASS);
      elements = (data.elements || []).filter(e => e.geometry?.length > 1);
    } catch (e) {
      setStatus(`Error fetching rivers: ${e.message}`);
      return;
    }

    if (elements.length === 0) {
      setStatus('No waterways found in this area for the selected detail level.');
      return;
    }

    // Draw rivers as 1px pure blue lines
    ctx.strokeStyle = 'rgb(0,0,255)';
    ctx.lineWidth = 1;
    elements.forEach(el => {
      ctx.beginPath();
      el.geometry.forEach(({ lat, lon }, i) => {
        const [x, y] = toXY(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // Post-process: enforce 1px constraint and set origin pixel to white
    const imageData = ctx.getImageData(0, 0, width, height);
    postProcessRivers(imageData);

    setStatus(`Rivers generated (${elements.length} waterways, ${detail.label}).`);
    onLayerUpdate('features', { imageData, visible: true, opacity: 0.9, dirty: true });
    setGenerated(p => ({ ...p, features: true }));
  };

  const handleImportFile = (layerId, file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const def = LAYER_DEFS.find(d => d.id === layerId);
      const { width, height } = def
        ? getLayerDimensions(def, mapWidth, mapHeight)
        : { width: mapWidth, height: mapHeight };
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      onLayerUpdate(layerId, { imageData, visible: true, opacity: 0.85, dirty: true });
      setGenerated(p => ({ ...p, [layerId]: true }));
    };
    img.src = URL.createObjectURL(file);
  };

  const rasterizeLayer = async (source) => {
    const { width, height } = getRasterSize(source.id, mapWidth, mapHeight);
    setStatus(`Rasterizing ${source.label} (${width}×${height} px)…`);
    setRasterProgress(p => ({ ...p, [source.id]: { done: 0, total: 1 } }));
    try {
      const imageData = await rasterizeTiles(
        source.url, bbox, width, height,
        (done, total) => setRasterProgress(p => ({ ...p, [source.id]: { done, total } })),
        { grayscale: source.grayscale }
      );

      // For heightmap: apply sea threshold — pixels with grayscale ≤ threshold become blue sea
      if (source.id === 'heights' && seaThreshold > 0) {
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (gray <= seaThreshold && !(d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255)) {
            d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
          }
        }
      }

      onLayerUpdate(source.id, { imageData, visible: true, opacity: 0.8, dirty: true });
      setGenerated(p => ({ ...p, [source.id]: true }));
      setStatus(`${source.label} rasterized at ${width}×${height} px.`);
    } catch (e) {
      setStatus(`Error rasterizing ${source.label}: ${e.message}`);
    }
    setRasterProgress(p => ({ ...p, [source.id]: null }));
  };

  return (
    <div className="space-y-4">
      {/* Bbox info */}
      <div className="bg-slate-800 rounded p-2 text-[10px] text-slate-400 space-y-0.5">
        <p className="text-slate-300 font-semibold mb-1">Bounding Box</p>
        <p>Lat: <span className="text-slate-200 font-mono">{bbox.south.toFixed(3)}° → {bbox.north.toFixed(3)}°</span></p>
        <p>Lng: <span className="text-slate-200 font-mono">{bbox.west.toFixed(3)}° → {bbox.east.toFixed(3)}°</span></p>
        <p>Output: <span className="text-amber-300 font-mono">{mapWidth}×{mapHeight}</span> (×2+1: <span className="text-amber-300 font-mono">{mapWidth*2+1}×{mapHeight*2+1}</span>)</p>
      </div>

      {/* Heightmap + coastline threshold */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Heightmap (Terrarium)</p>
        <p className="text-[9px] text-slate-500 mb-2">
          Sea pixels → RGB(0,0,255). Land → grayscale 1–255. Adjust the sea level threshold to refine coastlines.
        </p>

        <div className="bg-slate-800 border border-slate-700 rounded p-2 mb-2 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-slate-400">Sea threshold (grayscale ≤ value = sea)</p>
            <span className="text-[10px] font-mono text-amber-400">{seaThreshold}</span>
          </div>
          <input type="range" min="0" max="40" step="1" value={seaThreshold}
            onChange={e => setSeaThreshold(Number(e.target.value))}
            className="w-full h-1.5 accent-amber-400" />
          <div className="flex justify-between text-[8px] text-slate-600">
            <span>0 (strict)</span><span>10 (default)</span><span>40 (generous)</span>
          </div>
          <p className="text-[9px] text-slate-500">Higher = more sea, lower = more land near coasts.</p>
        </div>

        <div className="space-y-1.5">
          {RASTER_SOURCES.map(src => {
            const prog = rasterProgress[src.id];
            const done = generated[src.id];
            const pct = prog ? Math.round((prog.done / Math.max(prog.total, 1)) * 100) : null;
            return (
              <div key={src.id} className="flex items-center gap-1">
                <button
                  onClick={() => { setGenerating(true); rasterizeLayer(src).finally(() => setGenerating(false)); }}
                  disabled={generating}
                  className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 ${
                    done ? 'bg-green-800/30 border-green-600/40 text-green-300' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                  }`}>
                  {done ? <Check className="w-3 h-3 shrink-0" /> : <Download className="w-3 h-3 shrink-0" />}
                  {src.label}
                  {pct !== null && <span className="ml-auto font-mono text-amber-300">{pct}%</span>}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-slate-500 mt-1">
          The OpenTopoMap is useful as a reference for ground type generation.
        </p>
      </div>

      {/* Rivers from OSM */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Generate Rivers (OSM)</p>
        <p className="text-[9px] text-slate-500 mb-2">
          Rivers are rendered as 1-pixel pure blue (0,0,255) lines. The origin point is set to white (255,255,255). Each river pixel has at most 2 contiguous neighbors.
        </p>

        <div className="bg-slate-800 border border-slate-700 rounded p-2 mb-2 space-y-1.5">
          <p className="text-[9px] text-slate-400 font-semibold">Level of detail</p>
          {RIVER_DETAIL_LEVELS.map(d => (
            <label key={d.id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="riverDetail" value={d.id}
                checked={riverDetail === d.id}
                onChange={() => setRiverDetail(d.id)}
                className="accent-amber-400" />
              <span className={`text-[10px] ${riverDetail === d.id ? 'text-amber-300' : 'text-slate-400'}`}>{d.label}</span>
            </label>
          ))}
          <p className="text-[9px] text-slate-500 pt-1">
            Start with Major only. Add streams only if you need fine detail — they can be very dense.
          </p>
        </div>

        <button onClick={async () => { setGenerating(true); await generateRivers(); setGenerating(false); }} disabled={generating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
          <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
          Fetch Rivers from OSM
        </button>
        {generated.features && (
          <p className="text-[10px] text-green-400 flex items-center gap-1 mt-1"><Check className="w-3 h-3" /> Rivers generated</p>
        )}
      </div>

      {/* Manual imports */}
      <div>
        <p className="text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">Import Manually</p>
        <div className="space-y-1.5">
          {[
            { id: 'climates', label: 'Climates (PNG)' },
            { id: 'ground',   label: 'Ground Types (PNG)' },
          ].map(({ id, label }) => (
            <label key={id}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] border cursor-pointer transition-colors ${
                generated[id]
                  ? 'bg-green-800/30 border-green-600/40 text-green-300'
                  : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
              }`}>
              {generated[id] ? <Check className="w-3 h-3 shrink-0" /> : null}
              {label}
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                handleImportFile(id, e.target.files?.[0]);
                e.target.value = '';
              }} />
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