import React, { useState, useEffect, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Plus, Trash2, ChevronDown, ChevronRight, Download, Copy } from 'lucide-react';
import { useRefData } from '../edb/RefDataContext';
import SearchableCombobox from '../shared/SearchableCombobox';
import { OWNERSHIP_FACTIONS } from './EDUParser';

const INP = 'w-full h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary';

// Faction name dropdown backed by RefDataContext factions
function FactionSelect({ value, onChange, factions }) {
  const [isCustom, setIsCustom] = useState(() => !!value && !factions.includes(value));

  const handleSelectChange = (e) => {
    const v = e.target.value;
    if (v === '__custom__') { setIsCustom(true); return; }
    setIsCustom(false);
    onChange(v);
  };

  if (isCustom || !factions.length) {
    return (
      <div className="flex items-center gap-1 flex-1">
        <input value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
        {factions.length > 0 && (
          <button onClick={() => setIsCustom(false)} className="text-[10px] text-muted-foreground hover:text-foreground px-1">▼</button>
        )}
      </div>
    );
  }

  return (
    <select value={value} onChange={handleSelectChange}
      className="flex-1 h-6 px-1 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary">
      {!factions.includes(value) && <option value={value}>{value || '(choose)'}</option>}
      {factions.map(f => <option key={f} value={f}>{f}</option>)}
      <option value="__custom__">✎ Enter manually…</option>
    </select>
  );
}

