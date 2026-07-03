import React, { useState } from 'react';
import { Download, ChevronDown, ChevronRight, X, Eye, EyeOff } from 'lucide-react';
import { GROUND_TYPE_PALETTE } from '@/lib/mapLayerStore';
import { GT } from '@/lib/autoGroundTypes';

const GT_COLOR = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.color]));
const GT_LABEL = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.label]));

// ── Full tag catalog ────────────────────────────────────────────────────────
const TAG_GROUPS = [
  {
    group: 'Water (Sea)',
    tags: [
      { key: 'water', value: 'lake',         label: 'Lake',          defaultGt: 'swamp',          desc: 'Natural or artificial standing water body.' },
      { key: 'water', value: 'lagoon',        label: 'Lagoon',        defaultGt: 'swamp',          desc: 'Shallow coastal water separated from the sea.' },
      { key: 'water', value: 'river',         label: 'River (area)',  defaultGt: 'swamp',          desc: 'Wide river mapped as a polygon area.' },
      { key: 'water', value: 'oxbow',         label: 'Oxbow Lake',    defaultGt: 'swamp',          desc: 'Isolated curved lake formed by a cut-off river meander.' },
      { key: 'water', value: 'pond',          label: 'Pond',          defaultGt: 'swamp',          desc: 'Small standing water body.' },
      { key: 'water', value: 'basin',         label: 'Basin',         defaultGt: 'swamp',          desc: 'Man-made water basin or reservoir.' },
    ],
  },
  {
    group: 'Wetland',
    tags: [
      { key: 'wetland', value: 'bog',         label: 'Bog',           defaultGt: 'swamp',          desc: 'Acidic, waterlogged peat ground with mosses.' },
      { key: 'wetland', value: 'fen',         label: 'Fen',           defaultGt: 'swamp',          desc: 'Alkaline or neutral waterlogged ground.' },
      { key: 'wetland', value: 'marsh',       label: 'Marsh',         defaultGt: 'swamp',          desc: 'Flat, low-lying land flooded with shallow water.' },
      { key: 'wetland', value: 'swamp',       label: 'Swamp',         defaultGt: 'swamp',          desc: 'Forested or shrubby waterlogged area.' },
      { key: 'wetland', value: 'reedbed',     label: 'Reedbed',       defaultGt: 'swamp',          desc: 'Dense reeds in shallow water or muddy ground.' },
      { key: 'wetland', value: 'saltmarsh',   label: 'Saltmarsh',     defaultGt: 'swamp',          desc: 'Coastal wetland flooded by seawater.' },
      { key: 'wetland', value: 'wet_meadow',  label: 'Wet Meadow',    defaultGt: 'fertile_medium', desc: 'Grass meadow with waterlogged soils.' },
      { key: 'wetland', value: 'tidalflat',   label: 'Tidal Flat',    defaultGt: 'beach',          desc: 'Coastal mudflat exposed at low tide.' },
      { key: 'wetland', value: 'mangrove',    label: 'Mangrove',      defaultGt: 'swamp',          desc: 'Tropical coastal forest growing in saltwater.' },
    ],
  },
  {
    group: 'Natural',
    tags: [
      { key: 'natural', value: 'wood',        label: 'Wood',          defaultGt: 'forest_sparse',  desc: 'Natural woodland or forest.' },
      { key: 'natural', value: 'scrub',       label: 'Scrub',         defaultGt: 'wilderness',     desc: 'Low shrubs and bushes, transitional land.' },
      { key: 'natural', value: 'heath',       label: 'Heath',         defaultGt: 'wilderness',     desc: 'Open land with heather and low shrubs.' },
      { key: 'natural', value: 'grassland',   label: 'Grassland',     defaultGt: 'fertile_medium', desc: 'Natural grassy area, not farmed.' },
      { key: 'natural', value: 'wetland',     label: 'Wetland',       defaultGt: 'swamp',          desc: 'Generic wetland tag (use specific wetland types when possible).' },
      { key: 'natural', value: 'beach',       label: 'Beach',         defaultGt: 'beach',          desc: 'Sandy or pebbly shore at sea or lake edge.' },
      { key: 'natural', value: 'sand',        label: 'Sand / Dunes',  defaultGt: 'beach',          desc: 'Sandy desert, dunes, or sandy ground.' },
      { key: 'natural', value: 'bare_rock',   label: 'Bare Rock',     defaultGt: 'mountains_high', desc: 'Exposed rock surface with little vegetation.' },
      { key: 'natural', value: 'scree',       label: 'Scree',         defaultGt: 'mountains_low',  desc: 'Loose broken rock on a slope.' },
      { key: 'natural', value: 'glacier',     label: 'Glacier',       defaultGt: 'mountains_high', desc: 'Slow-moving mass of ice covering land.' },
      { key: 'natural', value: 'fell',        label: 'Fell',          defaultGt: 'hills',          desc: 'High open moorland, typical of Scandinavia.' },
      { key: 'natural', value: 'moor',        label: 'Moor',          defaultGt: 'wilderness',     desc: 'Open upland, often boggy with heather.' },
      { key: 'natural', value: 'mud',         label: 'Mud',           defaultGt: 'swamp',          desc: 'Muddy ground or tidal mudflat.' },
      { key: 'natural', value: 'shingle',     label: 'Shingle',       defaultGt: 'beach',          desc: 'Beach of small rounded pebbles or gravel.' },
      { key: 'natural', value: 'cliff',       label: 'Cliff',         defaultGt: 'mountains_high', desc: 'Steep rock face; often a linear feature.' },
      { key: 'natural', value: 'valley',      label: 'Valley',        defaultGt: 'fertile_medium', desc: 'Low area between hills or mountains.' },
      { key: 'natural', value: 'volcano',     label: 'Volcano',       defaultGt: 'mountains_high', desc: 'Volcanic mountain or cone.' },
    ],
  },
  {
    group: 'Land Use',
    tags: [
      { key: 'landuse', value: 'farmland',     label: 'Farmland',          defaultGt: 'fertile_high',   desc: 'Cultivated arable land, crops or ploughed fields.' },
      { key: 'landuse', value: 'farmyard',     label: 'Farmyard',          defaultGt: 'fertile_medium', desc: 'Area around farm buildings.' },
      { key: 'landuse', value: 'meadow',       label: 'Meadow',            defaultGt: 'fertile_high',   desc: 'Managed grassland used for grazing or hay.' },
      { key: 'landuse', value: 'orchard',      label: 'Orchard',           defaultGt: 'fertile_high',   desc: 'Planted fruit or nut trees.' },
      { key: 'landuse', value: 'vineyard',     label: 'Vineyard',          defaultGt: 'fertile_medium', desc: 'Cultivated grapevines.' },
      { key: 'landuse', value: 'forest',       label: 'Forest (landuse)',  defaultGt: 'forest_sparse',  desc: 'Managed or plantation forest.' },
      { key: 'landuse', value: 'residential',  label: 'Residential',       defaultGt: 'fertile_low',    desc: 'Land used for housing and dwellings.' },
      { key: 'landuse', value: 'industrial',   label: 'Industrial',        defaultGt: 'impassable_land',desc: 'Industrial zone, factories, warehouses.' },
      { key: 'landuse', value: 'quarry',       label: 'Quarry',            defaultGt: 'mountains_low',  desc: 'Open-pit extraction of stone, gravel or minerals.' },
      { key: 'landuse', value: 'cemetery',     label: 'Cemetery',          defaultGt: 'wilderness',     desc: 'Burial ground.' },
      { key: 'landuse', value: 'allotments',   label: 'Allotments',        defaultGt: 'fertile_medium', desc: 'Small plots for private vegetable/flower growing.' },
      { key: 'landuse', value: 'village_green',label: 'Village Green',     defaultGt: 'fertile_high',   desc: 'Common grassy area in a village.' },
      { key: 'landuse', value: 'wetland',      label: 'Wetland (landuse)', defaultGt: 'swamp',          desc: 'Land designated or managed as wetland.' },
    ],
  },
  {
    group: 'Leisure',
    tags: [
      { key: 'leisure', value: 'park',          label: 'Park',            defaultGt: 'fertile_low',    desc: 'Public park or green space in a settlement.' },
      { key: 'leisure', value: 'garden',        label: 'Garden',          defaultGt: 'fertile_high',   desc: 'Cultivated garden area.' },
    ],
  },
];

