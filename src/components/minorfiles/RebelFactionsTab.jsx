import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Download, Plus, X, AlertCircle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { encodeStringsBin, parseStringsBin } from '../strings/stringsBinCodec';
import { getStringsBinStore } from '@/lib/stringsBinStore';
import RebelFactionRow from './RebelFactionRow';
import { useRefData } from '../edb/RefDataContext';
import { textBlob, toCRLF } from '@/lib/lineEndings';

// ─── Parser ──────────────────────────────────────────────────────────────────
// Format (M2TW descr_rebel_factions.txt):
//   rebel_type     <name>
//     category     <gladiator_revolt|brigands|pirates|peasant_revolt>
//     chance       <int>
//     description  <internal_key>
//     unit         <UnitType>,  <min_exp>, <max_count>
//     unit         ...
// Lines starting with ; are comments and must be ignored.
function parseRebelFactionsFull(text) {
  const factions = [];
  let current = null;
  for (const raw of text.split('\n')) {
    // Strip inline comments (semicolon and everything after)
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    // Support rebel_type (correct keyword), rebel_faction and faction (legacy/alternate)
    const m = line.match(/^rebel_type\s+(\S+)/i) || line.match(/^rebel_faction\s+(\S+)/i) || line.match(/^faction\s+(\S+)/i);
    if (m) {
      if (current) factions.push(current);
      current = { name: m[1], category: '', chance: 50, description: '', units: [] };
      continue;
    }
    if (!current) continue;
    let cm;
    if ((cm = line.match(/^category\s+(.+)/i))) { current.category = cm[1].trim(); continue; }
    if ((cm = line.match(/^chance\s+(\d+)/i))) { current.chance = parseInt(cm[1]); continue; }
    if ((cm = line.match(/^description\s+(.+)/i))) { current.description = cm[1].trim(); continue; }
    if ((cm = line.match(/^unit\s+(.+)/i))) {
      const parts = cm[1].split(',').map(s => s.trim());
      const unitName = parts[0] || '';
      const minExp = parseInt(parts[1]) || 1;
      const maxCount = parseInt(parts[2]) || 1;
      if (unitName) current.units.push({ unitName, minExp, maxCount });
      continue;
    }
  }
  if (current) factions.push(current);
  return factions;
}

