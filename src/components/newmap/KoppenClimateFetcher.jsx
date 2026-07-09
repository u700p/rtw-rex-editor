import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { CLIMATE_PALETTE, hexToRgb } from '@/lib/mapLayerStore';

/**
 * All Köppen-Geiger climate zones with their default M2TW climate mapping.
 * koppen.earth returns a GeoTIFF/PNG whose pixels are indexed by zone code.
 * We fetch a tile-based PNG snapshot and map each pixel's zone to an M2TW climate color.
 */
const KOPPEN_ZONES = [
  // Tropical
  { code: 'Af',  label: 'Tropical Rainforest',             group: 'Tropical (A)',   defaultClimate: 'tropical' },
  { code: 'Am',  label: 'Tropical Monsoon',                group: 'Tropical (A)',   defaultClimate: 'tropical' },
  { code: 'Aw',  label: 'Tropical Savanna',                group: 'Tropical (A)',   defaultClimate: 'tropical' },
  { code: 'As',  label: 'Tropical Savanna (Dry Summer)',   group: 'Tropical (A)',   defaultClimate: 'tropical' },
  // Arid
  { code: 'BWh', label: 'Hot Desert',                      group: 'Arid (B)',       defaultClimate: 'sandy_desert' },
  { code: 'BWk', label: 'Cold Desert',                     group: 'Arid (B)',       defaultClimate: 'rocky_desert' },
  { code: 'BSh', label: 'Hot Steppe',                      group: 'Arid (B)',       defaultClimate: 'steppe' },
  { code: 'BSk', label: 'Cold Steppe',                     group: 'Arid (B)',       defaultClimate: 'steppe' },
  // Temperate
  { code: 'Csa', label: 'Mediterranean (Hot Summer)',      group: 'Temperate (C)',  defaultClimate: 'mediterranean' },
  { code: 'Csb', label: 'Mediterranean (Warm Summer)',     group: 'Temperate (C)',  defaultClimate: 'mediterranean' },
  { code: 'Csc', label: 'Mediterranean (Cold Summer)',     group: 'Temperate (C)',  defaultClimate: 'mediterranean' },
  { code: 'Cwa', label: 'Humid Subtropical (Dry Winter)',  group: 'Temperate (C)',  defaultClimate: 'tropical' },
  { code: 'Cwb', label: 'Subtropical Highland (Dry Winter)',group:'Temperate (C)',  defaultClimate: 'highland' },
  { code: 'Cwc', label: 'Subpolar Oceanic (Dry Winter)',   group: 'Temperate (C)',  defaultClimate: 'highland' },
  { code: 'Cfa', label: 'Humid Subtropical',               group: 'Temperate (C)',  defaultClimate: 'temperate_grassland' },
  { code: 'Cfb', label: 'Oceanic',                         group: 'Temperate (C)',  defaultClimate: 'temperate_deciduous' },
  { code: 'Cfc', label: 'Subpolar Oceanic',                group: 'Temperate (C)',  defaultClimate: 'temperate_coniferous' },
  // Continental
  { code: 'Dsa', label: 'Mediterranean Continental (Hot Summer)',   group: 'Continental (D)', defaultClimate: 'mediterranean' },
  { code: 'Dsb', label: 'Mediterranean Continental (Warm Summer)',  group: 'Continental (D)', defaultClimate: 'mediterranean' },
  { code: 'Dsc', label: 'Mediterranean Continental (Cold Summer)',  group: 'Continental (D)', defaultClimate: 'steppe' },
  { code: 'Dsd', label: 'Mediterranean Continental (Very Cold)',    group: 'Continental (D)', defaultClimate: 'alpine' },
  { code: 'Dwa', label: 'Monsoon Continental (Hot Summer)',         group: 'Continental (D)', defaultClimate: 'temperate_grassland' },
  { code: 'Dwb', label: 'Monsoon Continental (Warm Summer)',        group: 'Continental (D)', defaultClimate: 'temperate_deciduous' },
  { code: 'Dwc', label: 'Monsoon Continental (Cold Summer)',        group: 'Continental (D)', defaultClimate: 'temperate_coniferous' },
  { code: 'Dwd', label: 'Monsoon Continental (Very Cold)',          group: 'Continental (D)', defaultClimate: 'alpine' },
  { code: 'Dfa', label: 'Humid Continental (Hot Summer)',           group: 'Continental (D)', defaultClimate: 'temperate_grassland' },
  { code: 'Dfb', label: 'Humid Continental (Warm Summer)',          group: 'Continental (D)', defaultClimate: 'temperate_deciduous' },
  { code: 'Dfc', label: 'Subarctic',                                group: 'Continental (D)', defaultClimate: 'temperate_coniferous' },
  { code: 'Dfd', label: 'Subarctic (Severe Winter)',                group: 'Continental (D)', defaultClimate: 'alpine' },
  // Polar
  { code: 'ET',  label: 'Tundra',                          group: 'Polar (E)',      defaultClimate: 'alpine' },
  { code: 'EF',  label: 'Ice Cap',                         group: 'Polar (E)',      defaultClimate: 'alpine' },
];

