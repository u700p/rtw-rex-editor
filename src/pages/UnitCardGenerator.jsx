import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Download, Plus, Trash2, ExternalLink, Search, Info, RefreshCw, X, Image, Copy, ChevronDown } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'm2tw_unitcard_entries';

export const POSE_PRESETS = [
  // Infantry
  { id: 5,   label: 'Infantry — Standing (basic)',      category: 'infantry' },
  { id: 34,  label: 'Infantry — Archer ready',          category: 'infantry' },
  { id: 38,  label: 'Infantry — Eastern archer',        category: 'infantry' },
  { id: 43,  label: 'Infantry — Crossbowman',           category: 'infantry' },
  { id: 51,  label: 'Infantry — Spear + shield',        category: 'infantry' },
  { id: 66,  label: 'Infantry — Alt A',                 category: 'infantry' },
  { id: 128, label: 'Infantry — Alt B',                 category: 'infantry' },
  { id: 139, label: 'Infantry — Alt C',                 category: 'infantry' },
  { id: 508, label: 'Infantry — Alt D',                 category: 'infantry' },
  { id: 615, label: 'Infantry — Alt E',                 category: 'infantry' },
  // Cavalry
  { id: 200, label: 'Cavalry — Mailed horse',           category: 'cavalry' },
  { id: 204, label: 'Cavalry — Heavy horse',            category: 'cavalry' },
  { id: 205, label: 'Cavalry — Fast pony',              category: 'cavalry' },
  { id: 210, label: 'Cavalry — Heavy armored horse',    category: 'cavalry' },
  { id: 212, label: 'Cavalry — Light cavalry',          category: 'cavalry' },
  // Special
  { id: 600, label: 'Boat (skipped by script)',         category: 'special' },
];

