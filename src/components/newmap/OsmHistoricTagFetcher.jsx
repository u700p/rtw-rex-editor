import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Eye, EyeOff } from 'lucide-react';

// ── Historic tags to fetch ───────────────────────────────────────────────────
const HISTORIC_TAGS = [
  { key: 'historic', value: 'castle',      label: 'Castle',         desc: 'A (former) castle, fortress or palace.' },
  { key: 'historic', value: 'caravanserai',label: 'Caravanserai',   desc: 'Roadside inn along trade routes.' },
  { key: 'historic', value: 'church',      label: 'Historic Church',desc: 'A church building of historic importance.' },
  { key: 'historic', value: 'city_wall',   label: 'City Walls',     desc: 'Walls encircling a settlement for defence.' },
  { key: 'historic', value: 'fort',        label: 'Fort',           desc: 'A military fortification.' },
  { key: 'historic', value: 'mine',        label: 'Historic Mine',  desc: 'A historic mine.' },
  { key: 'historic', value: 'monastery',   label: 'Monastery',      desc: 'A historic monastery, convent or abbey.' },
  { key: 'historic', value: 'mosque',      label: 'Historic Mosque',desc: 'A mosque of historic significance.' },
  { key: 'historic', value: 'road',        label: 'Historic Road',  desc: 'A historic road or track.' },
  { key: 'historic', value: 'temple',      label: 'Temple',         desc: 'A historic temple.' },
  { key: 'historic', value: 'tower',       label: 'Historic Tower', desc: 'A tower of historic interest.' },
];

const CASTLE_TYPE_TAGS = [
  { key: 'castle_type', value: 'defensive', label: 'Defensive Castle', desc: 'Built primarily for military defence.' },
  { key: 'castle_type', value: 'palace',    label: 'Palace',           desc: 'A castle that is also a palace.' },
  { key: 'castle_type', value: 'stately',   label: 'Stately Home',     desc: 'A large country house of historic significance.' },
  { key: 'castle_type', value: 'manor',     label: 'Manor House',      desc: 'A manor house.' },
  { key: 'castle_type', value: 'kremlin',   label: 'Kremlin',          desc: 'A Russian fortified complex.' },
  { key: 'castle_type', value: 'fortress',  label: 'Fortress',         desc: 'A large fortified military complex.' },
  { key: 'castle_type', value: 'castrum',   label: 'Castrum',          desc: 'A Roman military camp or fort.' },
  { key: 'castle_type', value: 'hill_fort', label: 'Hill Fort',        desc: 'An Iron Age fortified settlement on a hilltop.' },
  { key: 'castle_type', value: 'citadel',   label: 'Citadel',          desc: 'A fortified core of a city.' },
  { key: 'castle_type', value: 'watchtower',label: 'Watchtower',       desc: 'A tower used for observation.' },
];

const ALL_TAG_GROUPS = [
  { group: 'Historic', tags: HISTORIC_TAGS },
  { group: 'Castle Types (castle_type=*)', tags: CASTLE_TYPE_TAGS },
];

