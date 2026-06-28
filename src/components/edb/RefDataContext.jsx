import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  parseFactionsFile, parseResourcesFile, parseEventsFile, parseUnitsFile,
  FACTIONS as DEFAULT_FACTIONS, CULTURES as DEFAULT_CULTURES, HIDDEN_RESOURCES_DEFAULT
} from './EDBParser';
import { parseGuildsFile, serializeGuildsFile } from './GuildsParser';

const RefDataContext = createContext(null);

const LS_KEYS = {
  factions: 'm2tw_factions_file',
  resources: 'm2tw_resources_file',
  events: 'm2tw_events_file',
  units: 'm2tw_units_file',
  skeleton: 'm2tw_skeleton_file',
  mount: 'm2tw_mount_file',
  guilds: 'm2tw_guilds_file',
};

// Parse campaign_script.txt for declare_counter entries
export function parseCampaignScriptCounters(text) {
  const counters = new Set();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^declare_counter\s+(\S+)/i);
    if (m) counters.add(m[1]);
  }
  return [...counters];
}

// Parse descr_skeleton.txt → { types: string[], animations: string[] }
function parseSkeletonFile(text) {
  const types = [];
  const animations = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const typeM = line.match(/^type\s+(\S+)/i);
    if (typeM) { types.push(typeM[1]); continue; }
    // Animation entries: "anim <name> ..." or "animation <name> ..."
    const animM = line.match(/^anim(?:ation)?\s+(\S+)/i);
    if (animM) animations.push(animM[1]);
  }
  return { types: [...new Set(types)], animations: [...new Set(animations)] };
}

// Parse descr_mount.txt → array of mount type name strings
function parseMountFile(text) {
  const types = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^type\s+(\S+)/i);
    if (m) types.push(m[1]);
  }
  return [...new Set(types)];
}

function parseKeywordList(text, keyword) {
  const values = [];
  const re = new RegExp(`^${keyword}\\s+(\\S+)`, 'i');
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(re);
    if (m) values.push(m[1]);
  }
  return [...new Set(values)].sort();
}

function parseUnitTypeList(text) {
  const values = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^type\s+(.+)/i);
    if (m) values.push(m[1].trim());
  }
  return [...new Set(values)].sort();
}

