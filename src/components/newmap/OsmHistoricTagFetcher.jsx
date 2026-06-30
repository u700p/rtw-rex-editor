import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';

// ── Historic tags to fetch ───────────────────────────────────────────────────
// Each entry: OSM key, value, human label, OSM wiki description
const HISTORIC_TAGS = [
  {
    key: 'historic', value: 'castle',
    label: 'Castle',
    desc: 'A (former) castle, fortress or palace. Castles are (often fortified) palaces and political centers.',
  },
  {
    key: 'historic', value: 'caravanserai',
    label: 'Caravanserai',
    desc: 'A roadside inn where travellers could rest and recover along trade routes (Silk Road, etc.).',
  },
  {
    key: 'historic', value: 'church',
    label: 'Historic Church',
    desc: 'A church building of historic importance, typically pre-modern.',
  },
  {
    key: 'historic', value: 'city_wall',
    label: 'City Walls',
    desc: 'Walls (often medieval) encircling a settlement for defensive purposes.',
  },
  {
    key: 'historic', value: 'fort',
    label: 'Fort',
    desc: 'A military fortification, smaller than a castle, often built for a specific defensive purpose.',
  },
  {
    key: 'historic', value: 'mine',
    label: 'Historic Mine',
    desc: 'A historic mine — no longer active, preserved as a heritage site.',
  },
  {
    key: 'historic', value: 'monastery',
    label: 'Monastery',
    desc: 'A historic monastery, convent or abbey — a community of monks or nuns.',
  },
  {
    key: 'historic', value: 'mosque',
    label: 'Historic Mosque',
    desc: 'A mosque of historic significance, typically pre-modern.',
  },
  {
    key: 'historic', value: 'road',
    label: 'Historic Road',
    desc: 'A historic road or track, often of Roman or medieval origin.',
  },
  {
    key: 'historic', value: 'temple',
    label: 'Temple',
    desc: 'A historic temple — used for pre-Christian/Islamic religious worship.',
  },
  {
    key: 'historic', value: 'tower',
    label: 'Historic Tower',
    desc: 'A (detached) tower that is predominantly of historic interest, such as a watchtower or signal tower.',
  },
];

// castle_type=* subtypes per OSM wiki
const CASTLE_TYPE_TAGS = [
  { key: 'castle_type', value: 'defensive',    label: 'Defensive Castle',   desc: 'A castle built primarily for military defence.' },
  { key: 'castle_type', value: 'palace',        label: 'Palace',             desc: 'A castle that is also a palace — a representative royal residence.' },
  { key: 'castle_type', value: 'stately',       label: 'Stately Home',       desc: 'A large country house of historic significance, seat of landed gentry.' },
  { key: 'castle_type', value: 'manor',         label: 'Manor House',        desc: 'A manor house — the principal residence of a lord of the manor.' },
  { key: 'castle_type', value: 'kremlin',       label: 'Kremlin',            desc: 'A Russian fortified complex, typically a citadel within a city.' },
  { key: 'castle_type', value: 'fortress',      label: 'Fortress',           desc: 'A large fortified military complex.' },
  { key: 'castle_type', value: 'castrum',       label: 'Castrum',            desc: 'A Roman military camp or fort.' },
  { key: 'castle_type', value: 'hill_fort',     label: 'Hill Fort',          desc: 'An Iron Age or earlier fortified settlement on a hilltop.' },
  { key: 'castle_type', value: 'ringfort',      label: 'Ringfort',           desc: 'An early medieval ringfort (rath/dún/lios) typical of Ireland.' },
  { key: 'castle_type', value: 'shiro',         label: 'Shiro (Japanese)',   desc: 'A Japanese castle (shiro/jo).' },
  { key: 'castle_type', value: 'citadel',       label: 'Citadel',            desc: 'A citadel — a fortified core of a city, often on high ground.' },
  { key: 'castle_type', value: 'watchtower',    label: 'Watchtower',         desc: 'A tower used for observation and signalling, often along borders.' },
];

const ALL_TAGS = [...HISTORIC_TAGS, ...CASTLE_TYPE_TAGS];

