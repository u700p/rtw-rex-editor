import React, { useState, useMemo } from 'react';
import { Info, ChevronDown, ChevronRight, Search, Plus } from 'lucide-react';
import { parseWinConditions } from './stratParser';

const AI_LABELS = ['default', 'slave_faction'];
const ECONOMIC_AI = ['balanced', 'trader', 'comfortable', 'bureaucrat', 'craftsman', 'sailor', 'fortified'];
const MILITARY_AI = ['smith', 'mao', 'genghis', 'stalin', 'napoleon', 'caesar', 'subotai'];

const AI_LABEL_INFO = {
  default: 'Standard AI behavior. Most factions use this.',
  slave_faction: 'Special "slave" faction used for independent cities and brigands. No political relationships.',
};

const ECON_AI_INFO = {
  balanced: 'Tries to build a mix of economic, religious, and military buildings.',
  trader: 'Focuses on trade and income-generating buildings.',
  comfortable: 'Balanced with a preference for comfort/prosperity buildings.',
  bureaucrat: 'Favors administrative efficiency; builds governance structures.',
  craftsman: 'Focuses on production and craft buildings.',
  sailor: 'Prefers buildings with trade_fleet, taxable_income bonus and wall upgrades.',
  fortified: 'Heavily prioritizes fortifications and walls.',
};

const MILITARY_AI_INFO = {
  smith: 'Balanced general recruitment. No strong preferences.',
  mao: 'Favors infantry-heavy armies.',
  genghis: 'Prefers cavalry-heavy forces.',
  stalin: 'Mass infantry with siege focus.',
  napoleon: 'Combined arms with artillery emphasis.',
  caesar: 'Roman-style combined arms.',
  subotai: 'Mounted archer preference.',
};

function sanitizeFactionName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-slate-600 hover:text-slate-400 ml-1"
      >
        <Info className="w-2.5 h-2.5 inline" />
      </button>
      {show && (
        <div className="absolute z-50 left-0 top-4 w-56 bg-slate-800 border border-slate-600/60 rounded-lg p-2 text-[10px] text-slate-300 leading-relaxed shadow-xl">
          {text}
        </div>
      )}
    </span>
  );
}