// Flat lookup: "key=value" → tag meta
const ALL_TAGS = TAG_GROUPS.flatMap(g => g.tags);

const OSM_OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Area threshold in square degrees above which tiling kicks in
const TILE_THRESHOLD_DEG2 = 4; // ~2°×2° tile max before splitting
// Max tiles per axis (so a huge map uses at most 6×6 = 36 tiles)
const MAX_TILES_PER_AXIS = 6;

/** Split a bbox into a grid of sub-tiles, each ≤ TILE_THRESHOLD_DEG2 sq degrees. */
function computeTiles(bbox) {
  const dLat = bbox.north - bbox.south;
  const dLon = bbox.east - bbox.west;
  const area = dLat * dLon;
  if (area <= TILE_THRESHOLD_DEG2) return [bbox]; // small enough — single fetch
  // How many divisions do we need so each tile ≤ threshold?
  const nSide = Math.ceil(Math.sqrt(area / TILE_THRESHOLD_DEG2));
  const n = Math.min(nSide, MAX_TILES_PER_AXIS);
  const tiles = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      tiles.push({
        south: bbox.south + (dLat / n) * row,
        north: bbox.south + (dLat / n) * (row + 1),
        west:  bbox.west  + (dLon / n) * col,
        east:  bbox.west  + (dLon / n) * (col + 1),
      });
    }
  }
  return tiles;
}

