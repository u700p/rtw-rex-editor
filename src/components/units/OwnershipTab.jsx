import React, { useMemo, useState, useRef, useEffect } from 'react';
import { AlertCircle, X, ChevronDown } from 'lucide-react';
import { useRefData } from '../edb/RefDataContext';
import { OWNERSHIP_FACTIONS } from './EDUParser';

// Searchable add-faction dropdown + tag pills
function FactionTagSelect({ label, selected = [], onChange, allFactions }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const available = useMemo(() =>
    allFactions.filter(f => !selected.includes(f) && f.toLowerCase().includes(search.toLowerCase())),
    [allFactions, selected, search]
  );

  const add = (f) => { onChange([...selected, f]); setSearch(''); };
  const remove = (f) => onChange(selected.filter(x => x !== f));

  return (
    <div className="space-y-1.5">
      {label && <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>}

      {/* Tag pills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map(f => (
            <span key={f} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-foreground text-[10px] font-mono rounded border border-primary/20">
              {f}
              <button onClick={() => remove(f)} className="text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add dropdown */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 border border-blue-400/30 hover:border-blue-400/60 rounded transition-colors"
        >
          + Add faction <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute z-50 top-7 left-0 w-56 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-1.5 border-b border-border">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search faction…"
                className="w-full h-6 px-2 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {available.length === 0 ? (
                <p className="px-3 py-2 text-[10px] text-muted-foreground">No factions found</p>
              ) : available.map(f => (
                <button
                  key={f}
                  onClick={() => { add(f); setOpen(false); }}
                  className="w-full text-left px-2.5 py-1 text-[11px] font-mono text-foreground hover:bg-accent transition-colors"
                >
                  {f}
                </button>
              ))}
            </div>
            {selected.length > 0 && (
              <div className="border-t border-border p-1.5">
                <button onClick={() => { onChange([]); setOpen(false); }} className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground px-1">
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OwnershipTab({ unit, onChange, modeldb }) {
  const { factions: refFactions } = useRefData();

  const allFactions = useMemo(() => {
    if (!refFactions || refFactions.length <= 5) return OWNERSHIP_FACTIONS;
    const extra = refFactions.filter(f => !OWNERSHIP_FACTIONS.includes(f));
    return [...OWNERSHIP_FACTIONS, ...extra];
  }, [refFactions]);

  const set = (key, val) => onChange({ ...unit, [key]: val });

  const allOwned = useMemo(() => new Set([
    ...(unit.ownership || []),
    ...(unit.era0 || []),
    ...(unit.era1 || []),
    ...(unit.era2 || []),
  ]), [unit.ownership, unit.era0, unit.era1, unit.era2]);

  const missingFromModeldb = useMemo(() => {
    if (!modeldb || !allOwned.size) return [];
    const soldierKey = (unit.soldier_model || '').trim().toLowerCase();
    const entry = soldierKey ? modeldb.byName?.[soldierKey] : null;
    if (!entry) return [];
    const entryFactions = new Set((entry.factions || []).map(f => f.faction?.toLowerCase()));
    return [...allOwned].filter(f => {
      if (!f || f === 'slave' || f === 'rebels' || f.endsWith('_rebels')) return false;
      return !entryFactions.has(f.toLowerCase());
    });
  }, [allOwned, modeldb, unit.soldier_model]);

  return (
    <div className="space-y-5">
      {missingFromModeldb.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 bg-amber-950/30 border border-amber-700/50 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-semibold text-amber-300">Missing ModelDB faction textures</p>
            <p className="text-[10px] text-amber-400/80 mt-0.5">
              These factions own this unit but have no texture entry in battle_models.modeldb for <code className="font-mono bg-amber-950/50 px-0.5 rounded">{unit.soldier_model}</code>:
            </p>
            <p className="text-[10px] font-mono text-amber-300 mt-1 break-all">{missingFromModeldb.join(', ')}</p>
          </div>
        </div>
      )}

      <FactionTagSelect
        label="Ownership"
        selected={unit.ownership || []}
        onChange={v => set('ownership', v)}
        allFactions={allFactions}
      />

      <div className="space-y-4">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Era Availability</p>
        <p className="text-[10px] text-muted-foreground -mt-2">Leave empty = always available.</p>
        {[
          { key: 'era0', label: 'Era 0 — Early' },
          { key: 'era1', label: 'Era 1 — High' },
          { key: 'era2', label: 'Era 2 — Late' },
        ].map(({ key, label }) => (
          <FactionTagSelect
            key={key}
            label={label}
            selected={unit[key] || []}
            onChange={v => set(key, v)}
            allFactions={allFactions}
          />
        ))}
      </div>
    </div>
  );
}