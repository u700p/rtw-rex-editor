import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { parseDescrSmFactions, serializeDescrSmFactions, createDefaultSmFaction } from '@/lib/descrSmFactionsCodec';

const SmFactionsContext = createContext(null);

const LS_KEY      = 'm2tw_factions_file';
const LS_KEY_NAME = 'm2tw_factions_file_name';

export function SmFactionsProvider({ children }) {
  const [factions,  setFactions]  = useState([]);
  const [filename,  setFilename]  = useState('descr_sm_factions.txt');
  const [isDirty,   setIsDirty]   = useState(false);
  const [selected,  setSelected]  = useState(null);  // faction name string
  const [loaded,    setLoaded]    = useState(false);

  const originalRef = useRef(null);

  // ── Auto-restore from localStorage ────────────────────────────────────────
  const loadFromStorage = useCallback((resetSelection = false) => {
    try {
      const raw  = localStorage.getItem(LS_KEY);
      const name = localStorage.getItem(LS_KEY_NAME);
      if (!raw) return false;
      const parsed = parseDescrSmFactions(raw);
      originalRef.current = JSON.stringify(parsed);
      setFactions(parsed);
      setLoaded(true);
      if (resetSelection) setSelected(null);
      if (name) setFilename(name);
      return true;
    } catch {}
    return false;
  }, []);

  useEffect(() => {
    loadFromStorage(true);
  }, [loadFromStorage]);

  useEffect(() => {
    const handler = (event) => {
      if (event?.detail?.source === 'sm-factions-editor') return;
      loadFromStorage(false);
    };
    window.addEventListener('factions-file-loaded', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('factions-file-loaded', handler);
      window.removeEventListener('storage', handler);
    };
  }, [loadFromStorage]);

  const persistFactions = useCallback((nextFactions, source = 'sm-factions-editor') => {
    try {
      localStorage.setItem(LS_KEY, serializeDescrSmFactions(nextFactions));
      window.dispatchEvent(new CustomEvent('factions-file-loaded', { detail: { source } }));
    } catch {}
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadFile = useCallback((content, name) => {
    const parsed = parseDescrSmFactions(content);
    originalRef.current = JSON.stringify(parsed);
    setFactions(parsed);
    setLoaded(true);
    setIsDirty(false);
    setSelected(null);
    const fn = name || 'descr_sm_factions.txt';
    setFilename(fn);
    try {
      localStorage.setItem(LS_KEY, content);
      localStorage.setItem(LS_KEY_NAME, fn);
      window.dispatchEvent(new CustomEvent('factions-file-loaded', { detail: { source: 'sm-factions-editor' } }));
      // Also update RefData faction names (simple list) that EDB uses
      // by re-storing the same raw text under the same key RefDataContext reads
    } catch {}
  }, []);

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const updateFaction = useCallback((updated) => {
    setFactions(prev => {
      const next = prev.map(f => f.name === updated.name ? updated : f);
      persistFactions(next);
      return next;
    });
    setIsDirty(true);
  }, [persistFactions]);

  const addFaction = useCallback((name) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const faction = createDefaultSmFaction(trimmed);
    setFactions(prev => {
      if (prev.some(f => f.name === trimmed)) return prev;
      const next = [...prev, faction];
      persistFactions(next);
      return next;
    });
    setSelected(trimmed);
    setIsDirty(true);
    setLoaded(true);
  }, [persistFactions]);

  const removeFaction = useCallback((name) => {
    setFactions(prev => {
      const next = prev.filter(f => f.name !== name);
      persistFactions(next);
      return next;
    });
    setSelected(sel => sel === name ? null : sel);
    setIsDirty(true);
  }, [persistFactions]);

  // ── Persistence ──────────────────────────────────────────────────────────
  const save = useCallback(() => {
    const serialized = serializeDescrSmFactions(factions);
    originalRef.current = JSON.stringify(factions);
    setIsDirty(false);
    try {
      localStorage.setItem(LS_KEY, serialized);
      window.dispatchEvent(new CustomEvent('factions-file-loaded', { detail: { source: 'sm-factions-editor' } }));
    } catch {}
  }, [factions]);

  const revert = useCallback(() => {
    if (!originalRef.current) return;
    setFactions(JSON.parse(originalRef.current));
    setIsDirty(false);
  }, []);

  const exportFile = useCallback(() => serializeDescrSmFactions(factions), [factions]);

  return (
    <SmFactionsContext.Provider value={{
      factions, filename, isDirty, selected, setSelected, loaded,
      loadFile, updateFaction, addFaction, removeFaction,
      save, revert, exportFile,
    }}>
      {children}
    </SmFactionsContext.Provider>
  );
}

export function useSmFactions() {
  const ctx = useContext(SmFactionsContext);
  if (!ctx) throw new Error('useSmFactions must be used inside SmFactionsProvider');
  return ctx;
}