function SearchableSelect({ value, options, onChange, infoMap, className }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 ${className || ''}`}
      >
        <span className="truncate">{value || '—'}</span>
        <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-7 w-full bg-slate-800 border border-slate-600/60 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-700/60">
            <Search className="w-2.5 h-2.5 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-[11px] text-slate-200 outline-none placeholder-slate-600"
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-2 py-1 text-[10px] hover:bg-slate-700 flex items-center gap-1.5 ${opt === value ? 'text-amber-400' : 'text-slate-300'}`}
              >
                <span className="flex-1">{opt}</span>
                {infoMap?.[opt] && <Info className="w-2 h-2 text-slate-600 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-[10px] text-slate-600 px-2 py-1">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function FactionRow({ faction, allFactionNames, regionNames, units, onUpdate, factionMovies, onMoviesChange }) {
  const [expanded, setExpanded] = useState(false);

  const f = faction;
  // Merge movies from factionMovies prop into the faction object for display
  const fWithMovies = { ...f, movies: factionMovies?.[f.name] || f.movies || {} };
  const set = (key, val) => {
    if (key === 'movies') {
      // movies are stored separately in factionMovies state
      onMoviesChange?.(f.name, val);
    } else {
      onUpdate(f.name, { ...f, [key]: val });
    }
  };

  return (
    <div className={`rounded border transition-colors ${expanded ? 'border-amber-500/30 bg-amber-900/5' : 'border-slate-700/40 bg-slate-900/20'}`}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
        <span className={`text-[11px] font-mono flex-1 truncate ${fWithMovies.deadUntilResurrected || fWithMovies.deadUntilEmerged ? 'text-slate-500 italic' : 'text-slate-200'}`}>{fWithMovies.name}</span>
        {fWithMovies.aiLabel && <span className="text-[9px] text-amber-500/70 font-mono">{fWithMovies.aiLabel}</span>}
        {(fWithMovies.deadUntilResurrected || fWithMovies.deadUntilEmerged) && <span className="text-[8px] text-red-500/60 font-mono">dead</span>}
        {fWithMovies.reEmergent && <span className="text-[8px] text-orange-500/60 font-mono">re_emergent</span>}
        {fWithMovies.undiscovered && <span className="text-[8px] text-blue-500/60 font-mono">undiscovered</span>}
      </div>

      {expanded && (
        <div className="border-t border-slate-700/40 px-2 py-2 space-y-2">

          {/* AI Labels — one per line */}
          <div className="space-y-1.5">
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5 flex items-center">
                AI Label <InfoTooltip text="Defines broad faction diplomatic behavior. Rome campaigns normally use default or slave_faction." />
              </div>
              <SearchableSelect
                value={fWithMovies.aiLabel}
                options={AI_LABELS}
                onChange={v => set('aiLabel', v)}
                infoMap={AI_LABEL_INFO}
              />
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5 flex items-center">
                Economic AI <InfoTooltip text="Determines which building bonuses the AI prioritizes when constructing buildings." />
              </div>
              <SearchableSelect
                value={fWithMovies.economicAI}
                options={ECONOMIC_AI}
                onChange={v => set('economicAI', v)}
                infoMap={ECON_AI_INFO}
              />
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5 flex items-center">
                Military AI <InfoTooltip text="Recruitment preferences. Only influence unit mix when units have similar combat values. Soldier count has the biggest impact on a unit's recruitment value." />
              </div>
              <SearchableSelect
                value={fWithMovies.militaryAI}
                options={MILITARY_AI}
                onChange={v => set('militaryAI', v)}
                infoMap={MILITARY_AI_INFO}
              />
            </div>
          </div>

          {/* Denari */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5">Starting Money (denari)</div>
              <input type="number" value={fWithMovies.treasury || 0} onChange={e => set('treasury', parseInt(e.target.value) || 0)}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5">King's Purse (denari_kings_purse)</div>
              <input type="number" value={fWithMovies.kingsPurse || 0} onChange={e => set('kingsPurse', parseInt(e.target.value) || 0)}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
            </div>
          </div>

          {/* Emergence & Status flags */}
          <div>
            <div className="text-[9px] text-slate-500 uppercase font-semibold mb-1">
              Status Flags
              <InfoTooltip text="dead_until_resurrected: faction is dead at start, emerges via script. dead_until_emerged: emerges from rebellion. re_emergent: can respawn after defeat. undiscovered: hidden until discovered via event." />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {/* dead_until_resurrected and dead_until_emerged are mutually exclusive */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!fWithMovies.deadUntilResurrected}
                  onChange={e => { set('deadUntilResurrected', e.target.checked); if (e.target.checked) set('deadUntilEmerged', false); }}
                  className="w-3 h-3 accent-amber-500" />
                <span className="text-[10px] text-slate-400 font-mono">dead_until_resurrected</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!fWithMovies.deadUntilEmerged}
                  onChange={e => { set('deadUntilEmerged', e.target.checked); if (e.target.checked) set('deadUntilResurrected', false); }}
                  className="w-3 h-3 accent-amber-500" />
                <span className="text-[10px] text-slate-400 font-mono">dead_until_emerged</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!fWithMovies.reEmergent} onChange={e => set('reEmergent', e.target.checked)}
                  className="w-3 h-3 accent-amber-500" />
                <span className="text-[10px] text-slate-400 font-mono">re_emergent</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!fWithMovies.undiscovered} onChange={e => set('undiscovered', e.target.checked)}
                  className="w-3 h-3 accent-amber-500" />
                <span className="text-[10px] text-slate-400 font-mono">undiscovered</span>
              </label>
            </div>
          </div>

          {/* Shadowing */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5 flex items-center">
                Shadowing
                <InfoTooltip text="This faction shadows another (appears as rebels of the shadowed faction). Both must share the same culture and a general unit." />
              </div>
              <SearchableSelect
                value={fWithMovies.shadowing || ''}
                options={['', ...allFactionNames.filter(n => n !== fWithMovies.name)]}
                onChange={v => set('shadowing', v || undefined)}
              />
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5 flex items-center">
                Shadowed By
                <InfoTooltip text="This faction is shadowed by another faction. Rebels of this faction belong to the shadowing faction." />
              </div>
              <SearchableSelect
                value={fWithMovies.shadowedBy || ''}
                options={['', ...allFactionNames.filter(n => n !== fWithMovies.name)]}
                onChange={v => set('shadowedBy', v || undefined)}
              />
            </div>
          </div>

          {/* Faction Movies (descr_faction_movies.xml) */}
          <div>
            <div className="text-[9px] text-slate-500 uppercase font-semibold mb-1 flex items-center">
              Faction Movies (data/fmv/)
              <InfoTooltip text="Paths relative to data/fmv/. Missing .bik files can cause a crash. The game first checks the mod folder, then falls back to the base M2TW data/fmv/." />
            </div>
            <div className="space-y-1">
              {['intro', 'victory', 'defeat', 'death'].map(field => (
                <div key={field} className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500 w-12 shrink-0 font-mono">{field}</span>
                  <input
                    value={fWithMovies.movies?.[field] || ''}
                    onChange={e => set('movies', { ...(fWithMovies.movies || {}), [field]: e.target.value })}
                    placeholder={`faction/${f.name}_${field}.bik`}
                    className="flex-1 h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono placeholder-slate-700"
                  />
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Diplomacy editor ──────────────────────────────────────────────────────────
function DiplomacyEditor({ stratData, allFactionNames, onStratDataChange }) {
  const [diploTab, setDiploTab] = useState('standings');
  const standings = stratData?.factionStandings || [];
  const relationships = stratData?.factionRelationships || [];

  const addStanding = () => {
    onStratDataChange({
      ...stratData,
      factionStandings: [...standings, { faction: allFactionNames[0] || '', value: 0, targets: [allFactionNames[1] || ''] }]
    });
  };

  const updateStanding = (i, field, val) => {
    const updated = standings.map((s, idx) => idx === i ? { ...s, [field]: val } : s);
    onStratDataChange({ ...stratData, factionStandings: updated });
  };

  const removeStanding = (i) => {
    onStratDataChange({ ...stratData, factionStandings: standings.filter((_, idx) => idx !== i) });
  };

  const addRelationship = () => {
    onStratDataChange({
      ...stratData,
      factionRelationships: [...relationships, { faction: allFactionNames[0] || '', relation: 'at_war_with', targets: [allFactionNames[1] || ''] }]
    });
  };

  const updateRelationship = (i, field, val) => {
    const updated = relationships.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
    onStratDataChange({ ...stratData, factionRelationships: updated });
  };

  const removeRelationship = (i) => {
    onStratDataChange({ ...stratData, factionRelationships: relationships.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Inner sub-tabs: Standings | Relationships */}
      <div className="flex rounded overflow-hidden border border-slate-700/50 shrink-0">
        <button onClick={() => setDiploTab('standings')}
          className={`flex-1 py-1 text-[9px] font-semibold transition-colors ${diploTab === 'standings' ? 'bg-amber-600/20 text-amber-400' : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'}`}>
          Standings ({standings.length})
        </button>
        <button onClick={() => setDiploTab('relationships')}
          className={`flex-1 py-1 text-[9px] font-semibold transition-colors border-l border-slate-700/50 ${diploTab === 'relationships' ? 'bg-amber-600/20 text-amber-400' : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'}`}>
          Relationships ({relationships.length})
        </button>
      </div>

      {/* faction_standings */}
      {diploTab === 'standings' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <p className="text-[9px] text-slate-500 uppercase font-semibold">Faction Standings
              <InfoTooltip text="Values from -1.00 (hostile) to 1.00 (friendly). Defines initial diplomatic attitude between factions." />
            </p>
            <button onClick={addStanding} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100">+ Add</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {standings.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <select value={s.faction} onChange={e => updateStanding(i, 'faction', e.target.value)}
                  className="h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex-1">
                  {allFactionNames.map(f => <option key={f}>{f}</option>)}
                </select>
                <input type="number" step="0.1" min="-1" max="1" value={s.value}
                  onChange={e => updateStanding(i, 'value', parseFloat(e.target.value))}
                  className="h-5 w-14 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-amber-400 font-mono text-center" />
                <select value={s.targets?.[0] || ''} onChange={e => updateStanding(i, 'targets', [e.target.value])}
                  className="h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex-1">
                  {allFactionNames.map(f => <option key={f}>{f}</option>)}
                </select>
                <button onClick={() => removeStanding(i)} className="text-[9px] text-slate-600 hover:text-red-400">✕</button>
              </div>
            ))}
            {standings.length === 0 && <p className="text-[10px] text-slate-600 italic">No standings defined</p>}
          </div>
        </div>
      )}

      {/* faction_relationships */}
      {diploTab === 'relationships' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <p className="text-[9px] text-slate-500 uppercase font-semibold">Faction Relationships
              <InfoTooltip text="at_war_with or allied_to. Neutral relationships don't need to be listed." />
            </p>
            <button onClick={addRelationship} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100">+ Add</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {relationships.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <select value={r.faction} onChange={e => updateRelationship(i, 'faction', e.target.value)}
                  className="h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex-1">
                  {allFactionNames.map(f => <option key={f}>{f}</option>)}
                </select>
                <select value={r.relation} onChange={e => updateRelationship(i, 'relation', e.target.value)}
                  className="h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-amber-400">
                  <option value="at_war_with">at_war_with</option>
                  <option value="allied_to">allied_to</option>
                </select>
                <select value={r.targets?.[0] || ''} onChange={e => updateRelationship(i, 'targets', [e.target.value])}
                  className="h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex-1">
                  {allFactionNames.map(f => <option key={f}>{f}</option>)}
                </select>
                <button onClick={() => removeRelationship(i)} className="text-[9px] text-slate-600 hover:text-red-400">✕</button>
              </div>
            ))}
            {relationships.length === 0 && <p className="text-[10px] text-slate-600 italic">No special relationships</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Win Conditions editor ─────────────────────────────────────────────────────
function WinConditionsEditor({ winConditions, onWinConditionsChange, regionNames, allFactionNames }) {
  const [search, setSearch] = useState('');
  const [addRegionVal, setAddRegionVal] = useState({});
  if (!winConditions) return <p className="text-[10px] text-slate-600 italic">Load descr_win_conditions.txt to edit</p>;

  const factions = Object.keys(winConditions);

  const setCondField = (faction, field, val) => {
    onWinConditionsChange({ ...winConditions, [faction]: { ...winConditions[faction], [field]: val } });
  };
  const setShortField = (faction, field, val) => {
    onWinConditionsChange({ ...winConditions, [faction]: { ...winConditions[faction], short: { ...winConditions[faction].short, [field]: val } } });
  };

  const addHoldRegion = (faction, reg, isShort) => {
    if (!reg) return;
    const cond = winConditions[faction];
    if (isShort) setShortField(faction, 'holdRegions', [...(cond.short?.holdRegions || []), reg]);
    else setCondField(faction, 'holdRegions', [...(cond.holdRegions || []), reg]);
  };
  const removeHoldRegion = (faction, reg, isShort) => {
    const cond = winConditions[faction];
    if (isShort) setShortField(faction, 'holdRegions', (cond.short?.holdRegions || []).filter(r => r !== reg));
    else setCondField(faction, 'holdRegions', (cond.holdRegions || []).filter(r => r !== reg));
  };

  return (
    <div className="space-y-2">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter factions…"
        className="w-full h-6 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
      <div className="space-y-2">
        {factions.filter(f => !search || f.includes(search)).map(faction => {
          const cond = winConditions[faction];
          return (
            <div key={faction} className="rounded border border-slate-700/40 bg-slate-900/20 px-2 py-1.5 space-y-2">
              <p className="text-[10px] font-mono font-semibold text-amber-400">{faction}</p>

              {/* Long campaign */}
              <div className="space-y-1">
                <p className="text-[9px] text-slate-500 uppercase font-semibold border-b border-slate-700/40 pb-0.5">Long Campaign</p>
                <div>
                  <span className="text-[9px] text-slate-500">take_regions</span>
                  <input type="number" value={cond.takeRegions || 0} onChange={e => setCondField(faction, 'takeRegions', parseInt(e.target.value)||0)}
                    className="h-5 w-full px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">hold_regions</span>
                  <div className="flex flex-wrap gap-0.5 mb-0.5">
                    {(cond.holdRegions || []).map(r => (
                      <span key={r} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-700/50 rounded text-[9px] text-green-400 font-mono">
                        {r}<button onClick={() => removeHoldRegion(faction, r, false)} className="text-slate-600 hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <select
                      value={addRegionVal[`${faction}_long`] || ''}
                      onChange={e => setAddRegionVal(v => ({...v, [`${faction}_long`]: e.target.value}))}
                      className="flex-1 h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                      <option value="">— add region —</option>
                      {(regionNames || []).filter(r => !(cond.holdRegions || []).includes(r)).map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button onClick={() => { addHoldRegion(faction, addRegionVal[`${faction}_long`], false); setAddRegionVal(v => ({...v, [`${faction}_long`]: ''})); }}
                      className="text-[9px] px-1 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100">+</button>
                  </div>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">outlive</span>
                  <div className="flex flex-wrap gap-0.5">
                    {(cond.outlive || []).map(f => (
                      <span key={f} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-700/50 rounded text-[9px] text-red-400 font-mono">
                        {f}<button onClick={() => setCondField(faction, 'outlive', (cond.outlive || []).filter(x => x !== f))} className="text-slate-600 hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <select value="" onChange={e => { if (e.target.value) setCondField(faction, 'outlive', [...(cond.outlive||[]), e.target.value]); }}
                    className="w-full h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 mt-0.5">
                    <option value="">— outlive faction —</option>
                    {allFactionNames.filter(f => !(cond.outlive||[]).includes(f)).map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {/* Short campaign */}
              <div className="space-y-1">
                <p className="text-[9px] text-slate-500 uppercase font-semibold border-b border-slate-700/40 pb-0.5">Short Campaign</p>
                <div>
                  <span className="text-[9px] text-slate-500">take_regions</span>
                  <input type="number" value={cond.short?.takeRegions || 0} onChange={e => setShortField(faction, 'takeRegions', parseInt(e.target.value)||0)}
                    className="h-5 w-full px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">hold_regions</span>
                  <div className="flex flex-wrap gap-0.5 mb-0.5">
                    {(cond.short?.holdRegions || []).map(r => (
                      <span key={r} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-700/50 rounded text-[9px] text-green-400 font-mono">
                        {r}<button onClick={() => removeHoldRegion(faction, r, true)} className="text-slate-600 hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <select
                      value={addRegionVal[`${faction}_short`] || ''}
                      onChange={e => setAddRegionVal(v => ({...v, [`${faction}_short`]: e.target.value}))}
                      className="flex-1 h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                      <option value="">— add region —</option>
                      {(regionNames || []).filter(r => !(cond.short?.holdRegions || []).includes(r)).map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button onClick={() => { addHoldRegion(faction, addRegionVal[`${faction}_short`], true); setAddRegionVal(v => ({...v, [`${faction}_short`]: ''})); }}
                      className="text-[9px] px-1 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100">+</button>
                  </div>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">outlive</span>
                  <div className="flex flex-wrap gap-0.5">
                    {(cond.short?.outlive || []).map(f => (
                      <span key={f} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-700/50 rounded text-[9px] text-red-400 font-mono">
                        {f}<button onClick={() => setShortField(faction, 'outlive', (cond.short?.outlive||[]).filter(x => x !== f))} className="text-slate-600 hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <select value="" onChange={e => { if (e.target.value) setShortField(faction, 'outlive', [...(cond.short?.outlive||[]), e.target.value]); }}
                    className="w-full h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 mt-0.5">
                    <option value="">— outlive faction —</option>
                    {allFactionNames.filter(f => !(cond.short?.outlive||[]).includes(f)).map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function FactionsCampaignTab({
  stratData, factionColors, onStratDataChange,
  winConditions, onWinConditionsChange,
  factionMovies, onFactionMoviesChange,
  regionNames, units,
}) {
  const [subTab, setSubTab] = useState('factions');
  const [search, setSearch] = useState('');
  const [newFactionName, setNewFactionName] = useState('');
  const [newFactionStatus, setNewFactionStatus] = useState('nonplayable');

  const allFactionNames = useMemo(() => {
    const from = (stratData?.factions || []).map(f => f.name).filter(Boolean);
    const fromLists = [...(stratData?.playable || []), ...(stratData?.unlockable || []), ...(stratData?.nonplayable || [])];
    return [...new Set([...from, ...fromLists])].sort();
  }, [stratData]);

  const handleFactionUpdate = (name, updatedFaction) => {
    if (!stratData) return;
    const factions = (stratData.factions || []).map(f => f.name === name ? updatedFaction : f);
    onStratDataChange({ ...stratData, factions });
  };

  const handleMoviesChange = (factionName, movies) => {
    onFactionMoviesChange?.({ ...(factionMovies || {}), [factionName]: movies });
  };

  const handleAddFaction = () => {
    if (!stratData) return;
    const name = sanitizeFactionName(newFactionName);
    if (!name || allFactionNames.includes(name)) return;
    const nextFaction = {
      name,
      economicAI: '',
      militaryAI: '',
      aiLabel: name === 'slave' ? 'slave_faction' : 'default',
      treasury: 0,
      kingsPurse: 0,
      deadUntilResurrected: false,
      deadUntilEmerged: false,
      reEmergent: false,
      undiscovered: false,
      settlements: [],
      characters: [],
      characterRecords: [],
      relatives: [],
    };
    const withoutName = (arr) => (arr || []).filter(f => f !== name);
    const next = {
      ...stratData,
      factions: [...(stratData.factions || []), nextFaction],
      playable: withoutName(stratData.playable),
      unlockable: withoutName(stratData.unlockable),
      nonplayable: withoutName(stratData.nonplayable),
    };
    if (newFactionStatus && newFactionStatus !== 'none') {
      next[newFactionStatus] = [...next[newFactionStatus], name];
    }
    onStratDataChange(next);
    setNewFactionName('');
    setSearch(name);
  };

  const filteredFactions = useMemo(() =>
    (stratData?.factions || []).filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase())),
    [stratData?.factions, search]
  );

  if (!stratData?.raw) {
    return <div className="p-3 text-[10px] text-slate-600 text-center">Load descr_strat.txt to edit faction data</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-800 shrink-0">
        {[['factions','Factions'],['diplomacy','Diplomacy'],['victory','Victory']].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex-1 py-1 text-[9px] font-semibold border-b-2 transition-colors ${subTab === id ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {subTab === 'factions' && (
          <>
            <div className="rounded border border-slate-700/50 bg-slate-900/40 p-2 space-y-1.5">
              <p className="text-[9px] text-slate-500 uppercase font-semibold">Add Faction Field</p>
              <div className="flex gap-1.5">
                <input
                  value={newFactionName}
                  onChange={e => setNewFactionName(e.target.value)}
                  placeholder="faction_name"
                  className="flex-1 h-6 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono placeholder-slate-600"
                />
                <select
                  value={newFactionStatus}
                  onChange={e => setNewFactionStatus(e.target.value)}
                  className="h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-300"
                >
                  <option value="playable">playable</option>
                  <option value="unlockable">unlockable</option>
                  <option value="nonplayable">nonplayable</option>
                  <option value="none">not listed</option>
                </select>
                <button
                  onClick={handleAddFaction}
                  disabled={!sanitizeFactionName(newFactionName) || allFactionNames.includes(sanitizeFactionName(newFactionName))}
                  className="h-6 flex items-center gap-1 px-2 rounded text-[10px] bg-amber-600/20 border border-amber-500/35 text-amber-300 hover:bg-amber-600/35 disabled:opacity-40 transition-colors">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search factions…"
              className="w-full h-6 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
            {filteredFactions.length === 0 && <p className="text-[10px] text-slate-600 italic text-center py-2">No faction blocks in descr_strat.txt</p>}
            <div className="space-y-0.5">
              {filteredFactions.map(f => (
                <FactionRow
                  key={f.name}
                  faction={f}
                  allFactionNames={allFactionNames}
                  regionNames={regionNames}
                  units={units}
                  onUpdate={handleFactionUpdate}
                  factionMovies={factionMovies}
                  onMoviesChange={handleMoviesChange}
                />
              ))}
            </div>
          </>
        )}
        {subTab === 'diplomacy' && (
          <div className="rounded border border-slate-700/40 bg-slate-900/30 p-2.5 flex flex-col" style={{ minHeight: '60vh' }}>
            <DiplomacyEditor
              stratData={stratData}
              allFactionNames={allFactionNames}
              onStratDataChange={onStratDataChange}
            />
          </div>
        )}
        {subTab === 'victory' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Win Conditions</p>
              <label className="cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100">
                Load file
                <input type="file" accept=".txt" className="hidden" onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  const text = await file.text();
                  e.target.value = '';
                  try { sessionStorage.setItem('m2tw_win_conditions_raw', text); } catch {}
                  onWinConditionsChange(parseWinConditions(text));
                }} />
              </label>
            </div>
            <WinConditionsEditor
              winConditions={winConditions}
              onWinConditionsChange={onWinConditionsChange}
              regionNames={regionNames}
              allFactionNames={allFactionNames}
            />
          </div>
        )}
      </div>
    </div>
  );
}
