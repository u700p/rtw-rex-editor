import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { parseDescrModelBattle, serializeDescrModelBattle, createDefaultBattleModelEntry } from '@/lib/descrModelBattleCodec';
import { parseModeldb, serializeModeldb } from '@/lib/modeldbCodec';
import { loadLargeText, saveLargeText } from '@/lib/largeTextStore';

const DescrModelBattleContext = createContext(null);

const LS_DMB  = 'm2tw_descr_model_battle_file';
const LS_BMDB = 'm2tw_battlemodel_db_file';
const LS_DMB_NAME  = 'm2tw_descr_model_battle_name';
const LS_BMDB_NAME = 'm2tw_battlemodel_db_name';

export function DescrModelBattleProvider({ children }) {
  // ── descr_model_battle.txt state ────────────────────────────────────────
  const [dmbData,     setDmbData]     = useState(null);  // { entries, byType }
  const [dmbFilename, setDmbFilename] = useState('descr_model_battle.txt');
  const [dmbDirty,    setDmbDirty]    = useState(false);
  const [selectedType, setSelectedType] = useState(null);

  // ── battlemodel.db / battle_models.modeldb state ────────────────────────
  const [bmdbData,     setBmdbData]     = useState(null);
  const [bmdbFilename, setBmdbFilename] = useState('battlemodel.db');
  const [bmdbDirty,    setBmdbDirty]    = useState(false);
  const [selectedBmdbEntry, setSelectedBmdbEntry] = useState(null);

  // Snapshot refs for revert
  const origDmb  = useRef(null);
  const origBmdb = useRef(null);

  // ── Auto-restore from localStorage ──────────────────────────────────────
  useEffect(() => {
    let loadedDmbFromLocal = false;
    try {
      const sharedName = localStorage.getItem('m2tw_modeldb_file_name') || '';
      const sharedRaw = sharedName.toLowerCase() === 'descr_model_battle.txt'
        ? localStorage.getItem('m2tw_modeldb_file')
        : null;
      const raw = localStorage.getItem(LS_DMB) || sharedRaw;
      const name = localStorage.getItem(LS_DMB_NAME) || sharedName;
      if (raw) {
        const parsed = parseDescrModelBattle(raw);
        origDmb.current = JSON.stringify(parsed);
        setDmbData(parsed);
        if (name) setDmbFilename(name);
        loadedDmbFromLocal = true;
      }
    } catch {}
    let cancelled = false;
    loadLargeText(LS_DMB).then((record) => {
      if (cancelled || loadedDmbFromLocal || !record?.text) return;
      const parsed = parseDescrModelBattle(record.text);
      origDmb.current = JSON.stringify(parsed);
      setDmbData(parsed);
      if (record.metadata?.filename) setDmbFilename(record.metadata.filename);
    }).catch(() => {});
    try {
      const raw = localStorage.getItem(LS_BMDB);
      const name = localStorage.getItem(LS_BMDB_NAME);
      if (raw) {
        const parsed = parseModeldb(raw);
        origBmdb.current = JSON.stringify(parsed);
        setBmdbData(parsed);
        if (name) setBmdbFilename(name);
      }
    } catch {}
    return () => { cancelled = true; };
  }, []);

  // ── descr_model_battle.txt actions ──────────────────────────────────────
  const loadDmbFile = useCallback((content, filename) => {
    const parsed = parseDescrModelBattle(content);
    origDmb.current = JSON.stringify(parsed);
    setDmbData(parsed);
    setDmbDirty(false);
    setSelectedType(null);
    const fn = filename || 'descr_model_battle.txt';
    setDmbFilename(fn);
    try {
      localStorage.setItem(LS_DMB, content);
      localStorage.setItem(LS_DMB_NAME, fn);
    } catch {}
    saveLargeText(LS_DMB, content, { filename: fn }).catch(() => {});
  }, []);

  const updateDmbEntry = useCallback((updatedEntry) => {
    setDmbData(prev => {
      if (!prev) return prev;
      const updatedName = updatedEntry.name || updatedEntry.type;
      const entries = prev.entries.map(e =>
        (e.name || e.type) === updatedName ? { ...updatedEntry, name: updatedName, type: updatedEntry.type || updatedName } : e
      );
      const byName = {};
      const byType = {};
      for (const e of entries) {
        const name = e.name || e.type;
        if (!name) continue;
        byName[name.toLowerCase()] = e;
        byType[(e.type || name).toLowerCase()] = e;
      }
      return { ...prev, entries, byName, byType };
    });
    setDmbDirty(true);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const text = typeof e.detail === 'string' ? e.detail : e.detail?.text;
      const filename = typeof e.detail === 'object' ? e.detail?.filename : '';
      if (!text || filename.toLowerCase() !== 'descr_model_battle.txt') return;
      loadDmbFile(text, filename);
    };
    window.addEventListener('modeldb-file-loaded', handler);
    return () => window.removeEventListener('modeldb-file-loaded', handler);
  }, [loadDmbFile]);

  const addDmbEntry = useCallback((typeName) => {
    const entry = createDefaultBattleModelEntry(typeName);
    setDmbData(prev => {
      if (!prev) {
        const byName = { [entry.name.toLowerCase()]: entry };
        const byType = { [entry.type.toLowerCase()]: entry };
        return { sourceFormat: 'descr_model_battle', totalEntries: 1, entries: [entry], byName, byType };
      }
      const exists = prev.byType[entry.type.toLowerCase()];
      if (exists) return prev;
      const entries = [...prev.entries, entry];
      const byName = { ...(prev.byName || {}), [entry.name.toLowerCase()]: entry };
      const byType = { ...(prev.byType || {}), [entry.type.toLowerCase()]: entry };
      return { ...prev, entries, byName, byType, totalEntries: entries.length };
    });
    setSelectedType(entry.type);
    setDmbDirty(true);
  }, []);

  const removeDmbEntry = useCallback((typeName) => {
    setDmbData(prev => {
      if (!prev) return prev;
      const entries = prev.entries.filter(e => (e.type || e.name) !== typeName);
      const byName = {};
      const byType = {};
      for (const e of entries) {
        const name = e.name || e.type;
        if (!name) continue;
        byName[name.toLowerCase()] = e;
        byType[(e.type || name).toLowerCase()] = e;
      }
      return { ...prev, entries, byName, byType, totalEntries: entries.length };
    });
    setSelectedType(sel => sel === typeName ? null : sel);
    setDmbDirty(true);
  }, []);

  const exportDmbFile = useCallback(() => {
    if (!dmbData) return null;
    return serializeDescrModelBattle(dmbData);
  }, [dmbData]);

  const saveDmb = useCallback(() => {
    if (!dmbData) return;
    const serialized = serializeDescrModelBattle(dmbData);
    origDmb.current = JSON.stringify(dmbData);
    setDmbDirty(false);
    try { localStorage.setItem(LS_DMB, serialized); } catch {}
    saveLargeText(LS_DMB, serialized, { filename: dmbFilename }).catch(() => {});
  }, [dmbData, dmbFilename]);

  const revertDmb = useCallback(() => {
    if (!origDmb.current) return;
    const parsed = JSON.parse(origDmb.current);
    setDmbData(parsed);
    setDmbDirty(false);
  }, []);

  // ── battlemodel.db actions ───────────────────────────────────────────────
  const loadBmdbFile = useCallback((content, filename) => {
    const parsed = parseModeldb(content);
    origBmdb.current = JSON.stringify(parsed);
    setBmdbData(parsed);
    setBmdbDirty(false);
    setSelectedBmdbEntry(null);
    const fn = filename || 'battlemodel.db';
    setBmdbFilename(fn);
    try {
      localStorage.setItem(LS_BMDB, content);
      localStorage.setItem(LS_BMDB_NAME, fn);
    } catch {}
  }, []);

  const updateBmdbEntry = useCallback((updatedEntry) => {
    setBmdbData(prev => {
      if (!prev) return prev;
      const entries = prev.entries.map(e =>
        e.name === updatedEntry.name ? updatedEntry : e
      );
      const byName = {};
      for (const e of entries) byName[e.name.toLowerCase()] = e;
      return { ...prev, entries, byName };
    });
    setBmdbDirty(true);
  }, []);

  const exportBmdbFile = useCallback(() => {
    if (!bmdbData) return null;
    return serializeModeldb(bmdbData);
  }, [bmdbData]);

  const saveBmdb = useCallback(() => {
    if (!bmdbData) return;
    origBmdb.current = JSON.stringify(bmdbData);
    setBmdbDirty(false);
    try { localStorage.setItem(LS_BMDB, serializeModeldb(bmdbData)); } catch {}
  }, [bmdbData]);

  const revertBmdb = useCallback(() => {
    if (!origBmdb.current) return;
    setBmdbData(JSON.parse(origBmdb.current));
    setBmdbDirty(false);
  }, []);

  return (
    <DescrModelBattleContext.Provider value={{
      // descr_model_battle.txt
      dmbData, dmbFilename, dmbDirty,
      selectedType, setSelectedType,
      loadDmbFile, updateDmbEntry, addDmbEntry, removeDmbEntry,
      exportDmbFile, saveDmb, revertDmb,
      // battlemodel.db
      bmdbData, bmdbFilename, bmdbDirty,
      selectedBmdbEntry, setSelectedBmdbEntry,
      loadBmdbFile, updateBmdbEntry,
      exportBmdbFile, saveBmdb, revertBmdb,
    }}>
      {children}
    </DescrModelBattleContext.Provider>
  );
}

export function useDescrModelBattle() {
  const ctx = useContext(DescrModelBattleContext);
  if (!ctx) throw new Error('useDescrModelBattle must be used inside DescrModelBattleProvider');
  return ctx;
}
