import React, { useState } from 'react';
import { Plus, Trash2, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { GROUND_TYPE_PALETTE } from '@/lib/mapLayerStore';
import { GT } from '@/lib/autoGroundTypes';

/**
 * OsmTagOverlayEditor
 * Lets the user define OSM tag → ground type rules.
 * Each rule fetches matching polygons from Overpass and paints them onto the ground layer.
 *
 * Supported tag groups: landuse, natural, leisure (extendable via OSM_TAG_OPTIONS)
 */

const GT_COLOR = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.color]));
const GT_LABEL = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.label]));

// Curated tag options with key/value and sensible default ground type
const OSM_TAG_OPTIONS = [
  // landuse
  { key: 'landuse', value: 'farmland',       label: 'Farmland',          defaultGt: 'fertile_high' },
  { key: 'landuse', value: 'farmyard',        label: 'Farmyard',          defaultGt: 'fertile_medium' },
  { key: 'landuse', value: 'meadow',          label: 'Meadow',            defaultGt: 'fertile_high' },
  { key: 'landuse', value: 'orchard',         label: 'Orchard',           defaultGt: 'fertile_high' },
  { key: 'landuse', value: 'vineyard',        label: 'Vineyard',          defaultGt: 'fertile_medium' },
  { key: 'landuse', value: 'forest',          label: 'Forest (landuse)',  defaultGt: 'forest_sparse' },
  { key: 'landuse', value: 'residential',     label: 'Residential',       defaultGt: 'fertile_low' },
  { key: 'landuse', value: 'industrial',      label: 'Industrial',        defaultGt: 'impassable_land' },
  { key: 'landuse', value: 'quarry',          label: 'Quarry',            defaultGt: 'mountains_low' },
  { key: 'landuse', value: 'cemetery',        label: 'Cemetery',          defaultGt: 'wilderness' },
  { key: 'landuse', value: 'allotments',      label: 'Allotments',        defaultGt: 'fertile_medium' },
  { key: 'landuse', value: 'village_green',   label: 'Village Green',     defaultGt: 'fertile_high' },
  { key: 'landuse', value: 'recreation_ground', label: 'Recreation Ground', defaultGt: 'fertile_low' },
  { key: 'landuse', value: 'wetland',         label: 'Wetland (landuse)', defaultGt: 'swamp' },
  // natural
  { key: 'natural', value: 'wood',            label: 'Wood',              defaultGt: 'forest_sparse' },
  { key: 'natural', value: 'scrub',           label: 'Scrub',             defaultGt: 'wilderness' },
  { key: 'natural', value: 'heath',           label: 'Heath',             defaultGt: 'wilderness' },
  { key: 'natural', value: 'grassland',       label: 'Grassland',         defaultGt: 'fertile_medium' },
  { key: 'natural', value: 'wetland',         label: 'Wetland (natural)', defaultGt: 'swamp' },
  { key: 'natural', value: 'beach',           label: 'Beach',             defaultGt: 'beach' },
  { key: 'natural', value: 'sand',            label: 'Sand / Dunes',      defaultGt: 'beach' },
  { key: 'natural', value: 'bare_rock',       label: 'Bare Rock',         defaultGt: 'mountains_high' },
  { key: 'natural', value: 'scree',           label: 'Scree',             defaultGt: 'mountains_low' },
  { key: 'natural', value: 'glacier',         label: 'Glacier',           defaultGt: 'mountains_high' },
  { key: 'natural', value: 'fell',            label: 'Fell',              defaultGt: 'hills' },
  { key: 'natural', value: 'moor',            label: 'Moor',              defaultGt: 'wilderness' },
  // leisure
  { key: 'leisure', value: 'park',            label: 'Park',              defaultGt: 'fertile_low' },
  { key: 'leisure', value: 'garden',          label: 'Garden',            defaultGt: 'fertile_high' },
  { key: 'leisure', value: 'nature_reserve',  label: 'Nature Reserve',    defaultGt: 'forest_sparse' },
  { key: 'leisure', value: 'golf_course',     label: 'Golf Course',       defaultGt: 'fertile_medium' },
];

const OSM_OVERPASS = 'https://overpass-api.de/api/interpreter';