function setLocal(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function setSession(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}

function saveFactionsText(text, filename) {
  setLocal(LS_KEYS.factions, text);
  setLocal('m2tw_sm_factions_raw', text);
  setLocal('m2tw_factions_raw', text);
  setSession('m2tw_factions_raw', text);
  if (filename) setLocal('m2tw_factions_file_name', filename);
}

function saveUnitsText(text, filename) {
  setLocal(LS_KEYS.units, text);
  setSession('m2tw_edu_raw', text);
  if (filename) setLocal('m2tw_edu_file_name', filename);
  const units = parseUnitTypeList(text);
  if (units.length) setLocal('m2tw_edu_units_list', JSON.stringify(units));
}

export function RefDataProvider({ children }) {
  const [factions, setFactions] = useState(DEFAULT_FACTIONS);
  const [cultures, setCultures] = useState(DEFAULT_CULTURES);
  const [mapResources, setMapResources] = useState([]);
  const [eventCounters, setEventCounters] = useState([]);
  const [units, setUnits] = useState([]); // [{type, dictionary}]
  const [skeletonTypes, setSkeletonTypes] = useState([]); // string[]
  const [skeletonAnimations, setSkeletonAnimations] = useState([]); // string[]
  const [mountTypes, setMountTypes] = useState([]); // string[]
  const [guildData, setGuildData] = useState(null); // { guilds: [], triggers: [] } | null

  const restoreCachedRefData = useCallback(() => {
    try {
      const facRaw = localStorage.getItem(LS_KEYS.factions);
      if (facRaw) {
        const result = parseFactionsFile(facRaw);
        if (result.factions) setFactions(result.factions);
        if (result.cultures) setCultures(result.cultures);
      }
      const cultureRaw = localStorage.getItem('m2tw_cultures_file') || sessionStorage.getItem('m2tw_cultures_raw');
      if (cultureRaw) {
        const parsed = parseKeywordList(cultureRaw, 'culture');
        if (parsed.length) setCultures(parsed);
      }
      const resRaw = localStorage.getItem(LS_KEYS.resources);
      if (resRaw) {
        const res = parseResourcesFile(resRaw);
        if (res.length) setMapResources(res);
      }
      const evRaw = localStorage.getItem(LS_KEYS.events);
      const scriptRaw = localStorage.getItem('m2tw_campaign_script');
      const allCounters = new Set();
      if (evRaw) { for (const e of parseEventsFile(evRaw)) allCounters.add(e); }
      if (scriptRaw) { for (const e of parseCampaignScriptCounters(scriptRaw)) allCounters.add(e); }
      if (allCounters.size) setEventCounters([...allCounters]);
      const unitRaw = localStorage.getItem(LS_KEYS.units);
      if (unitRaw) {
        const u = parseUnitsFile(unitRaw);
        if (u.length) setUnits(u);
      }
      const religionRaw = localStorage.getItem('m2tw_religions_file') || sessionStorage.getItem('m2tw_religions_raw');
      if (religionRaw) {
        const parsed = parseKeywordList(religionRaw, 'religion');
        if (parsed.length) {
          try { sessionStorage.setItem('m2tw_religions_list', JSON.stringify(parsed)); } catch {}
        }
      }
      const skelRaw = localStorage.getItem(LS_KEYS.skeleton);
      if (skelRaw) {
        const { types, animations } = parseSkeletonFile(skelRaw);
        if (types.length) setSkeletonTypes(types);
        if (animations.length) setSkeletonAnimations(animations);
      }
      const mountRaw = localStorage.getItem(LS_KEYS.mount);
      if (mountRaw) {
        const mt = parseMountFile(mountRaw);
        if (mt.length) setMountTypes(mt);
      }
      const guildsRaw = localStorage.getItem(LS_KEYS.guilds);
      if (guildsRaw) {
        const g = parseGuildsFile(guildsRaw);
        if (g.guilds?.length || g.triggers?.length) setGuildData(g);
      }
    } catch {}
  }, []);

  // Auto-restore from localStorage on mount
  useEffect(() => {
    restoreCachedRefData();
  }, [restoreCachedRefData]);

  useEffect(() => {
    const events = ['factions-file-loaded', 'resources-file-loaded', 'events-file-loaded', 'edu-file-loaded', 'cultures-file-loaded', 'religions-file-loaded', 'storage'];
    events.forEach(event => window.addEventListener(event, restoreCachedRefData));
    return () => {
      events.forEach(event => window.removeEventListener(event, restoreCachedRefData));
    };
  }, [restoreCachedRefData]);

  const loadFactionsFile = useCallback((text, filename = '') => {
    const result = parseFactionsFile(text);
    if (result.factions) setFactions(result.factions);
    if (result.cultures) setCultures(result.cultures);
    saveFactionsText(text, filename);
    window.dispatchEvent(new CustomEvent('factions-file-loaded'));
  }, []);

  const loadResourcesFile = useCallback((text) => {
    const res = parseResourcesFile(text);
    if (res.length) setMapResources(res);
    try {
      localStorage.setItem(LS_KEYS.resources, text);
      window.dispatchEvent(new CustomEvent('resources-file-loaded'));
    } catch {}
  }, []);

  const loadEventsFile = useCallback((text) => {
    const evs = parseEventsFile(text);
    const scriptRaw = (() => { try { return localStorage.getItem('m2tw_campaign_script'); } catch { return null; } })();
    const scriptCounters = scriptRaw ? parseCampaignScriptCounters(scriptRaw) : [];
    const merged = [...new Set([...evs, ...scriptCounters])];
    if (merged.length) setEventCounters(merged);
    try {
      localStorage.setItem(LS_KEYS.events, text);
      window.dispatchEvent(new CustomEvent('events-file-loaded'));
    } catch {}
  }, []);

  const loadCampaignScript = useCallback((text) => {
    const scriptCounters = parseCampaignScriptCounters(text);
    setEventCounters(prev => [...new Set([...prev, ...scriptCounters])]);
    try { localStorage.setItem('m2tw_campaign_script', text); } catch {}
  }, []);

  const loadUnitsFile = useCallback((text, filename = '') => {
    const u = parseUnitsFile(text);
    if (u.length) setUnits(u);
    saveUnitsText(text, filename);
    window.dispatchEvent(new CustomEvent('edu-file-loaded'));
  }, []);

  const loadSkeletonFile = useCallback((text) => {
    const { types, animations } = parseSkeletonFile(text);
    if (types.length) setSkeletonTypes(types);
    if (animations.length) setSkeletonAnimations(animations);
    try { localStorage.setItem(LS_KEYS.skeleton, text); } catch {}
  }, []);

  const loadMountFile = useCallback((text) => {
    const mt = parseMountFile(text);
    if (mt.length) setMountTypes(mt);
    try { localStorage.setItem(LS_KEYS.mount, text); } catch {}
  }, []);

  const loadGuildsFile = useCallback((text) => {
    const g = parseGuildsFile(text);
    setGuildData(g);
    try { localStorage.setItem(LS_KEYS.guilds, text); } catch {}
  }, []);

  const updateGuild = useCallback((guildName, patch) => {
    setGuildData(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        guilds: prev.guilds.map(g => g.name === guildName ? { ...g, ...patch } : g),
      };
      try { localStorage.setItem(LS_KEYS.guilds, serializeGuildsFile(updated)); } catch {}
      return updated;
    });
  }, []);

  const updateTrigger = useCallback((triggerName, patch) => {
    setGuildData(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        triggers: prev.triggers.map(t => t.name === triggerName ? { ...t, ...patch } : t),
      };
      try { localStorage.setItem(LS_KEYS.guilds, serializeGuildsFile(updated)); } catch {}
      return updated;
    });
  }, []);

  const addTrigger = useCallback((trigger) => {
    setGuildData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, triggers: [...prev.triggers, trigger] };
      try { localStorage.setItem(LS_KEYS.guilds, serializeGuildsFile(updated)); } catch {}
      return updated;
    });
  }, []);

  const deleteTrigger = useCallback((triggerName) => {
    setGuildData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, triggers: prev.triggers.filter(t => t.name !== triggerName) };
      try { localStorage.setItem(LS_KEYS.guilds, serializeGuildsFile(updated)); } catch {}
      return updated;
    });
  }, []);

  const exportGuildsFile = useCallback(() => {
    if (!guildData) return '';
    return serializeGuildsFile(guildData);
  }, [guildData]);

  return (
    <RefDataContext.Provider value={{
      factions, cultures, mapResources, eventCounters, units,
      skeletonTypes, skeletonAnimations, mountTypes,
      guildData, updateGuild, updateTrigger, addTrigger, deleteTrigger, exportGuildsFile,
      loadFactionsFile, loadResourcesFile, loadEventsFile, loadUnitsFile,
      loadSkeletonFile, loadMountFile, loadCampaignScript, loadGuildsFile,
    }}>
      {children}
    </RefDataContext.Provider>
  );
}

export function useRefData() {
  const ctx = useContext(RefDataContext);
  if (!ctx) throw new Error('useRefData must be within RefDataProvider');
  return ctx;
}
