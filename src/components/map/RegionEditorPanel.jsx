import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Download, ChevronDown } from 'lucide-react';
import { serializeDescrRegions, serializeDescrStrat } from './stratParser';
import { downloadBlob } from './tgaExporter';

// ── Helpers ───────────────────────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() =>
    (options || []).filter(o => o.toLowerCase().includes(q.toLowerCase())),
    [options, q]
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQ(''); }}
        className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 flex items-center justify-between font-mono"
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className="w-3 h-3 shrink-0 ml-1 text-slate-500" />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-600/50 rounded shadow-xl max-h-40 flex flex-col">
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            className="h-6 px-2 text-[11px] bg-slate-700 border-b border-slate-600/50 rounded-t text-slate-200 placeholder-slate-500 outline-none"
          />
          <div className="overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-700 text-left italic"
            >— none —</button>
            {filtered.map(o => (
              <button
                key={o}
                type="button"
                onClick={() => { onChange(o); setOpen(false); }}
                className={`w-full px-2 py-0.5 text-[11px] text-left hover:bg-slate-700 font-mono ${value === o ? 'text-amber-300 bg-amber-900/20' : 'text-slate-200'}`}
              >{o}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, mono = true, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={`h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full ${mono ? 'font-mono' : ''}`}
      {...rest}
    />
  );
}

// Multi-select tags for resources / hidden_resources
function TagSelect({ selected, options, onChange }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() =>
    (options || []).filter(o => !selected.includes(o) && o.toLowerCase().includes(q.toLowerCase())),
    [options, selected, q]
  );
  const remove = (tag) => onChange(selected.filter(t => t !== tag));
  const add    = (tag) => { onChange([...selected, tag]); setQ(''); };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 min-h-5">
        {selected.map(tag => (
          <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0 rounded bg-amber-900/30 border border-amber-700/40 text-[10px] text-amber-300 font-mono">
            {tag}
            <button onClick={() => remove(tag)} className="ml-0.5 text-amber-600 hover:text-amber-300"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
      </div>
      {options?.length > 0 && (
        <div className="relative">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Add…"
            className="w-full h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600 font-mono"
          />
          {q && filtered.length > 0 && (
            <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-slate-800 border border-slate-600/50 rounded shadow-xl max-h-28 overflow-y-auto">
              {filtered.slice(0, 20).map(o => (
                <button key={o} type="button"
                  onClick={() => add(o)}
                  className="w-full px-2 py-0.5 text-[11px] text-left hover:bg-slate-700 font-mono text-slate-200">
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Religions editor — sum must equal 100
function ReligionsEditor({ religions, availableReligions, onChange }) {
  const total = Object.values(religions || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const allRels = useMemo(() => {
    const existing = Object.keys(religions || {});
    const extra = (availableReligions || []).filter(r => !existing.includes(r));
    return [...existing, ...extra];
  }, [religions, availableReligions]);

  const set = (key, val) => {
    onChange({ ...religions, [key]: parseInt(val) || 0 });
  };
  const add = (key) => {
    if (!key || key in (religions || {})) return;
    onChange({ ...(religions || {}), [key]: 0 });
  };
  const remove = (key) => {
    const next = { ...(religions || {}) };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-1">
      {Object.entries(religions || {}).map(([rel, val]) => (
        <div key={rel} className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-slate-300 w-24 truncate shrink-0">{rel}</span>
          <input
            type="number" min={0} max={100}
            value={val}
            onChange={e => set(rel, e.target.value)}
            className="flex-1 h-5 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono"
          />
          <button onClick={() => remove(rel)} className="text-slate-600 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
        </div>
      ))}
      <div className={`text-[10px] font-mono font-semibold ${total === 100 ? 'text-green-400' : 'text-red-400'}`}>
        Total: {total} / 100 {total !== 100 && '⚠ Must equal 100'}
      </div>
      {availableReligions?.filter(r => !(r in (religions || {}))).length > 0 && (
        <select
          defaultValue=""
          onChange={e => { add(e.target.value); e.target.value = ''; }}
          className="w-full h-5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-400"
        >
          <option value="">+ Add religion…</option>
          {availableReligions.filter(r => !(r in (religions || {}))).map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      )}
    </div>
  );
}

const SETTLEMENT_LEVELS = ['village', 'town', 'large_town', 'city', 'large_city', 'huge_city'];

// ── Main Component ─────────────────────────────────────────────────────────────
export default function RegionEditorPanel({
  region,           // the region object from regionsData
  stratSettlement,  // the matching settlement from stratData.items
  onClose,
  // data sources
  regionsData,
  stratData,
  factionList,      // string[]
  rebelFactionList, // string[]
  religionList,     // string[]
  naturalResourceList, // string[]
  hiddenResourceList,  // string[]
  buildingLevelList,   // {name, building}[]
  mercenaryPoolList,   // string[]
  musicTypeList,       // string[]
  settlementNamesMap,  // { [key]: displayName }
  // callbacks
  onRegionChange,     // (updatedRegion) => void
  onStratChange,      // (settlementId, edits) => void
  onExportRegions,
  onExportStrat,
}) {
  const [tab, setTab] = useState('region'); // 'region' | 'strat'
  const [reg, setReg] = useState(() => ({ ...region }));
  const [strat, setStrat] = useState(() => ({ ...stratSettlement }));
  const [dirty, setDirty] = useState(false);

  // Sync if region prop changes
  React.useEffect(() => { setReg({ ...region }); setDirty(false); }, [region]);
  React.useEffect(() => { setStrat({ ...(stratSettlement || {}) }); }, [stratSettlement]);

  const updateReg = useCallback((key, val) => {
    setReg(r => ({ ...r, [key]: val }));
    setDirty(true);
  }, []);

  const updateRegionExtraLines = useCallback((text) => {
    const extraDataLines = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    setReg(r => {
      const hasReligionTail = r._hasReligions || Object.keys(r.religions || {}).length > 0;
      return {
        ...r,
        extraDataLines,
        _regionTail: [
          ...(hasReligionTail ? [{ kind: 'religions' }] : []),
          ...extraDataLines.map(value => ({ kind: 'extra', value })),
        ],
      };
    });
    setDirty(true);
  }, []);

  const updateStrat = useCallback((key, val) => {
    setStrat(s => ({ ...s, [key]: val }));
    setDirty(true);
  }, []);

  const save = () => {
    onRegionChange(reg);
    if (stratSettlement && onStratChange) {
      onStratChange(stratSettlement.id, strat);
    }
    setDirty(false);
  };

  const regionDisplayName = settlementNamesMap?.[reg.regionName] || reg.regionName;
  const settlDisplayName  = settlementNamesMap?.[reg.settlementName] || reg.settlementName;

  // All resources = natural + hidden combined
  const allCurrentResources = reg.resources || [];
  const naturalResources = allCurrentResources.filter(r => (naturalResourceList || []).includes(r));
  const hiddenResources  = allCurrentResources.filter(r => !naturalResources.includes(r));

  const tabs = [
    { id: 'region', label: 'Region (descr_regions)' },
    { id: 'strat',  label: 'Strat (descr_strat)' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0 bg-slate-900/60">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-amber-300 truncate">{regionDisplayName}</p>
          <p className="text-[9px] text-slate-500 font-mono truncate">{reg.regionName}</p>
        </div>
        <div className="w-5 h-5 rounded border border-slate-600/50 shrink-0" style={{ background: `rgb(${reg.r},${reg.g},${reg.b})` }} />
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 shrink-0"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-slate-800 shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-1 text-[9px] font-semibold border-b-2 transition-colors truncate px-1 ${tab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">

        {/* ── REGION TAB (descr_regions.txt) ── */}
        {tab === 'region' && (
          <>
            <Field label="Region Internal Name">
              <TextInput value={reg.regionName} onChange={v => updateReg('regionName', v)} />
            </Field>
            {regionDisplayName !== reg.regionName && (
              <Field label="Region Display Name (text loc)">
                <input value={regionDisplayName} readOnly
                  className="h-6 px-1.5 text-[11px] bg-slate-900 border border-slate-700/40 rounded text-slate-400 w-full font-mono cursor-not-allowed" />
              </Field>
            )}

            <Field label="Settlement Internal Name">
              <TextInput value={reg.settlementName} onChange={v => updateReg('settlementName', v)} />
            </Field>
            {settlDisplayName !== reg.settlementName && (
              <Field label="Settlement Display Name (text loc)">
                <input value={settlDisplayName} readOnly
                  className="h-6 px-1.5 text-[11px] bg-slate-900 border border-slate-700/40 rounded text-slate-400 w-full font-mono cursor-not-allowed" />
              </Field>
            )}

            <Field label="RGB Color">
              <div className="flex gap-1.5 items-center">
                <input type="color"
                  value={`#${[reg.r, reg.g, reg.b].map(c => Math.max(0, Math.min(255, c || 0)).toString(16).padStart(2, '0')).join('')}`}
                  onChange={e => {
                    const hex = e.target.value;
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    setReg(prev => ({ ...prev, r, g, b }));
                    setDirty(true);
                  }}
                  className="w-8 h-6 rounded border border-slate-600/40 bg-slate-800 cursor-pointer"
                />
                <input type="number" min={0} max={255} value={reg.r ?? 0}
                  onChange={e => updateReg('r', parseInt(e.target.value) || 0)}
                  className="flex-1 h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-red-300 font-mono" placeholder="R" />
                <input type="number" min={0} max={255} value={reg.g ?? 0}
                  onChange={e => updateReg('g', parseInt(e.target.value) || 0)}
                  className="flex-1 h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-green-300 font-mono" placeholder="G" />
                <input type="number" min={0} max={255} value={reg.b ?? 0}
                  onChange={e => updateReg('b', parseInt(e.target.value) || 0)}
                  className="flex-1 h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-blue-300 font-mono" placeholder="B" />
              </div>
            </Field>

            <Field label="Faction Creator">
              <SearchableSelect value={reg.factionCreator} onChange={v => updateReg('factionCreator', v)} options={factionList} placeholder="faction_creator…" />
            </Field>

            <Field label="Rebel Faction">
              <SearchableSelect value={reg.rebelFaction} onChange={v => updateReg('rebelFaction', v)} options={rebelFactionList} placeholder="rebel faction…" />
            </Field>

            <Field label="Natural Resources (from map)">
              <TagSelect
                selected={naturalResources}
                options={naturalResourceList || []}
                onChange={sel => updateReg('resources', [...sel, ...hiddenResources])}
              />
            </Field>

            <Field label="Hidden Resources (from EDB)">
              <TagSelect
                selected={hiddenResources}
                options={hiddenResourceList || []}
                onChange={sel => updateReg('resources', [...naturalResources, ...sel])}
              />
            </Field>

            <Field label="Victory / Triumph Points">
              <TextInput type="number" value={reg.val1} onChange={v => updateReg('val1', parseInt(v) || 0)} />
            </Field>

            <Field label="Farm / Agriculture Level">
              <TextInput type="number" value={reg.val2} onChange={v => updateReg('val2', parseInt(v) || 0)} />
            </Field>

            <Field label="Religions (sum = 100)">
              <ReligionsEditor
                religions={reg.religions}
                availableReligions={religionList}
                onChange={v => updateReg('religions', v)}
              />
            </Field>

            <Field label="Extra descr_regions Lines">
              <textarea
                value={(reg.extraDataLines || []).join('\n')}
                onChange={e => updateRegionExtraLines(e.target.value)}
                placeholder="Custom per-region data lines are preserved here"
                className="min-h-14 px-1.5 py-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 w-full font-mono resize-y"
              />
            </Field>

            {mercenaryPoolList?.length > 0 && (
              <Field label="Mercenary Pool">
                <SearchableSelect value={reg.mercenaryPool} onChange={v => updateReg('mercenaryPool', v)} options={mercenaryPoolList} placeholder="mercenary pool…" />
              </Field>
            )}

            {musicTypeList?.length > 0 && (
              <Field label="Music Type">
                <SearchableSelect value={reg.musicType} onChange={v => updateReg('musicType', v)} options={musicTypeList} placeholder="music type…" />
              </Field>
            )}
          </>
        )}

        {/* ── STRAT TAB (descr_strat.txt) ── */}
        {tab === 'strat' && (
          stratSettlement ? (
            <>
              <Field label="Owning Faction">
                <SearchableSelect value={strat.faction} onChange={v => updateStrat('faction', v)} options={factionList} placeholder="faction…" />
              </Field>

              <Field label="Settlement Level">
                <select value={strat.level || 'village'}
                  onChange={e => updateStrat('level', e.target.value)}
                  className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                  {SETTLEMENT_LEVELS.map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>

              <Field label="Type">
                <div className="flex gap-2">
                  {['city', 'castle'].map(t => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="settl_type" value={t}
                        checked={(strat.planSet || 'default') === t || (t === 'city' && (strat.planSet || 'default') === 'default')}
                        onChange={() => updateStrat('planSet', t)}
                        className="accent-amber-500" />
                      <span className="text-[11px] text-slate-300 capitalize">{t}</span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Population">
                <TextInput type="number" value={strat.population} onChange={v => updateStrat('population', parseInt(v) || 0)} />
              </Field>

              <Field label="Year Founded">
                <TextInput type="number" value={strat.yearFounded} onChange={v => updateStrat('yearFounded', parseInt(v) || 0)} />
              </Field>

              <Field label="Buildings (upgrades)">
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-1 min-h-5">
                    {(strat.upgrades || []).map((u, idx) => (
                      <span key={idx} className="flex items-center gap-0.5 px-1.5 py-0 rounded bg-slate-700/50 border border-slate-600/40 text-[10px] text-slate-300 font-mono">
                        {u}
                        <button onClick={() => {
                          const next = (strat.upgrades || []).filter((_, i) => i !== idx);
                          updateStrat('upgrades', next);
                        }} className="ml-0.5 text-slate-600 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                  {buildingLevelList?.length > 0 && (
                    <select defaultValue=""
                      onChange={e => {
                        if (!e.target.value) return;
                        if (!(strat.upgrades || []).includes(e.target.value)) {
                          updateStrat('upgrades', [...(strat.upgrades || []), e.target.value]);
                        }
                        e.target.value = '';
                      }}
                      className="w-full h-5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-400">
                      <option value="">+ Add building level…</option>
                      {buildingLevelList.map(b => (
                        <option key={b.name} value={b.name}>{b.name} ({b.building})</option>
                      ))}
                    </select>
                  )}
                </div>
              </Field>
            </>
          ) : (
            <div className="text-[10px] text-slate-600 text-center py-6">
              No matching settlement found in descr_strat.txt for region <span className="font-mono text-slate-500">{reg.regionName}</span>
            </div>
          )
        )}
      </div>

      {/* Save / Export bar */}
      <div className="shrink-0 border-t border-slate-800 p-2 flex gap-1.5 flex-wrap bg-slate-900/50">
        <button
          onClick={save}
          disabled={!dirty}
          className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-amber-600/80 hover:bg-amber-600 disabled:opacity-40 text-slate-900 transition-colors"
        >
          Apply Changes
        </button>
        <button
          onClick={onExportRegions}
          className="px-2 py-1.5 rounded text-[10px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 flex items-center gap-1"
        >
          <Download className="w-3 h-3" /> Regions
        </button>
        {stratSettlement && (
          <button
            onClick={onExportStrat}
            className="px-2 py-1.5 rounded text-[10px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Strat
          </button>
        )}
      </div>
    </div>
  );
}