// koppen.earth pixel RGB values for each zone (from their published legend)
// Source: https://koppen.earth legend PNG
const KOPPEN_RGB = {
  Af:  [0,   0,   255], Am:  [0,   120, 255], Aw:  [70,  170, 250], As:  [112, 168, 0],
  BWh: [255, 0,   0  ], BWk: [255, 150, 150], BSh: [245, 165, 0  ], BSk: [255, 220, 100],
  Csa: [255, 255, 0  ], Csb: [200, 200, 0  ], Csc: [150, 150, 0  ],
  Cwa: [150, 255, 150], Cwb: [100, 200, 100], Cwc: [50,  150, 50 ],
  Cfa: [200, 255, 80 ], Cfb: [100, 255, 80 ], Cfc: [50,  200, 50 ],
  Dsa: [255, 0,    255], Dsb: [200, 0,    200], Dsc: [150, 50, 150 ], Dsd: [150, 100, 150],
  Dwa: [170, 175, 255], Dwb: [90,  120, 220], Dwc: [75,  80,  180], Dwd: [50,  0,   135],
  Dfa: [0,   255, 255], Dfb: [55,  200, 255], Dfc: [0,   125, 125], Dfd: [0,   70,  95 ],
  ET:  [178, 178, 178], EF:  [102, 102, 102],
};

const GROUPS = [...new Set(KOPPEN_ZONES.map(z => z.group))];

const CLIMATE_COLOR = Object.fromEntries(CLIMATE_PALETTE.map(p => [p.id, p.color]));
const CLIMATE_LABEL = Object.fromEntries(CLIMATE_PALETTE.map(p => [p.id, p.label]));