// Fetch ALL rules in a single Overpass query, tagged with a synthetic tag so we can split results back.
// Returns Map<"key=value" → elements[]>
async function fetchAllPolygons(rules, bboxStr) {
  // Build a union query: one block per rule
  const blocks = rules.map(r =>
    `  way["${r.key}"="${r.value}"](${bboxStr});\n  relation["${r.key}"="${r.value}"](${bboxStr});`
  ).join('\n');

  const query = `[out:json][timeout:90];\n(\n${blocks}\n);\nout geom;`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    const res = await fetch(OSM_OVERPASS, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (res.status === 429 || res.status === 504) {
      lastErr = new Error(`HTTP ${res.status} — retrying…`);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Split elements back by their tags
    const byRule = new Map();
    for (const r of rules) byRule.set(`${r.key}=${r.value}`, []);

    for (const el of (json.elements || [])) {
      if (!el.tags) continue;
      for (const r of rules) {
        if (el.tags[r.key] === r.value) {
          byRule.get(`${r.key}=${r.value}`).push(el);
          break; // assign to first matching rule only
        }
      }
    }
    return byRule;
  }
  throw lastErr ?? new Error('Failed after retries');
}

function paintPolygonsOntoImageData(imageData, elements, bbox, color) {
  const { width, height, data } = imageData;
  const [r, g, b] = color;

  const toXY = (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1)),
    Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (height - 1)),
  ];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = `rgb(${r},${g},${b})`;

  for (const el of elements) {
    // Collect rings from way geometry or relation members
    const rings = [];
    if (el.type === 'way' && el.geometry) {
      rings.push(el.geometry);
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.geometry?.length > 1) rings.push(m.geometry);
      }
    }

    for (const ring of rings) {
      if (ring.length < 2) continue;
      ctx.beginPath();
      ring.forEach(({ lat, lon }, i) => {
        const [x, y] = toXY(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  // Composite painted canvas pixels onto imageData
  const painted = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < painted.data.length; i += 4) {
    if (painted.data[i + 3] > 0) {
      // Don't overwrite sea pixels (pure blue)
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255) continue;
      data[i]     = painted.data[i];
      data[i + 1] = painted.data[i + 1];
      data[i + 2] = painted.data[i + 2];
      data[i + 3] = 255;
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function OsmTagOverlayEditor({ bbox, groundLayer, onLayerUpdate }) {
  const [rules, setRules] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [statusByRule, setStatusByRule] = useState({});
  const [expanded, setExpanded] = useState(true);

  const hasLayer = !!groundLayer?.imageData;
  const bboxStr = bbox ? `${bbox.south},${bbox.west},${bbox.north},${bbox.east}` : '';

  const addRule = (tag) => {
    if (rules.find(r => r.key === tag.key && r.value === tag.value)) return;
    setRules(prev => [...prev, { key: tag.key, value: tag.value, label: tag.label, gtId: tag.defaultGt }]);
    setShowPicker(false);
    setSearch('');
  };

  const removeRule = (idx) => setRules(prev => prev.filter((_, i) => i !== idx));

  const updateGt = (idx, gtId) => setRules(prev => prev.map((r, i) => i === idx ? { ...r, gtId } : r));

  const applyAll = async () => {
    if (!hasLayer || !bbox || rules.length === 0) return;
    setRunning(true);
    setStatusByRule({});

    // Mark all rules as fetching
    const initStatus = {};
    rules.forEach((_, i) => { initStatus[i] = 'fetching…'; });
    setStatusByRule(initStatus);

    // Work on a copy of the current ground layer
    const src = groundLayer.imageData;
    const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);

    try {
      const byRule = await fetchAllPolygons(rules, bboxStr);

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const elements = byRule.get(`${rule.key}=${rule.value}`) ?? [];
        setStatusByRule(s => ({ ...s, [i]: `painting (${elements.length})` }));
        await new Promise(r => setTimeout(r, 0)); // yield to UI
        const color = GT[rule.gtId] ?? [96, 160, 64];
        paintPolygonsOntoImageData(copy, elements, bbox, color);
        setStatusByRule(s => ({ ...s, [i]: `done (${elements.length})` }));
      }

      onLayerUpdate('ground', { imageData: copy, visible: true, opacity: 1, dirty: true });
    } catch (e) {
      // Mark all still-pending rules as failed
      setStatusByRule(s => {
        const next = { ...s };
        rules.forEach((_, i) => { if (!next[i]?.startsWith('done')) next[i] = `error: ${e.message}`; });
        return next;
      });
    }

    setRunning(false);
  };

  const filtered = OSM_TAG_OPTIONS.filter(t =>
    !search || t.label.toLowerCase().includes(search.toLowerCase()) ||
    t.key.includes(search.toLowerCase()) || t.value.includes(search.toLowerCase())
  );

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] text-slate-300 font-semibold hover:bg-slate-800/60 transition-colors">
        <span className="flex items-center gap-1.5">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          OSM Tag Overlay
        </span>
        {rules.length > 0 && (
          <span className="text-[9px] bg-amber-600/30 text-amber-400 px-1.5 py-0.5 rounded">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-700/50">
          <p className="text-[9px] text-slate-500 pt-1.5 leading-relaxed">
            Fetch OSM land-use polygons and paint them onto the ground type layer, overriding the height-based colours for specific terrain features.
          </p>

          {/* Rules list */}
          {rules.length > 0 && (
            <div className="space-y-1">
              {rules.map((rule, idx) => {
                const st = statusByRule[idx];
                const isDone = st?.startsWith('done');
                const isErr  = st?.startsWith('error');
                return (
                  <div key={idx} className="rounded border border-slate-700 bg-slate-900 p-1.5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm border border-slate-600 shrink-0"
                        style={{ backgroundColor: GT_COLOR[rule.gtId] ?? '#888' }} />
                      <span className="text-[10px] text-slate-200 flex-1 truncate font-medium">{rule.label}</span>
                      <span className="text-[8px] font-mono text-slate-600">{rule.key}={rule.value}</span>
                      <button onClick={() => removeRule(idx)}
                        className="text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Ground type picker */}
                    <div className="grid grid-cols-2 gap-0.5 max-h-24 overflow-y-auto">
                      {GROUND_TYPE_PALETTE.map(p => (
                        <button key={p.id} onClick={() => updateGt(idx, p.id)}
                          className={`flex items-center gap-1 px-1 py-0.5 rounded text-[8px] text-left transition-colors ${
                            rule.gtId === p.id ? 'bg-amber-600/30 text-amber-300' : 'text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                          }`}>
                          <div className="w-2 h-2 rounded-sm shrink-0 border border-slate-700"
                            style={{ backgroundColor: p.color }} />
                          <span className="truncate">{p.label}</span>
                        </button>
                      ))}
                    </div>

                    {st && (
                      <p className={`text-[8px] font-mono ${isDone ? 'text-green-400' : isErr ? 'text-red-400' : 'text-amber-400'}`}>
                        {isDone ? '✓' : isErr ? '✕' : '…'} {st}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add tag picker */}
          {showPicker ? (
            <div className="rounded border border-slate-700 bg-slate-900 p-1.5 space-y-1.5">
              <input
                autoFocus
                placeholder="Search tag…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-amber-500"
              />
              <div className="max-h-36 overflow-y-auto space-y-0.5">
                {filtered.map(tag => {
                  const already = rules.find(r => r.key === tag.key && r.value === tag.value);
                  return (
                    <button key={`${tag.key}=${tag.value}`}
                      onClick={() => !already && addRule(tag)}
                      disabled={!!already}
                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[9px] text-left transition-colors ${
                        already ? 'opacity-40 cursor-default' : 'hover:bg-slate-700 text-slate-300'
                      }`}>
                      <div className="w-2.5 h-2.5 rounded-sm shrink-0 border border-slate-600"
                        style={{ backgroundColor: GT_COLOR[tag.defaultGt] ?? '#888' }} />
                      <span className="flex-1">{tag.label}</span>
                      <span className="text-[8px] font-mono text-slate-600">{tag.key}={tag.value}</span>
                    </button>
                  );
                })}
                {filtered.length === 0 && <p className="text-[9px] text-slate-600 px-1.5">No matching tags</p>}
              </div>
              <button onClick={() => { setShowPicker(false); setSearch(''); }}
                className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowPicker(true)}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 transition-colors">
              <Plus className="w-3 h-3" /> Add OSM Tag Rule
            </button>
          )}

          {/* Apply */}
          <button
            onClick={applyAll}
            disabled={running || rules.length === 0 || !hasLayer || !bbox}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
            <Download className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Fetching & Painting…' : 'Apply All Rules to Ground Layer'}
          </button>

          {!hasLayer && (
            <p className="text-[9px] text-slate-600 italic">Generate the ground layer first using Auto-generate above.</p>
          )}
          {!bbox && (
            <p className="text-[9px] text-slate-600 italic">No bounding box — go back to area selection.</p>
          )}
        </div>
      )}
    </div>
  );
}