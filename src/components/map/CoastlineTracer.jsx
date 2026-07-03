import { useState, useRef } from 'react';
import { Waves, Download, X, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * CoastlineTracer — fetches OSM natural=coastline ways for the bbox,
 * projects them into map pixel space, and paints them onto the heights layer.
 *
 * Coastline convention (OSM): water is to the LEFT of the way direction.
 * We paint coastline pixels as sea (0,0,255) on the heights layer,
 * giving the user editable nodes to refine.
 *
 * Also offers: paint as land boundary (draw the line only, not flood-fill),
 * and download the resulting coastline as a PNG mask.
 */

const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function fetchOverpass(query) {
  let lastErr;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Overpass failed: ${lastErr?.message}`);
}

function latToMercY(lat) {
  const r = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function makeGeoToPixel(bbox, W, H) {
  const mercNorth = latToMercY(bbox.north);
  const mercSouth = latToMercY(bbox.south);
  return (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (W - 1)),
    Math.round(((mercNorth - latToMercY(lat)) / (mercNorth - mercSouth)) * (H - 1)),
  ];
}

function bresenham(data, W, H, x0, y0, x1, y1, r, g, b) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) {
      const i = (y0 * W + x0) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }
}

/** Chain polyline segments sharing endpoints. */
function chainPolylines(polylines) {
  if (!polylines.length) return [];
  const PREC = 5;
  const k = pt => `${pt.lat.toFixed(PREC)},${pt.lon.toFixed(PREC)}`;
  const endpointMap = new Map();
  const used = new Array(polylines.length).fill(false);
  polylines.forEach((pl, idx) => {
    [k(pl[0]), k(pl[pl.length - 1])].forEach(key => {
      if (!endpointMap.has(key)) endpointMap.set(key, []);
      endpointMap.get(key).push({ idx, isStart: key === k(pl[0]) });
    });
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
          else chain = (isStart ? [...seg].reverse() : seg).slice(0, -1).concat(chain);
          extended = true; break;
        }
      }
    }
    chains.push(chain);
  }
  return chains;
}

export default function CoastlineTracer({ bbox, mapW, mapH, onApplyToLayer }) {
  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [mode, setMode]       = useState('line'); // 'line' | 'sea'
  const [lineWidth, setLineWidth] = useState(1);
  const [chainCount, setChainCount] = useState(null);
  const chainsRef = useRef(null);

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const fetchCoastline = async () => {
    setLoading(true);
    setStatus('Fetching coastline from OpenStreetMap…');
    chainsRef.current = null;
    setChainCount(null);
    try {
      const query = `[out:json][timeout:120];
(
  way["natural"="coastline"](${bboxStr});
);
out geom;`;
      const data = await fetchOverpass(query);
      const ways = (data.elements || []).filter(e => e.type === 'way' && e.geometry?.length > 1);
      if (!ways.length) { setStatus('No coastline found in this bounding box.'); setLoading(false); return; }
      const polylines = ways.map(w => w.geometry);
      const chains = chainPolylines(polylines);
      chainsRef.current = chains;
      setChainCount(chains.length);
      setStatus(`✓ Fetched ${ways.length} way(s) → ${chains.length} chain(s). Click "Apply to Heights" to paint.`);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  };

  const applyToHeights = () => {
    if (!chainsRef.current || !onApplyToLayer) return;
    const geoToPixel = makeGeoToPixel(bbox, mapW, mapH);
    const imageData = new ImageData(new Uint8ClampedArray(mapW * mapH * 4), mapW, mapH);
    const d = imageData.data;

    // sea color for heights = (0,0,255); line-only = dark blue border (0,0,200)
    const [r, g, b] = mode === 'sea' ? [0, 0, 255] : [0, 0, 200];
    const lw = Math.max(1, lineWidth);

    for (const chain of chainsRef.current) {
      if (chain.length < 2) continue;
      for (let s = 0; s < chain.length - 1; s++) {
        const [x0, y0] = geoToPixel(chain[s].lat, chain[s].lon);
        const [x1, y1] = geoToPixel(chain[s + 1].lat, chain[s + 1].lon);
        // Draw with requested line width by offsetting perpendicular pixels
        for (let w = 0; w < lw; w++) {
          bresenham(d, mapW, mapH, x0 + w, y0, x1 + w, y1, r, g, b);
          bresenham(d, mapW, mapH, x0, y0 + w, x1, y1 + w, r, g, b);
        }
      }
    }

    onApplyToLayer('heights', imageData);
    setStatus(`✓ Coastline painted onto heights layer (${mode === 'sea' ? 'sea blue 0,0,255' : 'border line 0,0,200'}).`);
  };

  const downloadMask = () => {
    if (!chainsRef.current) return;
    const geoToPixel = makeGeoToPixel(bbox, mapW, mapH);
    const canvas = document.createElement('canvas');
    canvas.width = mapW; canvas.height = mapH;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(mapW * mapH * 4), mapW, mapH);
    const d = imageData.data;
    for (const chain of chainsRef.current) {
      for (let s = 0; s < chain.length - 1; s++) {
        const [x0, y0] = geoToPixel(chain[s].lat, chain[s].lon);
        const [x1, y1] = geoToPixel(chain[s + 1].lat, chain[s + 1].lon);
        bresenham(d, mapW, mapH, x0, y0, x1, y1, 0, 0, 255);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'coastline_mask.png';
    a.click();
  };

  if (!bbox) return null;

  return (
    <div className="border border-slate-700 rounded overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-left"
      >
        <Waves className="w-3 h-3 text-blue-400 shrink-0" />
        <span className="text-[10px] font-semibold text-slate-200 flex-1">OSM Coastline Tracer</span>
        {chainCount !== null && <span className="text-[9px] text-green-400">{chainCount} chains</span>}
        {open ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2 bg-slate-900">
          <p className="text-[9px] text-slate-500 leading-snug">
            Fetches <code className="text-amber-300">natural=coastline</code> from OSM for your bbox, chains segments into continuous strokes, and paints them onto the heights layer as editable pixels.
          </p>

          {/* Mode */}
          <div className="flex gap-2">
            {[{ id: 'line', label: 'Line only (0,0,200)' }, { id: 'sea', label: 'Sea pixels (0,0,255)' }].map(opt => (
              <label key={opt.id} className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="coastMode" value={opt.id} checked={mode === opt.id} onChange={() => setMode(opt.id)} className="accent-blue-400" />
                <span className={`text-[9px] ${mode === opt.id ? 'text-blue-300' : 'text-slate-500'}`}>{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Line width */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 shrink-0">Width</span>
            <input type="range" min={1} max={8} value={lineWidth}
              onChange={e => setLineWidth(Number(e.target.value))}
              className="flex-1 accent-blue-400 h-1" />
            <span className="text-[9px] font-mono text-amber-300 w-3">{lineWidth}</span>
          </div>

          {/* Status */}
          {status && (
            <p className={`text-[9px] px-2 py-1 rounded border ${
              status.startsWith('✓') ? 'bg-green-900/20 border-green-600/30 text-green-400'
              : status.startsWith('Error') ? 'bg-red-900/20 border-red-600/30 text-red-400'
              : 'bg-blue-900/20 border-blue-600/30 text-blue-300'
            }`}>{status}</p>
          )}

          {/* Buttons */}
          <button
            onClick={fetchCoastline}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold bg-blue-800 border-blue-600 text-white hover:bg-blue-700"
          >
            <Waves className={`w-3 h-3 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? 'Fetching…' : chainCount !== null ? '↺ Re-fetch Coastline' : 'Fetch Coastline'}
          </button>

          {chainsRef.current && (
            <>
              <button
                onClick={applyToHeights}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors font-semibold bg-green-800 border-green-600 text-white hover:bg-green-700"
              >
                ✓ Apply to Heights Layer
              </button>
              <button
                onClick={downloadMask}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors font-semibold bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
              >
                <Download className="w-3 h-3" /> Download Coastline Mask (PNG)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}