const DEFAULT_FACTIONS = [
  'england','france','hre','spain','portugal','milan','venice',
  'papal_states','sicily','egypt','moors','turks','byzantium',
  'russia','mongols','timurids','scotland','hungary','poland',
  'denmark','rebels','slave','mercs','normans',
  'crusaders','aztecs','apaches','chichimec','tlaxcalans',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFactionList() {
  try {
    const raw = localStorage.getItem('m2tw_factions_raw') || sessionStorage.getItem('m2tw_factions_raw');
    if (!raw) return DEFAULT_FACTIONS;
    const matches = [...raw.matchAll(/^faction\s+(\S+)/gm)].map(m => m[1]).filter(Boolean);
    return matches.length > 0 ? matches : DEFAULT_FACTIONS;
  } catch { return DEFAULT_FACTIONS; }
}

function parseEduUnits() {
  try {
    const raw = localStorage.getItem('m2tw_units_file');
    if (!raw) return [];
    return [...raw.matchAll(/^type\s+(\S+)/gm)].map(m => m[1]).filter(Boolean);
  } catch { return []; }
}

function isCavalryPose(poseId) {
  return Number(poseId) >= 200 && Number(poseId) < 600;
}

function newEntry() {
  return {
    id: Date.now() + Math.floor(Math.random() * 10000),
    portraitFilename: '',
    game: 'base',
    faction: 'england',
    poseId: 5,
    additionalObject: '/',
    additionalObjectTexture: '/',
    modelFile: '',
    mainTextureAlb: '',
    mainTexturePbr: '',
    attachTextureAlb: '',
    attachTexturePbr: '',
    outputDir: '',
    visibleModels: '',
  };
}

function serializeInputFile(entries) {
  return entries.map((e, idx) => {
    const cols = [
      idx + 1,
      '#' + e.portraitFilename,
      e.game,
      e.faction,
      e.poseId,
      e.additionalObject || '/',
      e.additionalObjectTexture || '/',
      e.modelFile,
      e.mainTextureAlb,
      e.mainTexturePbr,
      e.attachTextureAlb,
      e.attachTexturePbr,
      e.outputDir || e.faction,
    ];
    if (e.visibleModels && e.visibleModels.trim()) {
      cols.push(...e.visibleModels.trim().split(/\s+/));
    }
    return cols.join('\t') + '\t';
  }).join('\n');
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Entry Form ───────────────────────────────────────────────────────────────

function EntryForm({ entry, factions, onSave, onCancel }) {
  const [d, setD] = useState({ ...entry });
  const set = (k, v) => setD(prev => ({ ...prev, [k]: v }));
  const cavalry = isCavalryPose(d.poseId);

  const handleFactionChange = (faction) => {
    set('faction', faction);
    if (!d.outputDir || d.outputDir === d.faction) set('outputDir', faction);
  };

  return (
    <div className="space-y-2 text-[11px]">
      {/* Portrait filename */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Portrait Filename</p>
        <div className="flex items-center">
          <span className="h-6 px-1.5 bg-slate-700/60 border border-r-0 border-slate-600/40 rounded-l text-slate-400 flex items-center text-[11px]">#</span>
          <input value={d.portraitFilename} onChange={e => set('portraitFilename', e.target.value)}
            placeholder="unit_name"
            className="flex-1 h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded-r text-slate-200 font-mono" />
        </div>
      </div>

      {/* Game + Faction */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Game</p>
          <select value={d.game} onChange={e => set('game', e.target.value)}
            className="w-full h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200">
            <option>base</option>
            <option>kingdoms</option>
          </select>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Faction</p>
          <select value={d.faction} onChange={e => handleFactionChange(e.target.value)}
            className="w-full h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200">
            {factions.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {/* Pose */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Pose ID</p>
        <div className="flex gap-1.5">
          <select value={d.poseId} onChange={e => set('poseId', parseInt(e.target.value))}
            className="flex-1 h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200 text-[10px]">
            {POSE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input type="number" value={d.poseId} onChange={e => set('poseId', parseInt(e.target.value) || 5)}
            className="w-14 h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-400 font-mono text-center" />
        </div>
        {cavalry && <p className="text-[8px] text-amber-400 mt-0.5">⚠ Cavalry pose — fill mount fields below</p>}
      </div>

      {/* Model file */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Model File <span className="text-slate-600">(without _lod0 suffix)</span></p>
        <input value={d.modelFile} onChange={e => set('modelFile', e.target.value)} placeholder="peasant_crossbowmen"
          className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
      </div>

      {/* Mount (cavalry only) */}
      {cavalry && (
        <div>
          <p className="text-[9px] text-amber-400 uppercase font-semibold mb-1">Mount (Additional Object)</p>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <p className="text-[9px] text-slate-500 mb-0.5">Mount Model Name</p>
              <input value={d.additionalObject} onChange={e => set('additionalObject', e.target.value)}
                placeholder="mount_heavy_horse"
                className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
            </div>
            <div>
              <p className="text-[9px] text-slate-500 mb-0.5">Mount Texture</p>
              <input value={d.additionalObjectTexture} onChange={e => set('additionalObjectTexture', e.target.value)}
                placeholder="heavy_horse_england"
                className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
            </div>
          </div>
        </div>
      )}
      {!cavalry && (
        <div className="flex gap-1.5">
          <div className="flex-1">
            <p className="text-[9px] text-slate-500 mb-0.5">Additional Object</p>
            <input value={d.additionalObject} onChange={e => set('additionalObject', e.target.value)}
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>
          <div className="flex-1">
            <p className="text-[9px] text-slate-500 mb-0.5">Add. Object Texture</p>
            <input value={d.additionalObjectTexture} onChange={e => set('additionalObjectTexture', e.target.value)}
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>
        </div>
      )}

      {/* Main textures */}
      <div>
        <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Main Textures <span className="text-slate-600 normal-case">(body / armour)</span></p>
        <div className="space-y-1">
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">Albedo (faction-coloured)</p>
            <input value={d.mainTextureAlb} onChange={e => set('mainTextureAlb', e.target.value)}
              placeholder="EN_Peasant_Padded_england"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">PBR / Normal map (shared)</p>
            <input value={d.mainTexturePbr} onChange={e => set('mainTexturePbr', e.target.value)}
              placeholder="EN_Peasant_Padded_normal"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
        </div>
      </div>

      {/* Attach textures */}
      <div>
        <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Attach Textures <span className="text-slate-600 normal-case">(shield / weapon)</span></p>
        <div className="space-y-1">
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">Albedo _diff</p>
            <input value={d.attachTextureAlb} onChange={e => set('attachTextureAlb', e.target.value)}
              placeholder="Final European CB Gun_england_diff"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">PBR _norm</p>
            <input value={d.attachTexturePbr} onChange={e => set('attachTexturePbr', e.target.value)}
              placeholder="Final European CB Gun_england_norm"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
        </div>
      </div>

      {/* Output dir */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Output Directory <span className="text-slate-600">(usually faction name)</span></p>
        <input value={d.outputDir} onChange={e => set('outputDir', e.target.value)}
          placeholder={d.faction}
          className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
      </div>

      {/* Visible models */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Visible Models <span className="text-slate-600">(optional, space-separated)</span></p>
        <textarea value={d.visibleModels} onChange={e => set('visibleModels', e.target.value)} rows={2}
          placeholder="Arms__Arms__1 Body__Body__03 Helmet__Object01 shield0__heater__pattern_10 ..."
          className="w-full px-1.5 py-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[9px] resize-y placeholder-slate-600" />
      </div>

      <div className="flex gap-1.5 justify-end pt-1 border-t border-slate-700/40">
        <button onClick={onCancel} className="px-2 py-1 text-[10px] rounded border border-slate-700/40 text-slate-400 hover:text-slate-200">Cancel</button>
        <button onClick={() => onSave(d)}
          className="px-3 py-1 text-[10px] rounded bg-amber-600/80 hover:bg-amber-600 text-slate-900 font-semibold">Save Entry</button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnitCardGenerator() {
  const [entries, setEntries] = useState(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [editEntry, setEditEntry] = useState(null); // null = panel closed
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [showPoses, setShowPoses] = useState(false);
  const factions = useMemo(() => parseFactionList(), []);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  }, [entries]);

  const saveEntry = useCallback((draft) => {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === draft.id);
      return idx >= 0 ? prev.map(e => e.id === draft.id ? draft : e) : [...prev, draft];
    });
    setEditEntry(null);
  }, []);

  const deleteEntry = useCallback((id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    setEditEntry(prev => prev?.id === id ? null : prev);
  }, []);

  const importFromEdu = useCallback(() => {
    const units = parseEduUnits();
    if (!units.length) {
      alert('No EDU data found. Load export_descr_unit.txt first in the Unit Editor.');
      return;
    }
    const existingNames = new Set(entries.map(e => e.portraitFilename));
    const added = units
      .filter(u => !existingNames.has(u))
      .map(unitName => ({ ...newEntry(), portraitFilename: unitName, modelFile: unitName }));
    setEntries(prev => [...prev, ...added]);
    alert(`Imported ${added.length} units from EDU. Fill in textures and factions for each entry.`);
  }, [entries]);

  const exportInputFile = useCallback(() => {
    if (!entries.length) return;
    downloadText(serializeInputFile(entries), 'inputfile.txt');
  }, [entries]);

  const copyPreview = useCallback(() => {
    navigator.clipboard.writeText(serializeInputFile(entries.slice(0, 5)) + (entries.length > 5 ? '\n…' : ''));
  }, [entries]);

  const filtered = useMemo(() =>
    entries.filter(e => !search ||
      e.portraitFilename.toLowerCase().includes(search.toLowerCase()) ||
      e.faction.toLowerCase().includes(search.toLowerCase()) ||
      e.modelFile.toLowerCase().includes(search.toLowerCase())),
    [entries, search]);

  const isEditing = editEntry && entries.some(e => e.id === editEntry.id);
  const incomplete = entries.filter(e => !e.modelFile || !e.mainTextureAlb || !e.mainTexturePbr).length;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Unit Card Generator</h1>
          <p className="text-[9px] text-muted-foreground truncate">
            Generates <code className="bg-slate-800 px-1 rounded">inputfile.txt</code> for the Feral Interactive M2TW Blender Portrait Creator
          </p>
        </div>
        {incomplete > 0 && (
          <span className="text-[9px] text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
            ⚠ {incomplete} incomplete
          </span>
        )}
        <a href="https://github.com/FeralInteractive/medieval2-unitcards" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1 shrink-0">
          <ExternalLink className="w-3 h-3" /> GitHub
        </a>
        <button onClick={() => setShowInfo(v => !v)}
          className={`p-1.5 rounded border transition-colors ${showInfo ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'border-slate-600/40 text-slate-500 hover:text-slate-300'}`}>
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Info banner ── */}
      {showInfo && (
        <div className="bg-blue-950/20 border-b border-blue-500/20 px-4 py-2.5 text-[10px] text-slate-300 shrink-0">
          <p className="font-semibold text-blue-300 mb-1">Workflow:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
            <li>Build your entry list here (import from EDU or add manually). Each row = one portrait render.</li>
            <li>Export <code className="bg-slate-800 px-1 rounded text-slate-200">inputfile.txt</code> and place it in the <code className="bg-slate-800 px-1 rounded text-slate-200">Mobile_Portrait_Creator_/</code> Blender folder.</li>
            <li>Open <code className="bg-slate-800 px-1 rounded text-slate-200">portrait_creator_scene.blend</code> in Blender 2.93+ and run <code className="bg-slate-800 px-1 rounded text-slate-200">portrait_creator.py</code>.</li>
            <li>Blender renders all portraits into <code className="bg-slate-800 px-1 rounded text-slate-200">output_directory/</code>, one sub-folder per faction.</li>
          </ol>
          <p className="text-slate-600 mt-1 italic text-[9px]">
            Models must be <strong>.dae</strong> format in source_assets/models/human/ — textures must be <strong>.dds</strong> in source_assets/textures/human/
          </p>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="border-b border-border px-3 py-1.5 flex items-center gap-2 shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="h-6 pl-6 pr-2 w-40 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
        </div>
        <button onClick={importFromEdu}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
          <RefreshCw className="w-3 h-3" /> Import from EDU
        </button>
        <button onClick={() => setEditEntry(newEntry())}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-400 hover:bg-amber-600/20 transition-colors">
          <Plus className="w-3 h-3" /> Add Entry
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600">{entries.length} entries ({filtered.length} shown)</span>
        <button onClick={exportInputFile} disabled={entries.length === 0}
          className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded font-semibold border transition-colors ${
            entries.length > 0
              ? 'bg-green-600/20 hover:bg-green-600/40 border-green-500/40 text-green-400'
              : 'border-slate-700/30 text-slate-600 cursor-not-allowed opacity-40'}`}>
          <Download className="w-3 h-3" /> Export inputfile.txt
        </button>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Table */}
        <div className={`flex-1 overflow-auto ${editEntry ? 'border-r border-border' : ''}`}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3 p-8 text-center">
              <Image className="w-8 h-8 opacity-30" />
              <p className="text-[12px] font-semibold">No entries yet</p>
              <p className="text-[10px] max-w-xs">Click <strong className="text-slate-400">Import from EDU</strong> to batch-create entries from all units (Unit Editor must be loaded), or <strong className="text-slate-400">Add Entry</strong> to create one manually.</p>
            </div>
          ) : (
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold w-8">#</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Portrait Filename</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Game</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Faction</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Pose</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Model File</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Main Texture Alb</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Output Dir</th>
                  <th className="px-2 py-1.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, idx) => {
                  const isSelected = editEntry?.id === entry.id;
                  const ok = entry.modelFile && entry.mainTextureAlb && entry.mainTexturePbr;
                  return (
                    <tr key={entry.id}
                      onClick={() => setEditEntry({ ...entry })}
                      className={`border-b border-border/50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-amber-900/15' : 'hover:bg-slate-800/30'}`}>
                      <td className="px-2 py-1 text-slate-600 font-mono">{idx + 1}</td>
                      <td className="px-2 py-1 font-mono">
                        <span className="text-slate-500">#</span>
                        <span className={isSelected ? 'text-amber-300' : ok ? 'text-slate-200' : 'text-slate-400'}>
                          {entry.portraitFilename || <span className="italic text-slate-600">unnamed</span>}
                        </span>
                        {!ok && <span className="ml-1 text-[8px] text-red-400">⚠</span>}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{entry.game}</td>
                      <td className="px-2 py-1 text-blue-300 font-mono">{entry.faction}</td>
                      <td className="px-2 py-1 text-slate-400 font-mono">
                        {entry.poseId}
                        {isCavalryPose(entry.poseId) && <span className="ml-1 text-[8px] text-amber-500">🐴</span>}
                      </td>
                      <td className="px-2 py-1 font-mono max-w-[140px] truncate">
                        {entry.modelFile ? <span className="text-slate-300">{entry.modelFile}</span> : <span className="text-red-400/50 italic">—</span>}
                      </td>
                      <td className="px-2 py-1 font-mono max-w-[160px] truncate">
                        {entry.mainTextureAlb ? <span className="text-slate-400">{entry.mainTextureAlb}</span> : <span className="text-red-400/50 italic">—</span>}
                      </td>
                      <td className="px-2 py-1 text-slate-500 font-mono">{entry.outputDir || entry.faction}</td>
                      <td className="px-2 py-1">
                        <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id); }}
                          className="p-0.5 text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Edit / Add panel */}
        {editEntry && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden border-l border-border bg-card">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <p className="text-[11px] font-semibold text-foreground">
                {isEditing ? `Edit — #${editEntry.portraitFilename || '…'}` : 'New Entry'}
              </p>
              <button onClick={() => setEditEntry(null)} className="text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <EntryForm
                entry={editEntry}
                factions={factions}
                onSave={saveEntry}
                onCancel={() => setEditEntry(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Pose reference footer ── */}
      <div className="border-t border-border px-3 py-1 shrink-0 bg-card">
        <button onClick={() => setShowPoses(v => !v)}
          className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
          <ChevronDown className={`w-3 h-3 transition-transform ${showPoses ? 'rotate-180' : ''}`} />
          Pose ID Quick Reference
        </button>
        {showPoses && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 pb-0.5">
            {['infantry', 'cavalry', 'special'].map(cat => (
              <div key={cat} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-[8px] text-slate-600 uppercase w-full mt-0.5">{cat}</span>
                {POSE_PRESETS.filter(p => p.category === cat).map(p => (
                  <span key={p.id} className="text-[9px] font-mono whitespace-nowrap">
                    <span className="text-amber-400">{p.id}</span>
                    <span className="text-slate-600"> = {p.label.split('—')[1]?.trim()}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}