async function fetchTile(key, value, tile) {
  const bboxStr = `${tile.south},${tile.west},${tile.north},${tile.east}`;
  const query = `[out:json][timeout:90];\n(\n  way["${key}"="${value}"](${bboxStr});\n  relation["${key}"="${value}"](${bboxStr});\n);\nout geom;`;
  let lastErr;
  for (const mirror of OSM_OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        mode: 'cors',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 429 || res.status === 504) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /runtime error|out of memory|exceeded/i.test(json.remark)) {
        throw new Error(`Overpass: ${json.remark}`);
      }
      return (json.elements || []).filter(e =>
        (e.type === 'way' && e.geometry?.length > 1) ||
        (e.type === 'relation' && e.members?.some(m => m.geometry?.length > 1))
      );
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('All mirrors failed');
}

function latToMercN(lat) {
  const latRad = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

function paintPolygonsOntoImageData(imageData, elements, bbox, color) {
  const { width, height, data } = imageData;
  const [r, g, b] = color;
  const mercNorth = latToMercN(bbox.north);
  const mercSouth = latToMercN(bbox.south);
  const mercRange = mercNorth - mercSouth;
  const toXY = (lat, lon) => [
    Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1)),
    Math.round(((mercNorth - latToMercN(lat)) / mercRange) * (height - 1)),
  ];
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  for (const el of elements) {
    const rings = [];
    if (el.type === 'way' && el.geometry) rings.push(el.geometry);
    else if (el.type === 'relation' && el.members) for (const m of el.members) if (m.geometry?.length > 1) rings.push(m.geometry);
    for (const ring of rings) {
      if (ring.length < 2) continue;
      ctx.beginPath();
      ring.forEach(({ lat, lon }, i) => { const [x, y] = toXY(lat, lon); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.closePath(); ctx.fill();
    }
  }
  const painted = ctx.getImageData(0, 0, width, height).data;
  for (let i = 0; i < painted.length; i += 4) {
    if (painted[i + 3] > 0) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255) continue; // don't overwrite sea
      data[i] = painted[i]; data[i + 1] = painted[i + 1]; data[i + 2] = painted[i + 2]; data[i + 3] = 255;
    }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function OsmTagOverlayEditor({ bbox, groundLayer, onLayerUpdate }) {
  // tagKey → { gtId, status: null|'running'|'done N'|'error: ...' }
  const [tagStates, setTagStates] = useState({});
  // which tag's gt-picker is open
  const [pickerOpen, setPickerOpen] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [openGroups, setOpenGroups] = useState({});
  // set of tag keys currently hidden
  const [hiddenTags, setHiddenTags] = useState(new Set());

  const hasLayer = !!groundLayer?.imageData;
  const bboxStr = bbox ? `${bbox.south},${bbox.west},${bbox.north},${bbox.east}` : '';

  const getTagKey = (tag) => `${tag.key}=${tag.value}`;

  const getGt = (tag) => tagStates[getTagKey(tag)]?.gtId ?? tag.defaultGt;
  const getStatus = (tag) => tagStates[getTagKey(tag)]?.status ?? null;

  const setGt = (tag, gtId) => {
    const k = getTagKey(tag);
    setTagStates(s => ({ ...s, [k]: { ...s[k], gtId } }));
  };

  // k → { pct: 0-100, tileLabel: string }
  const [fetchProgress, setFetchProgress] = useState({});
  // ref to always-current groundLayer so the tiled loop can read latest painted state
  const groundLayerRef = React.useRef(groundLayer);
  React.useEffect(() => { groundLayerRef.current = groundLayer; }, [groundLayer]);
  // store the original ground layer before any tags were applied (for repaint on toggle)
  const baseLayerRef = React.useRef(null);
  React.useEffect(() => {
    // Capture base layer once we have one, but only if no tags have been applied yet
    if (groundLayer?.imageData && Object.keys(tagStates).length === 0) {
      baseLayerRef.current = groundLayer.imageData;
    }
  }, [groundLayer, tagStates]);

  /** Repaint ground layer from base + all currently visible done tags */
  const repaintFromBase = React.useCallback((newHidden, newTagStates) => {
    const base = baseLayerRef.current ?? groundLayerRef.current?.imageData;
    if (!base || !bbox) return;
    const copy = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    const states = newTagStates ?? tagStates;
    for (const [k, st] of Object.entries(states)) {
      if (st?.status?.startsWith('done') && st.elements?.length && !newHidden.has(k)) {
        const gtId = st.gtId ?? ALL_TAGS.find(t => `${t.key}=${t.value}` === k)?.defaultGt ?? 'fertile_medium';
        const color = GT[gtId] ?? [96, 160, 64];
        paintPolygonsOntoImageData(copy, st.elements, bbox, color);
      }
    }
    onLayerUpdate('ground', { imageData: copy, visible: true, opacity: 1, dirty: true });
  }, [tagStates, bbox, onLayerUpdate]);

  const toggleTagVisibility = (k) => {
    setHiddenTags(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      repaintFromBase(next, null);
      return next;
    });
  };

  const applyTag = async (tag) => {
    if (!hasLayer || !bbox) return;
    const k = getTagKey(tag);
    const gtId = tagStates[k]?.gtId ?? tag.defaultGt;
    const color = GT[gtId] ?? [96, 160, 64];

    const tiles = computeTiles(bbox);
    const CONCURRENCY = 4; // fetch up to 4 tiles in parallel

    // Capture base layer before first tag application
    if (Object.keys(tagStates).filter(tk => tagStates[tk]?.status?.startsWith('done')).length === 0) {
      baseLayerRef.current = groundLayerRef.current?.imageData ?? null;
    }
    setTagStates(s => ({ ...s, [k]: { ...s[k], status: 'running', elements: [], gtId } }));
    setFetchProgress(p => ({ ...p, [k]: { pct: 0, tilesDone: 0, tilesTotal: tiles.length } }));

    let tilesDone = 0;
    let totalElements = 0;
    let allElements = [];
    let fetchError = null;

    // Process tiles in parallel batches of CONCURRENCY
    for (let i = 0; i < tiles.length; i += CONCURRENCY) {
      if (fetchError) break;
      const batch = tiles.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(tile => fetchTile(tag.key, tag.value, tile)));

      for (const result of results) {
        tilesDone++;
        const pct = Math.round((tilesDone / tiles.length) * 100);
        setFetchProgress(p => ({ ...p, [k]: { pct, tilesDone, tilesTotal: tiles.length } }));

        if (result.status === 'rejected') {
          fetchError = result.reason;
          break;
        }
        const elements = result.value;
        if (elements.length > 0) {
          const src = groundLayerRef.current.imageData;
          const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
          paintPolygonsOntoImageData(copy, elements, bbox, color);
          onLayerUpdate('ground', { imageData: copy, visible: true, opacity: 1, dirty: true });
          totalElements += elements.length;
          allElements = allElements.concat(elements);
        }
      }
    }

    if (fetchError) {
      setTagStates(s => ({ ...s, [k]: { ...s[k], status: `error: ${fetchError.message}` } }));
      return;
    }

    setFetchProgress(p => ({ ...p, [k]: { pct: 100, tilesDone: tiles.length, tilesTotal: tiles.length } }));
    setTagStates(s => ({ ...s, [k]: { ...s[k], status: `done ${totalElements}`, elements: allElements, gtId } }));
  };

  const downloadTagPng = (tag) => {
    const k = getTagKey(tag);
    const state = tagStates[k];
    if (!state?.elements || !groundLayer?.imageData) return;
    const { width, height } = groundLayer.imageData;
    const gtId = getGt(tag);
    const color = GT[gtId] ?? [96, 160, 64];
    // Create transparent canvas, paint only this tag's pixels
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
    paintPolygonsOntoImageData(imageData, state.elements, bbox, color);
    ctx.putImageData(imageData, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${k.replace('=', '_')}.png`;
    a.click();
  };

  const toggleGroup = (g) => setOpenGroups(s => ({ ...s, [g]: !s[g] }));

  const searchLower = search.toLowerCase();
  const filteredGroups = TAG_GROUPS.map(g => ({
    ...g,
    tags: search ? g.tags.filter(t =>
      t.label.toLowerCase().includes(searchLower) ||
      t.key.includes(searchLower) ||
      t.value.includes(searchLower)
    ) : g.tags,
  })).filter(g => g.tags.length > 0);

  const anyRunning = Object.values(tagStates).some(s => s?.status === 'running');

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
        {Object.keys(tagStates).length > 0 && (
          <span className="text-[9px] bg-amber-600/30 text-amber-400 px-1.5 py-0.5 rounded">
            {Object.values(tagStates).filter(s => s?.status?.startsWith('done')).length} applied
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-700/50">
          <p className="text-[9px] text-slate-500 pt-1.5 leading-relaxed">
            Click a tag to assign a ground type, then apply it to paint those OSM polygons onto the ground layer.
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
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(g.group)}
                  className="w-full flex items-center justify-between px-2 py-1 bg-slate-800/60 hover:bg-slate-700/60 transition-colors">
                  <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{g.group}</span>
                  <span className="flex items-center gap-1.5">
                    {g.tags.filter(t => tagStates[getTagKey(t)]?.status?.startsWith('done')).length > 0 && (
                      <span className="text-[8px] text-green-400">
                        {g.tags.filter(t => tagStates[getTagKey(t)]?.status?.startsWith('done')).length} ✓
                      </span>
                    )}
                    {openGroups[g.group] ? <ChevronDown className="w-2.5 h-2.5 text-slate-500" /> : <ChevronRight className="w-2.5 h-2.5 text-slate-500" />}
                  </span>
                </button>

                {openGroups[g.group] && (
                  <div className="divide-y divide-slate-800">
                    {g.tags.map(tag => {
                      const k = getTagKey(tag);
                      const gtId = getGt(tag);
                      const st = getStatus(tag);
                      const isDone = st?.startsWith('done');
                      const isErr = st?.startsWith('error');
                      const isRunning = st === 'running';
                      const isPickerOpen = pickerOpen === k;

                      return (
                        <div key={k} className="bg-slate-900">
                          {/* Fetch progress bar */}
                          {isRunning && (() => {
                            const fp = fetchProgress[k];
                            const isTiledFetch = (fp?.tilesTotal ?? 1) > 1;
                            const pct = fp?.pct ?? 0;
                            return (
                              <div className="mx-1.5 mt-1 space-y-0.5">
                                {isTiledFetch ? (
                                  <>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                                    </div>
                                    <p className="text-[8px] text-blue-400">
                                      Tile {fp.tilesDone}/{fp.tilesTotal} — {pct}% complete
                                    </p>
                                    <p className="text-[8px] text-amber-500/80 leading-snug">
                                      Large area split into {fp.tilesTotal} tiles. Map updates as each tile arrives.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: '100%' }} />
                                    </div>
                                    <p className="text-[8px] text-blue-400 leading-snug">
                                      Fetching from OpenStreetMap… please be patient, this may take a minute.
                                    </p>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          {/* Tag row */}
                          <div className="flex items-center gap-1.5 px-1.5 py-1">
                            {/* GT color swatch + picker toggle */}
                            <button
                              onClick={() => setPickerOpen(isPickerOpen ? null : k)}
                              title="Change ground type"
                              className={`w-4 h-4 rounded-sm border shrink-0 transition-all ${isPickerOpen ? 'border-amber-400 ring-1 ring-amber-400/50' : 'border-slate-600 hover:border-slate-400'}`}
                              style={{ backgroundColor: GT_COLOR[gtId] ?? '#888' }}
                            />
                            {/* Tag label + description */}
                            <div className="flex-1 min-w-0">
                              <span className="text-[10px] text-slate-300 truncate block">{tag.label}</span>
                              {tag.desc && <span className="text-[8px] text-slate-500 leading-tight block truncate">{tag.desc}</span>}
                            </div>
                            <span className="text-[8px] font-mono text-slate-600 hidden sm:inline shrink-0">{k}</span>
                            {/* Status indicator */}
                            {st && !isRunning && (
                              <span className={`text-[8px] font-mono shrink-0 ${isDone ? 'text-green-400' : isErr ? 'text-red-400' : 'text-amber-400'}`}>
                                {isDone ? `✓${st.replace('done ', '')}` : '✕'}
                              </span>
                            )}
                            {/* Visibility toggle — only when fetched */}
                            {isDone && (
                              <button
                                onClick={() => toggleTagVisibility(k)}
                                title={hiddenTags.has(k) ? 'Show on map' : 'Hide from map'}
                                className={`shrink-0 flex items-center justify-center w-5 h-5 rounded transition-colors ${
                                  hiddenTags.has(k)
                                    ? 'bg-slate-700/60 text-slate-500 hover:bg-slate-600 hover:text-white'
                                    : 'bg-amber-700/40 text-amber-300 hover:bg-amber-600/60'
                                }`}>
                                {hiddenTags.has(k) ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                              </button>
                            )}
                            {/* Download PNG button — only when fetched */}
                            {isDone && (
                              <button
                                onClick={() => downloadTagPng(tag)}
                                title={`Download ${getTagKey(tag)} as PNG`}
                                className="shrink-0 flex items-center justify-center w-5 h-5 rounded transition-colors bg-slate-700/60 text-slate-400 hover:bg-slate-600 hover:text-white">
                                <Download className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {/* Apply button */}
                            <button
                              onClick={() => applyTag(tag)}
                              disabled={anyRunning || !hasLayer || !bbox}
                              title={isDone ? 'Re-apply' : 'Apply to ground layer'}
                              className={`shrink-0 flex items-center justify-center w-5 h-5 rounded transition-colors disabled:opacity-30 ${
                                isDone ? 'bg-green-800/40 text-green-300 hover:bg-green-700/50' :
                                isErr  ? 'bg-red-800/40 text-red-300 hover:bg-red-700/50' :
                                         'bg-blue-800/40 text-blue-300 hover:bg-blue-700/50'
                              }`}>
                              <Download className={`w-2.5 h-2.5 ${isRunning ? 'animate-spin' : ''}`} />
                            </button>
                          </div>

                          {/* Inline GT picker */}
                          {isPickerOpen && (
                            <div className="px-1.5 pb-1.5">
                              <div className="rounded border border-slate-700 bg-slate-800 p-1">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Ground type</span>
                                  <button onClick={() => setPickerOpen(null)} className="text-slate-600 hover:text-slate-400"><X className="w-2.5 h-2.5" /></button>
                                </div>
                                <div className="grid grid-cols-2 gap-0.5 max-h-28 overflow-y-auto">
                                  {GROUND_TYPE_PALETTE.map(p => (
                                    <button key={p.id} onClick={() => { setGt(tag, p.id); setPickerOpen(null); }}
                                      className={`flex items-center gap-1 px-1 py-0.5 rounded text-[8px] text-left transition-colors ${
                                        gtId === p.id ? 'bg-amber-600/30 text-amber-300' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                                      }`}>
                                      <div className="w-2 h-2 rounded-sm shrink-0 border border-slate-700" style={{ backgroundColor: p.color }} />
                                      <span className="truncate">{p.label}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!hasLayer && <p className="text-[9px] text-slate-600 italic">Generate the ground layer first.</p>}
          {!bbox && <p className="text-[9px] text-slate-600 italic">No bounding box — go back to area selection.</p>}
        </div>
      )}
    </div>
  );
}