// Popup to pick a target faction for duplication
function DuplicateFactionPopup({ factions, existingFactions, onConfirm, onClose }) {
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const available = factions.filter(f => !existingFactions.includes(f) && f.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl shadow-2xl p-5 w-80 space-y-4">
        <p className="text-sm font-semibold text-foreground">Duplicate faction texture</p>
        <p className="text-xs text-muted-foreground">Choose the target faction. All texture paths will be copied to it.</p>
        <input
          autoFocus
          value={search}
          onChange={e => { setSearch(e.target.value); setSelected(''); }}
          placeholder="Search faction…"
          className="w-full h-7 px-2 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
          {available.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-muted-foreground">No factions found</p>
          ) : available.map(f => (
            <button
              key={f}
              onClick={() => setSelected(f)}
              className={`w-full text-left px-2.5 py-1.5 text-[11px] font-mono transition-colors ${selected === f ? 'bg-primary/15 text-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent text-muted-foreground">Cancel</button>
          <button
            disabled={!selected}
            onClick={() => { if (selected) onConfirm(selected); }}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}

const MOUNT_OPTIONS = ['None', 'Horse', 'elephant', 'camel'];

export default function ModelDbPanel({ soldierModel, unit, modeldb, onUpdateEntry, onDownload }) {
  const { factions: refFactions, skeletonTypes, skeletonAnimations, mountTypes } = useRefData();

  const allRefFactions = useMemo(() => {
    if (!refFactions || refFactions.length <= 5) return OWNERSHIP_FACTIONS;
    const extra = refFactions.filter(f => !OWNERSHIP_FACTIONS.includes(f));
    return [...OWNERSHIP_FACTIONS, ...extra];
  }, [refFactions]);

  const entry = useMemo(() => {
    if (!modeldb || !soldierModel) return null;
    const key = soldierModel.trim().toLowerCase();
    return modeldb.byName?.[key] || modeldb.byType?.[key] || null;
  }, [modeldb, soldierModel]);

  const [factions, setFactions] = useState([]);
  const [attachFactions, setAttachFactions] = useState([]);
  const [meshes, setMeshes] = useState([]);
  const [mountTypes_state, setMountTypes] = useState([]);
  const [scale, setScale] = useState(1);
  const [torchBoneIndex, setTorchBoneIndex] = useState(-1);
  const [torch, setTorch] = useState([0, 0, 0, 0, 0, 0]);
  const [showAttach, setShowAttach] = useState(false);
  const [showMounts, setShowMounts] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dupIndex, setDupIndex] = useState(null);

  useEffect(() => {
    if (entry) {
      setFactions(entry.factions.map(f => ({ ...f })));
      setAttachFactions((entry.attachFactions || []).map(f => ({ ...f })));
      setMeshes(entry.meshes.map(m => ({ ...m })));
      setMountTypes(entry.mountTypes ? entry.mountTypes.map(mt => ({
        ...mt,
        primaryWeapons: [...(mt.primaryWeapons || [])],
        secondaryWeapons: [...(mt.secondaryWeapons || [])],
      })) : []);
      setScale(entry.scale ?? 1);
      setTorchBoneIndex(entry.torchBoneIndex ?? -1);
      setTorch(entry.torch ? [...entry.torch] : [0, 0, 0, 0, 0, 0]);
      setDirty(false);
    }
  }, [soldierModel, entry?.name]);

  // Missing faction texture warning — must be before early returns (Rules of Hooks)
  const missingFactions = useMemo(() => {
    if (!unit || !factions.length) return [];
    const allOwned = new Set([
      ...(unit.ownership || []),
    ]);
    const entryFactionSet = new Set(factions.map(f => f.faction?.toLowerCase()));
    return [...allOwned].filter(f => {
      if (!f || f === 'slave' || f === 'rebels' || f.endsWith('_rebels')) return false;
      return !entryFactionSet.has(f.toLowerCase());
    });
  }, [unit, factions]);

  if (!modeldb) {
    return (
      <div className="p-8 text-center space-y-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-30" />
        <p className="text-sm text-muted-foreground">No battle model file loaded.</p>
        <p className="text-xs text-muted-foreground">Use the <strong>Load Battle Models</strong> button in the toolbar above.</p>
        <p className="text-sm text-muted-foreground">No battle_models.modeldb loaded.</p>
        <p className="text-xs text-muted-foreground">Use the <strong>Load ModelDB</strong> button in the toolbar above.</p>
        {onDownload && (
          <Button size="sm" variant="outline" onClick={onDownload} className="h-7 text-[11px] gap-1.5 mt-2">
            <Download className="w-3 h-3" /> Download ModelDB
          </Button>
        )}
      </div>
    );
  }

  if (!soldierModel) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Set a soldier model name in the Identity tab first.
      </div>
    );
  }

  if (!entry) {
    const allKeys = Object.keys(modeldb.byName || {});
    const sample = allKeys.slice(0, 8).join(', ');
    return (
      <div className="p-8 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto opacity-60" />
        <p className="text-sm text-foreground">
          No entry found for <code className="bg-accent px-1 rounded font-mono text-xs">{soldierModel}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          {allKeys.length} entries loaded. Lookup key: <code className="font-mono">{soldierModel.trim().toLowerCase()}</code>
        </p>
        {sample && (
          <p className="text-xs text-muted-foreground break-all">
            First entries: <span className="font-mono">{sample}{allKeys.length > 8 ? '…' : ''}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Check the <em>soldier</em> line in the Identity tab matches an entry in descr_model_battle.txt or battle_models.modeldb.
        </p>
        <Button size="sm" variant="outline" onClick={onDownload} className="h-7 text-[11px] gap-1.5">
          <Download className="w-3 h-3" /> Download ModelDB
        </Button>
      </div>
    );
  }

  const mark = () => setDirty(true);

  // ── Mesh LOD helpers ──────────────────────────────────────────────────────
  const setMeshField = (i, key, val) => { setMeshes(prev => { const n = [...prev]; n[i] = { ...n[i], [key]: val }; return n; }); mark(); };
  const addLod = () => { setMeshes(prev => [...prev, { path: '', dist: 10000 }]); mark(); };
  const removeLod = (i) => { setMeshes(prev => prev.filter((_, idx) => idx !== i)); mark(); };

  // ── Main faction helpers ──────────────────────────────────────────────────
  const setFactionField = (i, key, val) => { setFactions(prev => { const n = [...prev]; n[i] = { ...n[i], [key]: val }; return n; }); mark(); };
  const addFaction = () => {
    setFactions(prev => [...prev, { faction: '', texture: '', normalTex: '', sprite: '' }]);
    setAttachFactions(prev => [...prev, { faction: '', diffTex: '', normTex: '' }]);
    mark();
  };
  const removeFaction = (i) => {
    setFactions(prev => prev.filter((_, idx) => idx !== i));
    setAttachFactions(prev => prev.filter((_, idx) => idx !== i));
    mark();
  };
  const duplicateFaction = (i, targetFaction) => {
    setFactions(prev => [...prev, { ...prev[i], faction: targetFaction }]);
    setAttachFactions(prev => [...prev, { ...(prev[i] || {}), faction: targetFaction }]);
    setDupIndex(null);
    mark();
  };

  // ── Attach faction helpers ────────────────────────────────────────────────
  const setAttachField = (i, key, val) => { setAttachFactions(prev => { const n = [...prev]; n[i] = { ...n[i], [key]: val }; return n; }); mark(); };
  const syncedAttach = factions.map((_, i) => attachFactions[i] || { faction: factions[i]?.faction || '', diffTex: '', normTex: '' });

  // ── Mount/skeleton helpers ────────────────────────────────────────────────
  const setMountField = (i, key, val) => { setMountTypes(prev => { const n = [...prev]; n[i] = { ...n[i], [key]: val }; return n; }); mark(); };
  const addMount = () => { setMountTypes(prev => [...prev, { mountType: 'None', primarySkeleton: '', secondarySkeleton: '', primaryWeapons: [], secondaryWeapons: [] }]); mark(); };
  const removeMount = (i) => { setMountTypes(prev => prev.filter((_, idx) => idx !== i)); mark(); };
  const addWeapon = (mi, type) => {
    setMountTypes(prev => {
      const n = [...prev]; const mt = { ...n[mi] };
      mt[type] = [...(mt[type] || []), ''];
      n[mi] = mt; return n;
    }); mark();
  };
  const setWeapon = (mi, type, wi, val) => {
    setMountTypes(prev => {
      const n = [...prev]; const mt = { ...n[mi] };
      const weps = [...(mt[type] || [])]; weps[wi] = val;
      mt[type] = weps; n[mi] = mt; return n;
    }); mark();
  };
  const removeWeapon = (mi, type, wi) => {
    setMountTypes(prev => {
      const n = [...prev]; const mt = { ...n[mi] };
      mt[type] = (mt[type] || []).filter((_, idx) => idx !== wi);
      n[mi] = mt; return n;
    }); mark();
  };

  const save = () => {
    onUpdateEntry(entry.name, { ...entry, scale, meshes, factions, attachFactions: syncedAttach, mountTypes: mountTypes_state, torchBoneIndex, torch });
    setDirty(false);
  };

  const availableMountOptions = mountTypes.length > 0
    ? [...new Set([...MOUNT_OPTIONS, ...mountTypes])]
    : MOUNT_OPTIONS;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {dupIndex !== null && (
        <DuplicateFactionPopup
          factions={allRefFactions}
          existingFactions={factions.map(f => f.faction)}
          onConfirm={(target) => duplicateFaction(dupIndex, target)}
          onClose={() => setDupIndex(null)}
        />
      )}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-sm font-semibold text-foreground font-mono">{entry.name}</span>
              <span className="text-xs text-muted-foreground">{factions.length} factions · {meshes.length} LODs</span>
            </div>
            <div className="flex gap-2">
              {dirty && (
                <Button size="sm" onClick={save}
                  className="h-7 text-[11px] bg-green-700 hover:bg-green-600 text-white gap-1.5">
                  Save changes
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onDownload} className="h-7 text-[11px] gap-1.5">
                <Download className="w-3 h-3" /> Download ModelDB
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDownload} className="h-7 text-[11px] gap-1.5">
              <Download className="w-3 h-3" /> Download Battle Models
            </Button>
            </div>
          </div>

          {/* Missing faction texture warning */}
          {missingFactions.length > 0 && (
            <div className="flex items-start gap-2.5 p-3 bg-amber-950/30 border border-amber-700/50 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold text-amber-300">Missing faction textures</p>
                <p className="text-[10px] text-amber-400/80 mt-0.5">These factions own this unit but have no texture entry here:</p>
                <p className="text-[10px] font-mono text-amber-300 mt-1 break-all">{missingFactions.join(', ')}</p>
              </div>
            </div>
          )}

          {/* Scale */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground w-14 shrink-0">Scale</span>
            <input type="number" step="0.01" value={scale}
              onChange={e => { setScale(parseFloat(e.target.value) || 1); mark(); }}
              className="w-24 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-[10px] text-muted-foreground">1.0 = infantry, 1.12 = horses</span>
          </div>

          {/* Mesh LODs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Mesh LODs</p>
              <button onClick={addLod}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                <Plus className="w-3 h-3" /> Add LOD
              </button>
            </div>
            <div className="space-y-1.5">
              {meshes.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-10 shrink-0 text-right">LOD {i}</span>
                  <input value={m.path} onChange={e => setMeshField(i, 'path', e.target.value)}
                    className={`${INP} flex-1`} placeholder="unit_models/..." />
                  <input value={m.dist} onChange={e => setMeshField(i, 'dist', Number(e.target.value))}
                    type="number" className="w-16 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded"
                    title="Max distance" />
                  {meshes.length > 1 && (
                    <button onClick={() => removeLod(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Faction Textures */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Faction Textures</p>
              <button onClick={addFaction}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                <Plus className="w-3 h-3" /> Add faction
              </button>
            </div>
            <div className="space-y-3">
              {factions.map((f, i) => {
                const att = syncedAttach[i] || {};
                return (
                  <div key={i} className="border border-border rounded-lg p-2.5 space-y-2 bg-card/40">
                    {/* Faction name row */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">faction</span>
                      <FactionSelect value={f.faction} factions={refFactions}
                        onChange={v => {
                          setFactionField(i, 'faction', v);
                          setAttachField(i, 'faction', v);
                        }} />
                      <button
                        onClick={() => setDupIndex(i)}
                        title="Duplicate to another faction"
                        className="text-muted-foreground hover:text-blue-400 transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeFaction(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Two-column: main texture | attachment texture */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground font-semibold">Main</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">texture</span>
                          <input value={f.texture} onChange={e => setFactionField(i, 'texture', e.target.value)} className={`${INP} flex-1`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">normal</span>
                          <input value={f.normalTex} onChange={e => setFactionField(i, 'normalTex', e.target.value)} className={`${INP} flex-1`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">sprite</span>
                          <input value={f.sprite} onChange={e => setFactionField(i, 'sprite', e.target.value)} className={`${INP} flex-1`} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground font-semibold">Attachment</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">texture</span>
                          <input value={att.diffTex || ''} onChange={e => setAttachField(i, 'diffTex', e.target.value)} className={`${INP} flex-1`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">normal</span>
                          <input value={att.normTex || ''} onChange={e => setAttachField(i, 'normTex', e.target.value)} className={`${INP} flex-1`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-10 shrink-0">pad</span>
                          <span className="text-[10px] text-muted-foreground font-mono">0</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mount Types / Skeletons */}
          <div>
            <button onClick={() => setShowMounts(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full mb-1">
              {showMounts ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-semibold uppercase tracking-wide text-[10px]">Mount Types &amp; Skeletons</span>
              <span className="ml-1 opacity-60">({mountTypes_state.length})</span>
              <button onClick={(e) => { e.stopPropagation(); addMount(); setShowMounts(true); mark(); }}
                className="ml-auto flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300">
                <Plus className="w-3 h-3" /> Add
              </button>
            </button>
            {showMounts && (
              <div className="space-y-3 mt-2">
                {mountTypes_state.map((mt, mi) => (
                  <div key={mi} className="border border-border rounded-lg p-2.5 space-y-1.5 bg-card/40">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">mount</span>
                      <select value={mt.mountType} onChange={e => setMountField(mi, 'mountType', e.target.value)}
                        className="flex-1 h-6 px-1 text-[11px] font-mono bg-background border border-border rounded focus:outline-none">
                        {availableMountOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <button onClick={() => removeMount(mi)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">pri skel</span>
                      <div className="flex-1">
                        <SearchableCombobox value={mt.primarySkeleton} options={skeletonTypes} placeholder="skeleton type…" onChange={v => setMountField(mi, 'primarySkeleton', v)} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">sec skel</span>
                      <div className="flex-1">
                        <SearchableCombobox value={mt.secondarySkeleton || ''} options={skeletonTypes} placeholder="skeleton type…" onChange={v => setMountField(mi, 'secondarySkeleton', v)} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[10px] text-muted-foreground">Primary weapons</span>
                        <button onClick={() => addWeapon(mi, 'primaryWeapons')} className="ml-1 text-[10px] text-blue-400 hover:text-blue-300"><Plus className="w-2.5 h-2.5" /></button>
                      </div>
                      {(mt.primaryWeapons || []).map((w, wi) => (
                        <div key={wi} className="flex items-center gap-1 mb-0.5">
                          <SearchableCombobox value={w} options={skeletonAnimations} placeholder="animation name…" onChange={v => setWeapon(mi, 'primaryWeapons', wi, v)} className="flex-1" />
                          <button onClick={() => removeWeapon(mi, 'primaryWeapons', wi)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[10px] text-muted-foreground">Secondary weapons</span>
                        <button onClick={() => addWeapon(mi, 'secondaryWeapons')} className="ml-1 text-[10px] text-blue-400 hover:text-blue-300"><Plus className="w-2.5 h-2.5" /></button>
                      </div>
                      {(mt.secondaryWeapons || []).map((w, wi) => (
                        <div key={wi} className="flex items-center gap-1 mb-0.5">
                          <SearchableCombobox value={w} options={skeletonAnimations} placeholder="animation name…" onChange={v => setWeapon(mi, 'secondaryWeapons', wi, v)} className="flex-1" />
                          <button onClick={() => removeWeapon(mi, 'secondaryWeapons', wi)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Torch */}
          <div>
            <button onClick={() => setShowAttach(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showAttach ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-semibold uppercase tracking-wide text-[10px]">Torch &amp; Transform</span>
            </button>
            {showAttach && (
              <div className="mt-2 space-y-1.5 pl-3 border-l border-border">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-20 shrink-0">Bone index</span>
                  <input type="number" value={torchBoneIndex}
                    onChange={e => { setTorchBoneIndex(parseInt(e.target.value)); mark(); }}
                    className="w-16 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded" />
                  <span className="text-[10px] text-muted-foreground">(-1 = no torch)</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {['tx','ty','tz','rx','ry','rz'].map((lbl, i) => (
                    <div key={lbl} className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">{lbl}</span>
                      <input type="number" step="0.001" value={torch[i]}
                        onChange={e => { const t = [...torch]; t[i] = parseFloat(e.target.value) || 0; setTorch(t); mark(); }}
                        className="w-20 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}