// Euclidean RGB distance for nearest-neighbor matching
function rgbDist(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

// Match a pixel's RGB to the closest Köppen zone
function matchKoppen(r, g, b, threshold = 40) {
  let best = null, bestD = Infinity;
  for (const [code, rgb] of Object.entries(KOPPEN_RGB)) {
    const d = rgbDist([r, g, b], rgb);
    if (d < bestD) { bestD = d; best = code; }
  }
  return bestD <= threshold ? best : null;
}

function latToMercN(lat) {
  return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
}

export default function KoppenClimateFetcher({ bbox, climateLayer, onLayerUpdate, mapWidth, mapHeight }) {
  const [expanded, setExpanded] = useState(false);
  const [zoneMap, setZoneMap] = useState(() =>
    Object.fromEntries(KOPPEN_ZONES.map(z => [z.code, z.defaultClimate]))
  );
  const [openGroups, setOpenGroups] = useState({});
  const [status, setStatus] = useState('');
  const [fetching, setFetching] = useState(false);
  const [hiddenZones, setHiddenZones] = useState(new Set());
  const climateLayerRef = useRef(climateLayer);
  useEffect(() => { climateLayerRef.current = climateLayer; }, [climateLayer]);

  const toggleGroup = (g) => setOpenGroups(s => ({ ...s, [g]: !s[g] }));

  const fetchAndApply = async () => {
    if (!bbox) { setStatus('No bounding box defined.'); return; }
    setFetching(true);
    setStatus('Fetching Köppen data from koppen.earth…');

    try {
      // koppen.earth provides a tile-based map; we request their WMS/tile endpoint
      // for the bbox at a resolution matching our map canvas
      const W = mapWidth, H = mapHeight;
      const url = `https://koppen.earth/map?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&width=${W}&height=${H}&format=png`;

      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status} from koppen.earth`);

      const blob = await res.blob();
      const imgUrl = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const i = new Image(); i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i); i.onerror = reject;
        i.src = imgUrl;
      });

      applyKoppenImage(img, W, H);
      URL.revokeObjectURL(imgUrl);
    } catch (e) {
      // Fallback: use OSM tile proxy or CORS proxy
      setStatus(`Direct fetch failed (${e.message}). Trying tile proxy…`);
      await fetchViaTiles();
    }
  };

  const fetchViaTiles = async () => {
    // koppen.earth uses standard XYZ tiles at zoom 6
    const ZOOM = 6;
    const lat2tile = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, ZOOM));
    const lon2tile = (lon) => Math.floor((lon + 180) / 360 * Math.pow(2, ZOOM));

    const xMin = lon2tile(bbox.west), xMax = lon2tile(bbox.east);
    const yMin = lat2tile(bbox.north), yMax = lat2tile(bbox.south);
    const totalTiles = (xMax - xMin + 1) * (yMax - yMin + 1);

    if (totalTiles > 64) {
      setStatus(`Area too large for tile fetch (${totalTiles} tiles). Try a smaller bbox.`);
      setFetching(false);
      return;
    }

    // Build a canvas covering the full bbox tiled extent
    const TILE_SIZE = 256;
    const cols = xMax - xMin + 1, rows = yMax - yMin + 1;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = cols * TILE_SIZE; tileCanvas.height = rows * TILE_SIZE;
    const tileCtx = tileCanvas.getContext('2d');

    let done = 0;
    for (let tx = xMin; tx <= xMax; tx++) {
      for (let ty = yMin; ty <= yMax; ty++) {
        const tileUrl = `https://koppen.earth/tiles/${ZOOM}/${tx}/${ty}.png`;
        try {
          const img = await new Promise((resolve, reject) => {
            const i = new Image(); i.crossOrigin = 'anonymous';
            i.onload = () => resolve(i); i.onerror = reject;
            i.src = tileUrl;
          });
          tileCtx.drawImage(img, (tx - xMin) * TILE_SIZE, (ty - yMin) * TILE_SIZE);
        } catch { /* skip missing tiles */ }
        done++;
        setStatus(`Loading tiles… ${done}/${totalTiles}`);
      }
    }

    // Compute the sub-region within the tiled canvas that corresponds to our bbox
    const tile2lon = (x) => x / Math.pow(2, ZOOM) * 360 - 180;
    const tile2lat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, ZOOM)))) * 180 / Math.PI;

    const canvasWest = tile2lon(xMin), canvasEast = tile2lon(xMax + 1);
    const canvasNorth = tile2lat(yMin), canvasSouth = tile2lat(yMax + 1);

    const sx = Math.round(((bbox.west - canvasWest) / (canvasEast - canvasWest)) * tileCanvas.width);
    const sy = Math.round(((canvasNorth - bbox.north) / (canvasNorth - canvasSouth)) * tileCanvas.height);
    const sw = Math.round(((bbox.east - bbox.west) / (canvasEast - canvasWest)) * tileCanvas.width);
    const sh = Math.round(((bbox.north - bbox.south) / (canvasNorth - canvasSouth)) * tileCanvas.height);

    // Draw cropped region scaled to our map dimensions
    const outCanvas = document.createElement('canvas');
    outCanvas.width = mapWidth; outCanvas.height = mapHeight;
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(tileCanvas, sx, sy, sw, sh, 0, 0, mapWidth, mapHeight);

    const img = new Image();
    img.onload = () => applyKoppenImage(img, mapWidth, mapHeight);
    img.src = outCanvas.toDataURL();
  };

  const applyKoppenImage = (img, W, H) => {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.drawImage(img, 0, 0, W, H);
    const srcData = srcCtx.getImageData(0, 0, W, H);

    // Target: climates layer (may be 2×+1 scaled)
    const cW = mapWidth * 2 + 1, cH = mapHeight * 2 + 1;
    const base = climateLayerRef.current?.imageData;
    const out = base
      ? new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
      : new ImageData(cW, cH);

    let painted = 0;
    for (let cy = 0; cy < cH; cy++) {
      for (let cx = 0; cx < cW; cx++) {
        // Map climate pixel → source pixel
        const sx = Math.round((cx / (cW - 1)) * (W - 1));
        const sy = Math.round((cy / (cH - 1)) * (H - 1));
        const si = (sy * W + sx) * 4;
        const r = srcData.data[si], g = srcData.data[si + 1], b = srcData.data[si + 2], a = srcData.data[si + 3];
        if (a < 10) continue; // transparent = sea/unmapped

        const code = matchKoppen(r, g, b);
        if (!code) continue;
        if (hiddenZones.has(code)) continue;

        const climId = zoneMap[code] ?? 'temperate_grassland';
        const hex = CLIMATE_COLOR[climId] ?? '#ed145b';
        const { r: cr, g: cg, b: cb } = hexToRgb(hex);

        const oi = (cy * cW + cx) * 4;
        out.data[oi] = cr; out.data[oi + 1] = cg; out.data[oi + 2] = cb; out.data[oi + 3] = 255;
        painted++;
      }
    }

    onLayerUpdate('climates', { imageData: out, visible: true, opacity: 1, dirty: true });
    setStatus(`Done — painted ${painted.toLocaleString()} pixels from Köppen data.`);
    setFetching(false);
  };

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] text-slate-300 font-semibold hover:bg-slate-800/60 transition-colors">
        <span className="flex items-center gap-1.5">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Köppen Climate Fetch
        </span>
        <span className="text-[9px] text-slate-500">koppen.earth</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-700/50">
          <p className="text-[9px] text-slate-500 pt-1.5 leading-relaxed">
            Fetch Köppen-Geiger climate zones from <span className="text-slate-300">koppen.earth</span> and map each zone to an M2TW climate. Then click Apply to paint the climates layer.
          </p>

          {/* Zone mapping list */}
          <div className="space-y-1">
            {GROUPS.map(group => (
              <div key={group} className="rounded border border-slate-700/60 overflow-hidden">
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center justify-between px-2 py-1 bg-slate-800/60 hover:bg-slate-700/60 transition-colors">
                  <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{group}</span>
                  {openGroups[group] ? <ChevronDown className="w-2.5 h-2.5 text-slate-500" /> : <ChevronRight className="w-2.5 h-2.5 text-slate-500" />}
                </button>

                {openGroups[group] && (
                  <div className="divide-y divide-slate-800">
                    {KOPPEN_ZONES.filter(z => z.group === group).map(zone => {
                      const climId = zoneMap[zone.code];
                      const isHidden = hiddenZones.has(zone.code);
                      return (
                        <div key={zone.code} className="flex items-center gap-1.5 px-1.5 py-1 bg-slate-900">
                          {/* Köppen pixel color swatch */}
                          <div
                            className="w-3 h-3 rounded-sm shrink-0 border border-slate-700"
                            style={{ backgroundColor: `rgb(${KOPPEN_RGB[zone.code]?.join(',') ?? '128,128,128'})` }}
                            title={`Köppen pixel color for ${zone.code}`}
                          />
                          <span className="text-[9px] font-mono text-slate-500 w-7 shrink-0">{zone.code}</span>
                          <span className="text-[9px] text-slate-300 flex-1 truncate">{zone.label}</span>
                          {/* Arrow */}
                          <span className="text-[9px] text-slate-600">→</span>
                          {/* M2TW climate color swatch */}
                          <div
                            className="w-3 h-3 rounded-sm shrink-0 border border-slate-600"
                            style={{ backgroundColor: CLIMATE_COLOR[climId] ?? '#888' }}
                          />
                          {/* Climate selector */}
                          <select
                            value={climId}
                            onChange={e => setZoneMap(m => ({ ...m, [zone.code]: e.target.value }))}
                            className="h-5 text-[9px] bg-slate-800 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-amber-500 max-w-[100px]">
                            {CLIMATE_PALETTE.map(p => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                          {/* Visibility toggle */}
                          <button
                            onClick={() => setHiddenZones(prev => {
                              const next = new Set(prev);
                              if (next.has(zone.code)) next.delete(zone.code); else next.add(zone.code);
                              return next;
                            })}
                            title={isHidden ? 'Include zone' : 'Exclude zone'}
                            className={`shrink-0 ${isHidden ? 'text-slate-600' : 'text-slate-400'} hover:text-white transition-colors`}>
                            {isHidden ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Reset defaults */}
          <button
            onClick={() => setZoneMap(Object.fromEntries(KOPPEN_ZONES.map(z => [z.code, z.defaultClimate])))}
            className="text-[9px] px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 border border-slate-600 transition-colors">
            Reset to Defaults
          </button>

          {/* Status */}
          {status && (
            <p className={`text-[9px] leading-snug ${status.startsWith('Done') ? 'text-green-400' : status.includes('failed') || status.includes('error') ? 'text-red-400' : 'text-amber-400'}`}>
              {status}
            </p>
          )}

          {/* Apply button */}
          <button
            onClick={fetchAndApply}
            disabled={fetching || !bbox}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
            <Download className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
            {fetching ? status || 'Fetching…' : 'Fetch & Apply Köppen Data'}
          </button>

          {!bbox && <p className="text-[9px] text-slate-600 italic">No bounding box — go back to area selection.</p>}
        </div>
      )}
    </div>
  );
}