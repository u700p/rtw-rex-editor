import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';
import { extractHiddenResourcesFromEDB, extractBuildingLevelsFromEDB } from './additionalParsers';

const SETTLEMENT_LEVELS = ['village', 'town', 'large_town', 'city', 'large_city', 'huge_city'];

function clampRgb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function randomRegionColor() {
  return {
    r: Math.floor(Math.random() * 200) + 30,
    g: Math.floor(Math.random() * 200) + 30,
    b: Math.floor(Math.random() * 200) + 30,
  };
}

// ─── Searchable dropdown ──────────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder, emptyMsg }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex items-center justify-between gap-1"
      >
        <span className={value ? 'text-slate-200 font-mono truncate' : 'text-slate-500'}>{value || placeholder}</span>
        <Search className="w-2.5 h-2.5 text-slate-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 top-7 left-0 right-0 bg-slate-900 border border-slate-600/60 rounded shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full h-6 px-2 text-[11px] bg-slate-800 border-b border-slate-700 text-slate-200 placeholder-slate-600 outline-none"
          />
          <div className="max-h-36 overflow-y-auto">
            <div
              className="px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 cursor-pointer"
              onMouseDown={() => { onChange(''); setOpen(false); }}
            >— none —</div>
            {filtered.length === 0 && (
              <div className="px-2 py-1 text-[10px] text-slate-600 italic">{emptyMsg || 'No options'}</div>
            )}
            {filtered.map(opt => (
              <div
                key={opt}
                onMouseDown={() => { onChange(opt); setOpen(false); setQuery(''); }}
                className={`px-2 py-0.5 text-[10px] font-mono cursor-pointer hover:bg-slate-700 ${value === opt ? 'text-amber-400' : 'text-slate-200'}`}
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Multi-select searchable (for hidden resources) ───────────────────────────
function SearchableMultiSelect({ selected, onChange, options, placeholder, emptyMsg }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const available = options.filter(o => !selected.includes(o));
    if (!query) return available;
    const q = query.toLowerCase();
    return available.filter(o => o.toLowerCase().includes(q));
  }, [options, selected, query]);

  const add = (val) => { if (!selected.includes(val)) onChange([...selected, val]); };
  const remove = (val) => onChange(selected.filter(x => x !== val));

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-0.5 mb-1">
        {selected.map(hr => (
          <span key={hr} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-800/60 rounded text-[9px] text-purple-300 font-mono">
            {hr}
            <button type="button" onClick={() => remove(hr)} className="text-slate-600 hover:text-red-400"><X className="w-2 h-2" /></button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-400 flex items-center justify-between gap-1"
      >
        <span>{placeholder}</span>
        <Search className="w-2.5 h-2.5 text-slate-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 top-7 left-0 right-0 bg-slate-900 border border-slate-600/60 rounded shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full h-6 px-2 text-[11px] bg-slate-800 border-b border-slate-700 text-slate-200 placeholder-slate-600 outline-none"
          />
          <div className="max-h-36 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-2 py-1 text-[10px] text-slate-600 italic">{emptyMsg || 'No options'}</div>
            )}
            {filtered.map(opt => (
              <div
                key={opt}
                onMouseDown={() => { add(opt); setQuery(''); }}
                className="px-2 py-0.5 text-[10px] font-mono cursor-pointer hover:bg-slate-700 text-slate-200"
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────
export default function NewRegionForm({ factionColors, onAdd, onCancel, edbData, rebelFactionList, hiddenResourceList, musicTypeList, mercenaryPoolList, religionList, naturalResList }) {
  const [draft, setDraft] = useState({
    regionName: '',
    settlementName: '',
    regionDisplayName: '',
    settlementDisplayName: '',
    r: Math.floor(Math.random() * 200) + 30,
    g: Math.floor(Math.random() * 200) + 30,
    b: Math.floor(Math.random() * 200) + 30,
    faction: '',
    factionCreator: '',
    level: 'village',
    population: 400,
    yearFounded: 0,
    rebelFaction: '',
    resources: [],
    hiddenResources: [],
    buildings: [],
    val1: 0,
    val2: 0,
    musicType: '',
    mercenaryPool: '',
    religions: {},
  });
  const [selectedTree, setSelectedTree] = useState('');

  const factionList = factionColors ? Object.keys(factionColors).sort() : [];
  const edbHiddenRes = useMemo(() => hiddenResourceList?.length ? hiddenResourceList : extractHiddenResourcesFromEDB(edbData), [hiddenResourceList, edbData]);

  // Building trees from EDB
  const buildingLevels = useMemo(() => extractBuildingLevelsFromEDB(edbData), [edbData]);
  const buildingTrees = useMemo(() => {
    const map = {};
    for (const bl of buildingLevels) {
      const tree = bl.building || '(unknown)';
      if (!map[tree]) map[tree] = [];
      map[tree].push(bl.name);
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [buildingLevels]);
  const treeLevels = useMemo(() => {
    if (!selectedTree) return [];
    const entry = buildingTrees.find(([t]) => t === selectedTree);
    return entry ? entry[1] : [];
  }, [buildingTrees, selectedTree]);

  // Religion sum validation
  const religionSum = useMemo(() => {
    if (!religionList?.length) return 0;
    return religionList.reduce((sum, rel) => sum + (parseInt(draft.religions[rel]) || 0), 0);
  }, [draft.religions, religionList]);

  const religionError = religionList?.length > 0 && religionSum !== 100;

  const canSubmit = draft.regionName && draft.settlementName && !religionError;

  const setRegionColorHex = (hex) => {
    const rgb = hexToRgb(hex);
    if (rgb) setDraft(d => ({ ...d, ...rgb }));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onAdd(draft);
  };

  return (
    <div className="rounded-lg border border-green-600/40 bg-green-900/10 p-2.5 space-y-1.5">
      <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1">
        <Plus className="w-3 h-3" /> New Region
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <span className="text-[9px] text-slate-500">Region Internal *</span>
          <input value={draft.regionName} onChange={e => setDraft(d => ({ ...d, regionName: e.target.value }))}
            placeholder="e.g. Province_of_Rome"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
        <div>
          <span className="text-[9px] text-slate-500">Region Display</span>
          <input value={draft.regionDisplayName} onChange={e => setDraft(d => ({ ...d, regionDisplayName: e.target.value }))}
            placeholder="e.g. Province of Rome"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
        <div>
          <span className="text-[9px] text-slate-500">Settlement Internal *</span>
          <input value={draft.settlementName} onChange={e => setDraft(d => ({ ...d, settlementName: e.target.value }))}
            placeholder="e.g. Rome"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
        <div>
          <span className="text-[9px] text-slate-500">Settlement Display</span>
          <input value={draft.settlementDisplayName} onChange={e => setDraft(d => ({ ...d, settlementDisplayName: e.target.value }))}
            placeholder="e.g. Rome"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
      </div>

      {/* Region Color */}
      <div>
        <span className="text-[9px] text-slate-500">Region Color (RGB)</span>
        <div className="flex items-center gap-1.5">
          <label className="relative w-6 h-6 rounded border border-slate-600/40 shrink-0 overflow-hidden cursor-pointer"
            title="Open region color picker">
            <span className="absolute inset-0"
              style={{ background: `rgb(${draft.r},${draft.g},${draft.b})` }} />
            <input type="color" value={rgbToHex(draft.r, draft.g, draft.b)}
              onChange={e => setRegionColorHex(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
          <input type="number" min="0" max="255" value={draft.r}
            onChange={e => setDraft(d => ({ ...d, r: clampRgb(e.target.value) }))}
            className="h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-red-400 w-14 font-mono text-center" />
          <input type="number" min="0" max="255" value={draft.g}
            onChange={e => setDraft(d => ({ ...d, g: clampRgb(e.target.value) }))}
            className="h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-green-400 w-14 font-mono text-center" />
          <input type="number" min="0" max="255" value={draft.b}
            onChange={e => setDraft(d => ({ ...d, b: clampRgb(e.target.value) }))}
            className="h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-blue-400 w-14 font-mono text-center" />
          <button type="button" onClick={() => setDraft(d => ({ ...d, ...randomRegionColor() }))}
            className="h-6 px-2 rounded border border-slate-600/40 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-500">
            Random
          </button>
        </div>
      </div>

      {/* Faction Owner */}
      <div>
        <span className="text-[9px] text-slate-500">Faction Owner</span>
        {factionList.length > 0 ? (
          <SearchableSelect
            value={draft.faction}
            onChange={v => setDraft(d => ({ ...d, faction: v }))}
            options={factionList}
            placeholder="— select faction —"
          />
        ) : (
          <input value={draft.faction} onChange={e => setDraft(d => ({ ...d, faction: e.target.value }))}
            placeholder="Faction Owner"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        )}
      </div>

      {/* Faction Creator */}
      <div>
        <span className="text-[9px] text-slate-500">Faction Creator</span>
        {factionList.length > 0 ? (
          <SearchableSelect
            value={draft.factionCreator}
            onChange={v => setDraft(d => ({ ...d, factionCreator: v }))}
            options={factionList}
            placeholder="— select faction —"
          />
        ) : (
          <input value={draft.factionCreator} onChange={e => setDraft(d => ({ ...d, factionCreator: e.target.value }))}
            placeholder="Faction Creator"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        )}
      </div>

      {/* Rebel Faction */}
      <div>
        <span className="text-[9px] text-slate-500">Rebel Faction</span>
        {rebelFactionList?.length > 0 ? (
          <SearchableSelect
            value={draft.rebelFaction}
            onChange={v => setDraft(d => ({ ...d, rebelFaction: v }))}
            options={rebelFactionList}
            placeholder="— select rebel faction —"
            emptyMsg="No rebel factions found"
          />
        ) : (
          <input value={draft.rebelFaction} onChange={e => setDraft(d => ({ ...d, rebelFaction: e.target.value }))}
            placeholder="e.g. slave (load descr_rebel_factions.txt)"
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        )}
      </div>

      <div>
        <span className="text-[9px] text-slate-500">Settlement Level</span>
        <select value={draft.level} onChange={e => setDraft(d => ({ ...d, level: e.target.value }))}
          className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
          {SETTLEMENT_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <span className="text-[9px] text-slate-500">Population</span>
          <input type="number" value={draft.population}
            onChange={e => setDraft(d => ({ ...d, population: parseInt(e.target.value) || 0 }))}
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
        <div>
          <span className="text-[9px] text-slate-500">Year Founded</span>
          <input type="number" value={draft.yearFounded}
            onChange={e => setDraft(d => ({ ...d, yearFounded: parseInt(e.target.value) || 0 }))}
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
      </div>

      {/* Buildings */}
      <div>
        <span className="text-[9px] text-slate-500">Buildings (from EDB)</span>
        {draft.buildings.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mb-1">
            {draft.buildings.map(b => (
              <span key={b} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-800/60 rounded text-[9px] text-slate-300 font-mono">
                {b}
                <button type="button" onClick={() => setDraft(d => ({ ...d, buildings: d.buildings.filter(x => x !== b) }))}
                  className="text-slate-600 hover:text-red-400"><X className="w-2 h-2" /></button>
              </span>
            ))}
          </div>
        )}
        {buildingTrees.length > 0 ? (
          <div className="grid grid-cols-2 gap-1">
            <select value={selectedTree} onChange={e => setSelectedTree(e.target.value)}
              className="h-6 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
              <option value="">— tree —</option>
              {buildingTrees.map(([tree]) => <option key={tree} value={tree}>{tree}</option>)}
            </select>
            <select value="" onChange={e => {
              const val = e.target.value;
              if (val) {
                // Store as "treeName levelName" so serializer outputs "type tree level"
                const fullName = selectedTree ? `${selectedTree} ${val}` : val;
                if (!draft.buildings.includes(fullName)) {
                  setDraft(d => ({ ...d, buildings: [...d.buildings, fullName] }));
                }
                setSelectedTree('');
              }
            }} disabled={!selectedTree}
              className="h-6 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 disabled:opacity-40">
              <option value="">— level —</option>
              {treeLevels.map(lv => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          </div>
        ) : (
          <p className="text-[9px] text-slate-600 italic">Load EDB to add buildings</p>
        )}
      </div>

      {/* Natural Resources */}
      <div>
        <span className="text-[9px] text-slate-500">Natural Resources (descr_sm_resources)</span>
        {draft.resources.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mb-1">
            {draft.resources.map(r => (
              <span key={r} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-800/60 rounded text-[9px] text-emerald-300 font-mono">
                {r}
                <button type="button" onClick={() => setDraft(d => ({ ...d, resources: d.resources.filter(x => x !== r) }))}
                  className="text-slate-600 hover:text-red-400"><X className="w-2 h-2" /></button>
              </span>
            ))}
          </div>
        )}
        {naturalResList?.length > 0 ? (
          <select value="" onChange={e => {
            const val = e.target.value;
            if (val && !draft.resources.includes(val))
              setDraft(d => ({ ...d, resources: [...d.resources, val] }));
          }} className="w-full h-6 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
            <option value="">— add resource —</option>
            {naturalResList.filter(r => !draft.resources.includes(r)).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (
          <p className="text-[9px] text-slate-600 italic">Load descr_sm_resources.txt for list</p>
        )}
      </div>

      {/* Triumph & Agriculture */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <span className="text-[9px] text-slate-500">Triumph value</span>
          <input type="number" value={draft.val1}
            onChange={e => setDraft(d => ({ ...d, val1: parseInt(e.target.value) || 0 }))}
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
        <div>
          <span className="text-[9px] text-slate-500">Agriculture value</span>
          <input type="number" value={draft.val2}
            onChange={e => setDraft(d => ({ ...d, val2: parseInt(e.target.value) || 0 }))}
            className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
        </div>
      </div>

      {/* ── Advanced section (always visible) ─────────────────────────────── */}
      <div className="space-y-1.5 border-t border-slate-700/40 pt-1.5">
        <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Hidden Resources, Music, Mercenaries, Religions</p>

        {/* Hidden Resources */}
        <div>
          <span className="text-[9px] text-slate-500">Hidden Resources (EDB)</span>
          {edbHiddenRes.length > 0 ? (
            <SearchableMultiSelect
              selected={draft.hiddenResources}
              onChange={v => setDraft(d => ({ ...d, hiddenResources: v }))}
              options={edbHiddenRes}
              placeholder="— add hidden resource —"
              emptyMsg="Load EDB for hidden resources"
            />
          ) : (
            <p className="text-[9px] text-slate-600 italic">Load EDB to get hidden resource list</p>
          )}
        </div>

        {/* Music Type */}
        <div>
          <span className="text-[9px] text-slate-500">Music Type</span>
          {musicTypeList?.length > 0 ? (
            <SearchableSelect
              value={draft.musicType}
              onChange={v => setDraft(d => ({ ...d, musicType: v }))}
              options={musicTypeList}
              placeholder="— select music type —"
            />
          ) : (
            <input value={draft.musicType} onChange={e => setDraft(d => ({ ...d, musicType: e.target.value }))}
              placeholder="Load descr_sounds_music_types.txt"
              className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
          )}
        </div>

        {/* Mercenary Pool */}
        <div>
          <span className="text-[9px] text-slate-500">Mercenary Pool</span>
          {mercenaryPoolList?.length > 0 ? (
            <SearchableSelect
              value={draft.mercenaryPool}
              onChange={v => setDraft(d => ({ ...d, mercenaryPool: v }))}
              options={mercenaryPoolList}
              placeholder="— select pool —"
            />
          ) : (
            <input value={draft.mercenaryPool} onChange={e => setDraft(d => ({ ...d, mercenaryPool: e.target.value }))}
              placeholder="Load descr_mercenaries.txt"
              className="h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono" />
          )}
        </div>

        {/* Religions */}
        {religionList?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[9px] text-slate-500">Religions</span>
              <span className={`text-[9px] font-mono font-semibold ${religionSum === 100 ? 'text-green-400' : 'text-red-400'}`}>
                sum: {religionSum}/100
              </span>
            </div>
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {religionList.map(rel => (
                <div key={rel} className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-400 font-mono flex-1 truncate">{rel}</span>
                  <input type="number" min="0" max="100" value={draft.religions[rel] || 0}
                    onChange={e => setDraft(d => ({ ...d, religions: { ...d.religions, [rel]: parseInt(e.target.value) || 0 } }))}
                    className="w-14 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-center" />
                </div>
              ))}
            </div>
            {religionError && (
              <p className="text-[9px] text-red-400 mt-0.5">Religion percentages must sum to exactly 100 before creating the region.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 justify-end pt-0.5">
        <button type="button" onClick={onCancel}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] text-slate-400 hover:text-slate-200 border border-slate-700/40">
          <X className="w-2.5 h-2.5" /> Cancel
        </button>
        <button type="button" onClick={handleSubmit}
          disabled={!canSubmit}
          title={religionError ? `Religion sum must be 100 (currently ${religionSum})` : ''}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-green-700/80 hover:bg-green-700 border border-green-600/40 text-green-200 font-semibold disabled:opacity-40">
          <Check className="w-2.5 h-2.5" /> Create Region
        </button>
      </div>
    </div>
  );
}