// ─── Serializer ──────────────────────────────────────────────────────────────
function serializeRebelFactions(factions) {
  return toCRLF(factions.map(f => {
    const lines = [`rebel_type\t\t\t\t${f.name}`];
    if (f.category) lines.push(`\tcategory\t\t\t${f.category}`);
    lines.push(`\tchance\t\t\t\t${f.chance ?? 50}`);
    if (f.description) lines.push(`\tdescription\t\t\t${f.description}`);
    for (const u of (f.units || [])) {
      // Pad unit name to 24 chars for alignment
      const padded = u.unitName.padEnd(24, ' ');
      lines.push(`\tunit\t\t\t\t${padded}${u.minExp}, ${u.maxCount}`);
    }
    return lines.join('\n');
  }).join('\n\n'));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const CATEGORIES = ['gladiator_revolt', 'brigands', 'pirates', 'peasant_revolt'];

export default function RebelFactionsTab() {
  const [factions, setFactions] = useState([]);
  const [names, setNames] = useState({});
  const [binMeta, setBinMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const txtInputRef = useRef(null);
  const binInputRef = useRef(null);

  const { units: refUnits } = useRefData();
  // Live unit type names from the loaded/modified EDU, always up-to-date
  const eduUnitNames = useMemo(() => refUnits.map(u => u.type).filter(Boolean), [refUnits]);

  // Auto-load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('m2tw_rebel_factions_file');
      if (raw) {
        setFactions(parseRebelFactionsFull(raw));
        setLoaded(true);
      }
    } catch {}
    // Auto-load strings.bin for rebel faction display names
    try {
      const store = getStringsBinStore();
      const rebelBinEntry = Object.entries(store).find(([k]) => {
        const lk = k.toLowerCase();
        return lk.includes('rebel_faction') || lk.includes('rebel_fac');
      });
      if (rebelBinEntry?.[1]) {
        const map = {};
        for (const e of rebelBinEntry[1].entries) if (e.key) map[e.key] = e.value;
        setNames(map);
        setBinMeta(rebelBinEntry[1].sourceFormat === 'txt' ? null : { magic1: rebelBinEntry[1].magic1 ?? 2, magic2: rebelBinEntry[1].magic2 ?? 2048 });
      }
    } catch {}
  }, []);

  const handleLoadTxt = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const parsed = parseRebelFactionsFull(text);
    setFactions(parsed);
    try {
      // m2tw_rebel_factions_file is the key CampaignMap reads on auto-restore
      localStorage.setItem('m2tw_rebel_factions_file', text);
      sessionStorage.setItem('m2tw_rebel_factions_raw', text);
    } catch {}
    setLoaded(true);
    e.target.value = '';
  };

  const handleLoadBin = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    const decoded = parseStringsBin(buf);
    if (decoded?.entries) {
      const map = {};
      for (const { key, value } of decoded.entries) if (key) map[key] = value;
      setNames(map);
      setBinMeta({ magic1: decoded.magic1, magic2: decoded.magic2 });
    }
    e.target.value = '';
  };

  const handleExportTxt = () => {
    const text = serializeRebelFactions(factions);
    downloadBlob(textBlob(text), 'descr_rebel_factions.txt');
  };

  const handleExportBin = () => {
    const entries = Object.entries(names).map(([key, value]) => ({ key, value }));
    const buf = encodeStringsBin(entries, binMeta?.magic1, binMeta?.magic2);
    downloadBlob(new Blob([new Uint8Array(buf)]), 'rebel_faction_descr.txt.strings.bin');
  };

  const addFaction = () => {
    setFactions(prev => [...prev, { name: 'new_rebel_faction', category: 'brigands', chance: 50, description: '', units: [] }]);
  };

  const updateFaction = (idx, updates) => {
    setFactions(prev => prev.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };

  const removeFaction = (idx) => {
    setFactions(prev => prev.filter((_, i) => i !== idx));
  };

  const issues = useMemo(() => {
    const iss = [];
    const seen = new Set();
    for (const f of factions) {
      if (!f.name) iss.push('Empty faction name');
      if (seen.has(f.name)) iss.push(`Duplicate: ${f.name}`);
      seen.add(f.name);
    }
    return iss;
  }, [factions]);

  const filteredFactions = useMemo(() => {
    if (!search) return factions.map((f, i) => ({ ...f, _idx: i }));
    const s = search.toLowerCase();
    return factions
      .map((f, i) => ({ ...f, _idx: i }))
      .filter(f => f.name.toLowerCase().includes(s) || (names[f.name] || '').toLowerCase().includes(s));
  }, [factions, search, names]);

  return (
    <div className="space-y-3">
      {/* Hidden file inputs */}
      <input ref={txtInputRef} type="file" accept=".txt" className="hidden" onChange={handleLoadTxt} />
      <input ref={binInputRef} type="file" accept=".bin,.strings.bin" className="hidden" onChange={handleLoadBin} />

      {/* Load / Export */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => txtInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-700 border border-slate-500 text-slate-200 hover:bg-slate-600 transition-colors">
          <Upload className="w-3 h-3" /> Load .txt
        </button>
        <button onClick={() => binInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-700 border border-slate-500 text-slate-200 hover:bg-slate-600 transition-colors">
          <Upload className="w-3 h-3" /> Load .strings.bin
        </button>
        <button onClick={handleExportTxt} disabled={!factions.length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/30 border border-amber-500/50 text-amber-300 hover:bg-amber-600/50 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .txt
        </button>
        <button onClick={handleExportBin} disabled={!Object.keys(names).length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/30 border border-amber-500/50 text-amber-300 hover:bg-amber-600/50 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .strings.bin
        </button>
      </div>

      {eduUnitNames.length === 0 && loaded && (
        <div className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-900/20 border border-amber-500/40 rounded p-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Load export_descr_unit.txt from the Home page to enable unit selection.
        </div>
      )}

      {/* Validation */}
      {issues.length > 0 && (
        <div className="rounded border border-red-500/50 bg-red-900/20 p-2 space-y-0.5">
          {issues.map((iss, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] text-red-300">
              <AlertCircle className="w-3 h-3 shrink-0" /> {iss}
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {factions.length > 5 && (
        <div className="flex items-center gap-1.5">
          <Search className="w-3 h-3 text-slate-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search factions…"
            className="flex-1 h-6 px-2 text-[11px] bg-slate-700 border border-slate-500 rounded text-slate-200 placeholder-slate-400" />
          <span className="text-[9px] text-slate-300">{filteredFactions.length}/{factions.length}</span>
        </div>
      )}

      {/* Faction list */}
      <div className="space-y-1.5">
        {filteredFactions.map((f) => (
          <RebelFactionRow
            key={f._idx}
            faction={f}
            displayName={names[f.name] || ''}
            categories={CATEGORIES}
            eduUnitNames={eduUnitNames}
            onUpdate={(updates) => updateFaction(f._idx, updates)}
            onDisplayNameChange={(val) => setNames(prev => ({ ...prev, [f.name]: val }))}
            onRemove={() => removeFaction(f._idx)}
          />
        ))}
      </div>

      <button onClick={addFaction}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-dashed border-slate-500 text-slate-300 hover:text-slate-100 hover:border-slate-300 transition-colors">
        <Plus className="w-3 h-3" /> Add Rebel Faction
      </button>

      {!loaded && factions.length === 0 && (
        <p className="text-[10px] text-slate-400 text-center py-4">Load descr_rebel_factions.txt to start editing (upload here or load from Home page)</p>
      )}
    </div>
  );
}
