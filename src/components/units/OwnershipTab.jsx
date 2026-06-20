import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useRefData } from '../edb/RefDataContext';
import { OWNERSHIP_FACTIONS } from './EDUParser';

function FactionMultiSelect({ label, selected = [], onChange, allFactions }) {
  const toggle = (f) => {
    if (selected.includes(f)) onChange(selected.filter(x => x !== f));
    else onChange([...selected, f]);
  };

  return (
    <div className="space-y-1.5">
      {label && <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>}
      <div className="flex gap-2 mb-1">
        <button onClick={() => onChange([...allFactions])} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">All</button>
        <button onClick={() => onChange([])} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">None</button>
        <span className="text-[10px] text-muted-foreground ml-auto">{selected.length} selected</span>
      </div>
      <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
        {allFactions.map(f => (
          <label key={f} className={`flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors text-[11px] font-mono ${selected.includes(f) ? 'bg-primary/10 text-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground'}`}>
            <input type="checkbox" checked={selected.includes(f)} onChange={() => toggle(f)} className="w-3 h-3 rounded accent-primary" />
            {f}
          </label>
        ))}
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

  // All factions mentioned across ownership + eras
  const allOwned = useMemo(() => new Set([
    ...(unit.ownership || []),
    ...(unit.era0 || []),
    ...(unit.era1 || []),
    ...(unit.era2 || []),
  ]), [unit.ownership, unit.era0, unit.era1, unit.era2]);

  // Which of those are missing from the modeldb entry for this unit
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

      <FactionMultiSelect
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
          <FactionMultiSelect
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