// Generate a stable deterministic RGB from tag key+value
function tagColor(key, value) {
  let hash = 0;
  for (const c of `${key}=${value}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const h = hash % 360;
  const s = 65, l = 60;
  const a = s * Math.min(l, 100 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a / 100 * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}

const OSM_OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function fetchElements(key, value, bboxStr) {
  const query = `[out:json][timeout:180][maxsize:536870912];\n(\n  node["${key}"="${value}"](${bboxStr});\n  way["${key}"="${value}"](${bboxStr});\n  relation["${key}"="${value}"](${bboxStr});\n);\nout geom;`;
  let lastErr;
  for (const mirror of OSM_OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST', mode: 'cors',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 429 || res.status === 504) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.elements || [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('All mirrors failed');
}

function latToMercN(lat) {
  return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2));
}

/**
 * Get the representative lat/lon of an element (centroid for ways/relations).
 */
function elementCentroid(el) {
  if (el.type === 'node' && el.lat != null) return { lat: el.lat, lon: el.lon };
  const pts = el.type === 'way' ? (el.geometry || [])
    : (el.type === 'relation'
        ? (el.members || []).flatMap(m => m.geometry || [])
        : []);
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

/**
 * Convert lat/lon to pixel coords using Mercator projection.
 * Returns integer { px, py } or null if out-of-bounds.
 */
function latLonToPixel(lat, lon, bbox, W, H) {
  const mercNorth = latToMercN(bbox.north);
  const mercSouth = latToMercN(bbox.south);
  const px = Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (W - 1));
  const py = Math.round(((mercNorth - latToMercN(lat)) / (mercNorth - mercSouth)) * (H - 1));
  if (px < 0 || py < 0 || px >= W || py >= H) return null;
  return { px, py };
}

/**
 * Render elements to a pixel-perfect ImageData (mapW × mapH).
 * Each feature is a single pixel (or small cross for visibility).
 * Returns { imageData, points: [{px, py, name, type}] }
 */
function renderToImageData(elements, bbox, mapW, mapH, color) {
  const imageData = new ImageData(mapW, mapH);
  const [r, g, b] = color;
  const points = [];

  const setPixel = (px, py) => {
    if (px < 0 || py < 0 || px >= mapW || py >= mapH) return;
    const i = (py * mapW + px) * 4;
    imageData.data[i] = r; imageData.data[i + 1] = g; imageData.data[i + 2] = b; imageData.data[i + 3] = 255;
  };

  for (const el of elements) {
    const center = elementCentroid(el);
    if (!center) continue;
    const pos = latLonToPixel(center.lat, center.lon, bbox, mapW, mapH);
    if (!pos) continue;
    const { px, py } = pos;

    // Single pixel dot at exact coordinates
    setPixel(px, py);

    const name = el.tags?.name || el.tags?.['name:en'] || '';
    points.push({ px, py, name, osmId: el.id });
  }

  return { imageData, points };
}

function imageDataToDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; a.click();
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OsmHistoricTagFetcher({ bbox, mapW, mapH, onAssetReady, onToggleOverlay, visibleOverlays = {} }) {
  // tagStates: key → { status, count, imageData, points, color }
  const [tagStates, setTagStates] = useState({});
  const [fetchProgress, setFetchProgress] = useState({});
  const [expanded, setExpanded] = useState(true);
  const [openGroups, setOpenGroups] = useState({});
  const [search, setSearch] = useState('');

  const bboxStr = bbox ? `${bbox.south},${bbox.west},${bbox.north},${bbox.east}` : '';
  const getKey = t => `${t.key}=${t.value}`;

  const anyRunning = Object.values(tagStates).some(s => s?.status === 'running');

  const fetchTag = async (tag) => {
    if (!bbox || !mapW || !mapH) return;
    const k = getKey(tag);
    const color = tagColor(tag.key, tag.value);
    setTagStates(s => ({ ...s, [k]: { ...s[k], status: 'running', color } }));
    setFetchProgress(p => ({ ...p, [k]: 0 }));

    let pct = 0;
    const interval = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8 + 2, 90);
      setFetchProgress(p => ({ ...p, [k]: pct }));
    }, 300);

    try {
      const elements = await fetchElements(tag.key, tag.value, bboxStr);
      clearInterval(interval);
      setFetchProgress(p => ({ ...p, [k]: 100 }));
      const { imageData, points } = renderToImageData(elements, bbox, mapW, mapH, color);
      const newState = { status: 'done', count: elements.length, imageData, points, color, label: tag.label };
      setTagStates(s => {
        const next = { ...s, [k]: newState };
        // Register individual PNG asset
        if (onAssetReady) {
          onAssetReady({
            filename: `${k.replace('=', '_')}.png`,
            type: 'png',
            getData: () => imageDataToDataUrl(imageData),
          });
          // Re-register bulk TXT with all done states so far
          const allDone = Object.entries(next).filter(([, st]) => st?.status === 'done');
          const lines = ['; OSM Historic Features — Bulk Export', `; Map size: ${mapW}x${mapH}`, ''];
          allDone.forEach(([dk, ds]) => {
            lines.push(`; === ${ds.label} (${dk}) — ${ds.count} features ===`);
            (ds.points || []).forEach(p => {
              const name = p.name ? `"${p.name}"` : '"(no name)"';
              lines.push(`${ds.label}; x${p.px}; y${p.py}; name: ${name}`);
            });
            lines.push('');
          });
          onAssetReady({
            filename: 'historic_features.txt',
            type: 'txt',
            getData: () => lines.join('\n'),
          });
        }
        return next;
      });
    } catch (e) {
      clearInterval(interval);
      setFetchProgress(p => ({ ...p, [k]: 0 }));
      setTagStates(s => ({ ...s, [k]: { ...s[k], status: `error: ${e.message}` } }));
    }
  };

  const downloadTag = (k, label) => {
    const st = tagStates[k];
    if (!st?.imageData) return;
    const dataUrl = imageDataToDataUrl(st.imageData);
    downloadDataUrl(dataUrl, `${k.replace('=', '_')}.png`);
  };

  const doneStates = Object.entries(tagStates).filter(([, s]) => s?.status === 'done');
  const doneCount = doneStates.length;

  const downloadAll = () => {
    if (!doneStates.length) return;
    // Download each PNG
    doneStates.forEach(([k, s]) => {
      const dataUrl = imageDataToDataUrl(s.imageData);
      downloadDataUrl(dataUrl, `${k.replace('=', '_')}.png`);
    });
    // Build bulk TXT: one entry per feature point across all tags
    const lines = ['; OSM Historic Features — Bulk Export', `; Map size: ${mapW}x${mapH}`, ''];
    doneStates.forEach(([k, s]) => {
      lines.push(`; === ${s.label} (${k}) — ${s.count} features ===`);
      (s.points || []).forEach(p => {
        const name = p.name ? `"${p.name}"` : '"(no name)"';
        lines.push(`${s.label}; x${p.px}; y${p.py}; name: ${name}`);
      });
      lines.push('');
    });
    downloadText(lines.join('\n'), 'historic_features.txt');
  };

  const searchLower = search.toLowerCase();
  const filteredGroups = ALL_TAG_GROUPS.map(g => ({
    ...g,
    tags: search ? g.tags.filter(t =>
      t.label.toLowerCase().includes(searchLower) ||
      t.key.includes(searchLower) ||
      t.value.includes(searchLower) ||
      t.desc.toLowerCase().includes(searchLower)
    ) : g.tags,
  })).filter(g => g.tags.length > 0);

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] text-slate-300 font-semibold hover:bg-slate-800/60 transition-colors">
        <span className="flex items-center gap-1.5">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          OSM Historic Features
        </span>
        {doneCount > 0 && (
          <span className="text-[9px] bg-amber-600/30 text-amber-400 px-1.5 py-0.5 rounded">
            {doneCount} fetched
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-700/50">
          <p className="text-[9px] text-slate-500 pt-1.5 leading-relaxed">
            Fetch OSM historic features as pixel-perfect transparent PNG layers sized exactly to your regions map. Download individually or bulk-export all PNGs + a coordinate text file.
          </p>

          {/* Bulk download */}
          {doneCount > 0 && (
            <button
              onClick={downloadAll}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-green-800/40 border border-green-600/50 text-green-300 hover:bg-green-700/50 transition-colors font-semibold">
              <Download className="w-3 h-3" />
              Download All ({doneCount}) — PNGs + historic_features.txt
            </button>
          )}

          {/* Search */}
          <input
            placeholder="Search tags…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-amber-500"
          />

          {/* Tag groups */}
          <div className="space-y-1">
            {filteredGroups.map(g => (
              <div key={g.group} className="rounded border border-slate-700/60 overflow-hidden">
                <button
                  onClick={() => setOpenGroups(s => ({ ...s, [g.group]: !s[g.group] }))}
                  className="w-full flex items-center justify-between px-2 py-1 bg-slate-800/60 hover:bg-slate-700/60 transition-colors">
                  <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{g.group}</span>
                  <span className="flex items-center gap-1.5">
                    {g.tags.filter(t => tagStates[getKey(t)]?.status === 'done').length > 0 && (
                      <span className="text-[8px] text-green-400">
                        {g.tags.filter(t => tagStates[getKey(t)]?.status === 'done').length} ✓
                      </span>
                    )}
                    {openGroups[g.group] ? <ChevronDown className="w-2.5 h-2.5 text-slate-500" /> : <ChevronRight className="w-2.5 h-2.5 text-slate-500" />}
                  </span>
                </button>

                {openGroups[g.group] && (
                  <div className="divide-y divide-slate-800">
                    {g.tags.map(tag => {
                      const k = getKey(tag);
                      const st = tagStates[k];
                      const isRunning = st?.status === 'running';
                      const isDone = st?.status === 'done';
                      const isErr = st?.status?.startsWith('error');
                      const color = tagColor(tag.key, tag.value);
                      const colorCss = `rgb(${color[0]},${color[1]},${color[2]})`;

                      return (
                        <div key={k} className="bg-slate-900">
                          {isRunning && (
                            <div className="mx-1.5 mt-1">
                              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                  style={{ width: `${fetchProgress[k] ?? 0}%` }} />
                              </div>
                              <p className="text-[8px] text-blue-400 mt-0.5">Fetching… {Math.round(fetchProgress[k] ?? 0)}%</p>
                            </div>
                          )}

                          <div className="flex items-start gap-1.5 px-1.5 py-1.5">
                            <div className="w-3 h-3 rounded-sm shrink-0 mt-0.5 border border-slate-600" style={{ backgroundColor: colorCss }} />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-slate-200 font-semibold">{tag.label}</span>
                                <span className="text-[8px] font-mono text-slate-600">{k}</span>
                                {isDone && (
                                  <span className="text-[8px] text-green-400 font-mono">
                                    ✓ {st.count} feat / {st.points?.length ?? 0} placed
                                  </span>
                                )}
                                {isErr && <span className="text-[8px] text-red-400">✕ err</span>}
                              </div>
                              <p className="text-[8px] text-slate-500 leading-relaxed mt-0.5 line-clamp-2">{tag.desc}</p>
                            </div>

                            {/* Show/hide on map */}
                            {isDone && onToggleOverlay && (
                             <button
                               onClick={() => onToggleOverlay(k, st.imageData)}
                               title={visibleOverlays[k] ? 'Hide on map' : 'Show on map'}
                               className={`shrink-0 flex items-center justify-center w-5 h-5 rounded transition-colors ${
                                 visibleOverlays[k]
                                   ? 'bg-amber-700/60 text-amber-300 hover:bg-amber-600/60'
                                   : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600 hover:text-white'
                               }`}>
                               {visibleOverlays[k] ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                             </button>
                            )}

                            {/* Download PNG */}
                            {isDone && (
                             <button
                               onClick={() => downloadTag(k, tag.label)}
                               title={`Download ${k} as PNG`}
                               className="shrink-0 flex items-center justify-center w-5 h-5 rounded bg-slate-700/60 text-slate-400 hover:bg-slate-600 hover:text-white transition-colors">
                               <Download className="w-2.5 h-2.5" />
                             </button>
                            )}

                            {/* Fetch button */}
                            <button
                              onClick={() => fetchTag(tag)}
                              disabled={anyRunning || !bbox || !mapW}
                              title={isDone ? 'Re-fetch' : 'Fetch from OSM'}
                              className={`shrink-0 flex items-center justify-center w-5 h-5 rounded transition-colors disabled:opacity-30 text-[8px] font-bold ${
                                isDone ? 'bg-green-800/40 text-green-300 hover:bg-green-700/50' :
                                isErr  ? 'bg-red-800/40 text-red-300 hover:bg-red-700/50' :
                                         'bg-blue-800/40 text-blue-300 hover:bg-blue-700/50'
                              }`}>
                              {isRunning ? <span className="animate-spin">↻</span> : isDone ? '↺' : '↓'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!bbox && <p className="text-[9px] text-slate-600 italic">No bounding box — go back to area selection.</p>}
          {bbox && !mapW && <p className="text-[9px] text-slate-600 italic">Set map resolution first.</p>}
        </div>
      )}
    </div>
  );
}