// Generate a stable random pastel colour from a tag key string
function tagColor(key, value) {
  let hash = 0;
  for (const c of `${key}=${value}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const h = hash % 360;
  // Convert HSL pastel to hex
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
  // For castle_type=*, fetch nodes+ways+relations that have that tag on historic=castle objects too
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
      return (json.elements || []);
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('All mirrors failed');
}

function latToMercN(lat) {
  return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2));
}

function renderToPng(elements, bbox, mapW, mapH, color) {
  const canvas = document.createElement('canvas');
  canvas.width = mapW; canvas.height = mapH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, mapW, mapH);

  const mercNorth = latToMercN(bbox.north);
  const mercSouth = latToMercN(bbox.south);
  const mercRange = mercNorth - mercSouth;

  const toXY = (lat, lon) => [
    ((lon - bbox.west) / (bbox.east - bbox.west)) * (mapW - 1),
    ((mercNorth - latToMercN(lat)) / mercRange) * (mapH - 1),
  ];

  const [r, g, b] = color;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.strokeStyle = `rgb(${r},${g},${b})`;

  for (const el of elements) {
    if (el.type === 'node' && el.lat != null) {
      const [x, y] = toXY(el.lat, el.lon);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (el.type === 'way' && el.geometry?.length > 1) {
      ctx.beginPath();
      el.geometry.forEach(({ lat, lon }, i) => {
        const [x, y] = toXY(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.geometry?.length > 1) {
          ctx.beginPath();
          m.geometry.forEach(({ lat, lon }, i) => {
            const [x, y] = toXY(lat, lon);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; a.click();
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OsmHistoricTagFetcher({ bbox, mapW, mapH }) {
  const [tagStates, setTagStates] = useState({}); // k → { status, count, dataUrl }
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
    setTagStates(s => ({ ...s, [k]: { ...s[k], status: 'running' } }));
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
      const dataUrl = renderToPng(elements, bbox, mapW, mapH, color);
      setTagStates(s => ({ ...s, [k]: { status: 'done', count: elements.length, dataUrl, color } }));
    } catch (e) {
      clearInterval(interval);
      setFetchProgress(p => ({ ...p, [k]: 0 }));
      setTagStates(s => ({ ...s, [k]: { ...s[k], status: `error: ${e.message}` } }));
    }
  };

  const groups = [
    { group: 'Historic', tags: HISTORIC_TAGS },
    { group: 'Castle Types (castle_type=*)', tags: CASTLE_TYPE_TAGS },
  ];

  const searchLower = search.toLowerCase();
  const filteredGroups = groups.map(g => ({
    ...g,
    tags: search ? g.tags.filter(t =>
      t.label.toLowerCase().includes(searchLower) ||
      t.key.includes(searchLower) ||
      t.value.includes(searchLower) ||
      t.desc.toLowerCase().includes(searchLower)
    ) : g.tags,
  })).filter(g => g.tags.length > 0);

  const doneCount = Object.values(tagStates).filter(s => s?.status === 'done').length;

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
            Fetch OSM historic features and download them as transparent PNG layers — one per tag, sized to your map. Use them as reference overlays alongside the regions map.
          </p>

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
                          {/* Progress bar */}
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
                            {/* Colour swatch (stable random colour for this tag) */}
                            <div className="w-3 h-3 rounded-sm shrink-0 mt-0.5 border border-slate-600" style={{ backgroundColor: colorCss }} />

                            {/* Label + key + description */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-slate-200 font-semibold">{tag.label}</span>
                                <span className="text-[8px] font-mono text-slate-600">{k}</span>
                                {isDone && (
                                  <span className="text-[8px] text-green-400 font-mono">✓ {st.count}</span>
                                )}
                                {isErr && (
                                  <span className="text-[8px] text-red-400">✕ err</span>
                                )}
                              </div>
                              <p className="text-[8px] text-slate-500 leading-relaxed mt-0.5 line-clamp-2">{tag.desc}</p>
                            </div>

                            {/* Download button — only when done */}
                            {isDone && (
                              <button
                                onClick={() => downloadDataUrl(st.dataUrl, `${k.replace('=', '_')}.png`)}
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