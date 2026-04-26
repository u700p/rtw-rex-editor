import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { parseDescrModelBattle, serializeDescrModelBattle, createDefaultBattleModelEntry } from '@/lib/descrModelBattleCodec';
import { parseModeldb, serializeModeldb } from '@/lib/modeldbCodec';

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
    try {
      const raw = localStorage.getItem(LS_DMB);
      const name = localStorage.getItem(LS_DMB_NAME);
      if (raw) {
        const parsed = parseDescrModelBattle(raw);
        origDmb.current = JSON.stringify(parsed);
        setDmbData(parsed);
        if (name) setDmbFilename(name);
      }
    } catch {}
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
  }, []);

  const updateDmbEntry = useCallback((updatedEntry) => {
    setDmbData(prev => {
      if (!prev) return prev;
      const entries = prev.entries.map(e =>
        e.type === updatedEntry.type ? updatedEntry : e
      );
      const byType = {};
      for (const e of entries) byType[e.type.toLowerCase()] = e;
      return { entries, byType };
    });
    setDmbDirty(true);
  }, []);

  const addDmbEntry = useCallback((typeName) => {
    const entry = createDefaultBattleModelEntry(typeName);
    setDmbData(prev => {
      if (!prev) {
        const byType = { [entry.type.toLowerCase()]: entry };
        return { entries: [entry], byType };
      }
      const exists = prev.byType[entry.type.toLowerCase()];
      if (exists) return prev;
      const entries = [...prev.entries, entry];
      const byType = { ...prev.byType, [entry.type.toLowerCase()]: entry };
      return { entries, byType };
    });
    setSelectedType(entry.type);
    setDmbDirty(true);
  }, []);

  const removeDmbEntry = useCallback((typeName) => {
    setDmbData(prev => {
      if (!prev) return prev;
      const entries = prev.entries.filter(e => e.type !== typeName);
      const byType = {};
      for (const e of entries) byType[e.type.toLowerCase()] = e;
      return { entries, byType };
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
  }, [dmbData]);

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
