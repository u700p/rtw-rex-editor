import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { parseEDB, serializeEDB, createDefaultBuilding, createDefaultLevel, parseTextFile, serializeTextFile, parseBuildingImageKey } from './EDBParser';
import { useEDBAutoSave } from './useEDBAutoSave';
import { loadLargeText, saveLargeText } from '@/lib/largeTextStore';

const EDBContext = createContext(null);

const EDB_LS_KEY = 'm2tw_edb_file';
const EDB_LS_NAME_KEY = 'm2tw_edb_file_name';
const EDB_TXT_LS_KEY = 'm2tw_edb_txt_file';
const EDB_IMG_LS_KEY = 'm2tw_edb_images';

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, '_');
}

function makeUniqueName(base, existing) {
  const root = cleanName(base) || 'copy';
  if (!existing.has(root)) return root;
  let index = 2;
  while (existing.has(`${root}_${index}`)) index++;
  return `${root}_${index}`;
}

function mapRequirements(reqs, oldBuilding, newBuilding, levelNameMap = new Map()) {
  return (reqs || []).map(req => {
    if (!req || req.type !== 'building_present_min_level') return req;
    return {
      ...req,
      building: req.building === oldBuilding ? newBuilding : req.building,
      level: levelNameMap.get(req.level) || req.level,
    };
  });
}

function mapCapabilities(caps, oldBuilding, newBuilding, levelNameMap) {
  return (caps || []).map(cap => cap?.requirements
    ? { ...cap, requirements: mapRequirements(cap.requirements, oldBuilding, newBuilding, levelNameMap) }
    : cap
  );
}

function mapUpgradeRefs(upgrades, oldBuilding, newBuilding, levelNameMap) {
  return (upgrades || []).map(up => {
    if (typeof up === 'string') return levelNameMap.get(up) || up;
    return {
      ...up,
      name: levelNameMap.get(up.name) || up.name,
      requirements: mapRequirements(up.requirements, oldBuilding, newBuilding, levelNameMap),
    };
  });
}

function remapLevelRefs(level, oldBuilding, newBuilding, levelNameMap) {
  return {
    ...level,
    requirements: mapRequirements(level.requirements, oldBuilding, newBuilding, levelNameMap),
    capabilities: mapCapabilities(level.capabilities, oldBuilding, newBuilding, levelNameMap),
    factionCapability: mapCapabilities(level.factionCapability, oldBuilding, newBuilding, levelNameMap),
    upgrades: mapUpgradeRefs(level.upgrades, oldBuilding, newBuilding, levelNameMap),
  };
}

function renameLevelKeys(store, oldLevel, newLevel) {
  const next = {};
  for (const [key, value] of Object.entries(store || {})) {
    if (key === oldLevel) next[newLevel] = value;
    else if (key.startsWith(`${oldLevel}_`)) next[`${newLevel}${key.slice(oldLevel.length)}`] = value;
    else next[key] = value;
  }
  return next;
}

function copyLevelKeys(store, oldLevel, newLevel) {
  const next = { ...(store || {}) };
  for (const [key, value] of Object.entries(store || {})) {
    if (key === oldLevel) next[newLevel] = value;
    else if (key.startsWith(`${oldLevel}_`)) next[`${newLevel}${key.slice(oldLevel.length)}`] = value;
  }
  return next;
}

function renameImageKeys(store, oldLevel, newLevel) {
  const next = {};
  for (const [key, value] of Object.entries(store || {})) {
    if (key.startsWith(`${oldLevel}_`)) next[`${newLevel}${key.slice(oldLevel.length)}`] = { ...value, levelName: newLevel };
    else next[key] = value;
  }
  return next;
}

function copyImageKeys(store, oldLevel, newLevel) {
  const next = { ...(store || {}) };
  for (const [key, value] of Object.entries(store || {})) {
    if (key.startsWith(`${oldLevel}_`)) next[`${newLevel}${key.slice(oldLevel.length)}`] = { ...value, levelName: newLevel };
  }
  return next;
}

export function EDBProvider({ children }) {
  const [edbData, setEdbData] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [textData, setTextData] = useState({}); // { levelName: { title, desc, shortDesc, factionEntries: {} } }
  const [imageData, setImageData] = useState({}); // { levelName_culture: { icon, constructed, construction } }
  const [isDirty, setIsDirty] = useState(false);
  const [fileName, setFileName] = useState('');

  // Auto-restore from localStorage on mount
  useEffect(() => {
    // Clear stale image data that may have filled the quota in older sessions
    try { localStorage.removeItem(EDB_IMG_LS_KEY); } catch {}
    try {
      const raw = localStorage.getItem(EDB_LS_KEY);
      const name = localStorage.getItem(EDB_LS_NAME_KEY);
      if (raw) {
        const parsed = parseEDB(raw);
        setEdbData(parsed);
        setFileName(name || 'export_descr_buildings.txt');
      }
      const txtRaw = localStorage.getItem(EDB_TXT_LS_KEY);
      if (txtRaw) {
        const parsed = parseTextFile(txtRaw);
        setTextData(prev => ({ ...prev, ...parsed }));
      }
      // Note: image data URLs are NOT restored from localStorage (too large, quota killer)
    } catch {}
    let cancelled = false;
    loadLargeText(EDB_TXT_LS_KEY).then((record) => {
      if (cancelled || !record?.text) return;
      const parsed = parseTextFile(record.text);
      setTextData(prev => ({ ...prev, ...parsed }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadEDB = useCallback((text, name) => {
    const parsed = parseEDB(text);
    setEdbData(parsed);
    setFileName(name || 'export_descr_buildings.txt');
    setSelectedBuilding(null);
    setSelectedLevel(null);
    setIsDirty(false);
    try {
      localStorage.setItem(EDB_LS_KEY, text);
      localStorage.setItem(EDB_LS_NAME_KEY, name || 'export_descr_buildings.txt');
    } catch {}
  }, []);

  const exportEDB = useCallback(() => {
    if (!edbData) return '';
    return serializeEDB(edbData);
  }, [edbData]);

  const loadTextFile = useCallback((text) => {
    const parsed = parseTextFile(text);
    setTextData(prev => ({ ...prev, ...parsed }));
    try { localStorage.setItem(EDB_TXT_LS_KEY, text); } catch {}
    saveLargeText(EDB_TXT_LS_KEY, text).catch(() => {});
  }, []);

  const exportTextFile = useCallback(() => {
    return serializeTextFile(textData);
  }, [textData]);

  const updateBuilding = useCallback((buildingName, updater) => {
    setEdbData(prev => {
      if (!prev) return prev;
      const newBuildings = prev.buildings.map(b => {
        if (b.name === buildingName) {
          return typeof updater === 'function' ? updater(b) : { ...b, ...updater };
        }
        return b;
      });
      return { ...prev, buildings: newBuildings };
    });
    setIsDirty(true);
  }, []);

  const updateLevel = useCallback((buildingName, levelName, updater) => {
    setEdbData(prev => {
      if (!prev) return prev;
      const newBuildings = prev.buildings.map(b => {
        if (b.name === buildingName) {
          const newLevels = b.levels.map(l => {
            if (l.name === levelName) {
              const updated = typeof updater === 'function' ? updater(l) : { ...l, ...updater };
              // If name changed, update selectedLevel too (done after state update)
              return updated;
            }
            return l;
          });
          return { ...b, levels: newLevels };
        }
        return b;
      });
      return { ...prev, buildings: newBuildings };
    });
    setIsDirty(true);
  }, []);

  const addBuilding = useCallback((name) => {
    const newBuilding = createDefaultBuilding(name);
    setEdbData(prev => {
      if (!prev) return prev;
      return { ...prev, buildings: [...prev.buildings, newBuilding] };
    });
    // Auto-create text entries for the new building's levels
    setTextData(prev => {
      const next = { ...prev };
      for (const level of newBuilding.levels) {
        if (!next[level.name]) next[level.name] = level.name;
        if (!next[level.name + '_desc']) next[level.name + '_desc'] = '';
        if (!next[level.name + '_desc_short']) next[level.name + '_desc_short'] = '';
      }
      return next;
    });
    setIsDirty(true);
  }, []);

  const renameBuilding = useCallback((oldName, requestedName) => {
    if (!edbData || !oldName) return oldName;
    const existing = new Set(edbData.buildings.map(b => b.name).filter(name => name !== oldName));
    const newName = makeUniqueName(requestedName, existing);
    if (!newName || newName === oldName) return oldName;

    setEdbData(prev => {
      if (!prev) return prev;
      const newBuildings = prev.buildings.map(building => {
        const renamedBuilding = {
          ...building,
          name: building.name === oldName ? newName : building.name,
          convertTo: building.convertTo === oldName ? newName : building.convertTo,
          levels: (building.levels || []).map(level => remapLevelRefs(level, oldName, newName, new Map())),
        };
        return renamedBuilding;
      });
      return { ...prev, buildings: newBuildings };
    });

    setTextData(prev => {
      const next = { ...(prev || {}) };
      if (Object.prototype.hasOwnProperty.call(next, `${oldName}_name`)) {
        next[`${newName}_name`] = next[`${oldName}_name`];
        delete next[`${oldName}_name`];
      }
      return next;
    });

    if (selectedBuilding === oldName) setSelectedBuilding(newName);
    setIsDirty(true);
    return newName;
  }, [edbData, selectedBuilding]);

  const duplicateBuilding = useCallback((buildingName) => {
    if (!edbData || !buildingName) return null;
    const source = edbData.buildings.find(b => b.name === buildingName);
    if (!source) return null;

    const existingBuildings = new Set(edbData.buildings.map(b => b.name));
    const existingLevels = new Set(edbData.buildings.flatMap(b => (b.levels || []).map(l => l.name)));
    const newBuildingName = makeUniqueName(`${buildingName}_copy`, existingBuildings);
    const levelNameMap = new Map();

    for (const level of source.levels || []) {
      const newLevelName = makeUniqueName(`${level.name}_copy`, existingLevels);
      existingLevels.add(newLevelName);
      levelNameMap.set(level.name, newLevelName);
    }

    const copiedBuilding = {
      ...cloneDeep(source),
      name: newBuildingName,
      convertTo: source.convertTo === buildingName ? newBuildingName : source.convertTo,
      levels: (source.levels || []).map(level => ({
        ...remapLevelRefs(cloneDeep(level), buildingName, newBuildingName, levelNameMap),
        name: levelNameMap.get(level.name) || level.name,
      })),
    };

    setEdbData(prev => {
      if (!prev) return prev;
      const sourceIndex = prev.buildings.findIndex(b => b.name === buildingName);
      const buildings = [...prev.buildings];
      buildings.splice(sourceIndex + 1, 0, copiedBuilding);
      return { ...prev, buildings };
    });

    setTextData(prev => {
      let next = { ...(prev || {}) };
      if (Object.prototype.hasOwnProperty.call(next, `${buildingName}_name`)) {
        next[`${newBuildingName}_name`] = next[`${buildingName}_name`];
      }
      for (const [oldLevel, newLevel] of levelNameMap.entries()) {
        next = copyLevelKeys(next, oldLevel, newLevel);
      }
      return next;
    });

    setImageData(prev => {
      let next = { ...(prev || {}) };
      for (const [oldLevel, newLevel] of levelNameMap.entries()) {
        next = copyImageKeys(next, oldLevel, newLevel);
      }
      return next;
    });

    setSelectedBuilding(newBuildingName);
    setSelectedLevel(null);
    setIsDirty(true);
    return newBuildingName;
  }, [edbData]);

  const deleteBuilding = useCallback((buildingName) => {
    setEdbData(prev => {
      if (!prev) return prev;
      return { ...prev, buildings: prev.buildings.filter(b => b.name !== buildingName) };
    });
    if (selectedBuilding === buildingName) {
      setSelectedBuilding(null);
      setSelectedLevel(null);
    }
    setIsDirty(true);
  }, [selectedBuilding]);

  const addLevel = useCallback((buildingName) => {
    let newLevelName = '';
    setEdbData(prev => {
      if (!prev) return prev;
      const newBuildings = prev.buildings.map(b => {
        if (b.name === buildingName) {
          const newLevel = createDefaultLevel(buildingName, b.levels.length);
          newLevelName = newLevel.name;
          const updatedLevels = b.levels.map((l, idx) => {
            if (idx === b.levels.length - 1 && l.upgrades.length === 0) {
              return { ...l, upgrades: [newLevel.name] };
            }
            return l;
          });
          return { ...b, levels: [...updatedLevels, newLevel] };
        }
        return b;
      });
      return { ...prev, buildings: newBuildings };
    });
    // Auto-create text entry for new level
    setTimeout(() => {
      if (newLevelName) {
        setTextData(prev => {
          const next = { ...prev };
          if (!next[newLevelName]) next[newLevelName] = newLevelName;
          if (!next[newLevelName + '_desc']) next[newLevelName + '_desc'] = '';
          if (!next[newLevelName + '_desc_short']) next[newLevelName + '_desc_short'] = '';
          return next;
        });
      }
    }, 0);
    setIsDirty(true);
  }, []);

  const reorderBuildings = useCallback((fromIndex, toIndex) => {
    setEdbData(prev => {
      if (!prev) return prev;
      const buildings = [...prev.buildings];
      const [moved] = buildings.splice(fromIndex, 1);
      buildings.splice(toIndex, 0, moved);
      return { ...prev, buildings };
    });
    setIsDirty(true);
  }, []);

  const renameLevel = useCallback((buildingName, oldLevelName, requestedName) => {
    if (!edbData || !buildingName || !oldLevelName) return oldLevelName;
    const existingLevels = new Set(edbData.buildings
      .flatMap(b => (b.levels || []).map(l => l.name))
      .filter(name => name !== oldLevelName));
    const newLevelName = makeUniqueName(requestedName, existingLevels);
    if (!newLevelName || newLevelName === oldLevelName) return oldLevelName;
    const levelNameMap = new Map([[oldLevelName, newLevelName]]);

    setEdbData(prev => {
      if (!prev) return prev;
      const buildings = prev.buildings.map(building => ({
        ...building,
        levels: (building.levels || []).map(level => {
          const remapped = remapLevelRefs(level, buildingName, buildingName, levelNameMap);
          return level.name === oldLevelName ? { ...remapped, name: newLevelName } : remapped;
        }),
      }));
      return { ...prev, buildings };
    });

    setTextData(prev => renameLevelKeys(prev, oldLevelName, newLevelName));
    setImageData(prev => renameImageKeys(prev, oldLevelName, newLevelName));
    if (selectedLevel === oldLevelName) setSelectedLevel(newLevelName);
    setIsDirty(true);
    return newLevelName;
  }, [edbData, selectedLevel]);

  const duplicateLevel = useCallback((buildingName, levelName) => {
    if (!edbData || !buildingName || !levelName) return null;
    const building = edbData.buildings.find(b => b.name === buildingName);
    const sourceIndex = building?.levels?.findIndex(l => l.name === levelName) ?? -1;
    if (!building || sourceIndex < 0) return null;

    const existingLevels = new Set(edbData.buildings.flatMap(b => (b.levels || []).map(l => l.name)));
    const newLevelName = makeUniqueName(`${levelName}_copy`, existingLevels);
    const levelNameMap = new Map([[levelName, newLevelName]]);
    const copiedLevel = {
      ...remapLevelRefs(cloneDeep(building.levels[sourceIndex]), buildingName, buildingName, levelNameMap),
      name: newLevelName,
    };

    setEdbData(prev => {
      if (!prev) return prev;
      const buildings = prev.buildings.map(b => {
        if (b.name !== buildingName) return b;
        const levels = [...(b.levels || [])];
        levels.splice(sourceIndex + 1, 0, copiedLevel);
        return { ...b, levels };
      });
      return { ...prev, buildings };
    });

    setTextData(prev => copyLevelKeys(prev, levelName, newLevelName));
    setImageData(prev => copyImageKeys(prev, levelName, newLevelName));
    setSelectedBuilding(buildingName);
    setSelectedLevel(newLevelName);
    setIsDirty(true);
    return newLevelName;
  }, [edbData]);

  const deleteLevel = useCallback((buildingName, levelName) => {
    setEdbData(prev => {
      if (!prev) return prev;
      const newBuildings = prev.buildings.map(b => {
        if (b.name === buildingName) {
          const newLevels = b.levels.filter(l => l.name !== levelName);
          // Clean up upgrade references
          const cleaned = newLevels.map(l => ({
            ...l,
            upgrades: l.upgrades.filter(u => (typeof u === 'string' ? u : u?.name) !== levelName)
          }));
          return { ...b, levels: cleaned };
        }
        return b;
      });
      return { ...prev, buildings: newBuildings };
    });
    if (selectedLevel === levelName) setSelectedLevel(null);
    setIsDirty(true);
  }, [selectedLevel]);

  const loadTgaImages = useCallback((images) => {
    setImageData(prev => ({ ...prev, ...images }));
  }, []);

  const loadBuildingTgaImages = useCallback((filesArray, replace = false) => {
    // filesArray: array of { path, name, url } from folder picker
    const structured = {};
    for (const f of filesArray) {
      const parsed = parseBuildingImageKey(f.path, f.name);
      if (parsed) {
        structured[parsed.key] = { url: f.url, culture: parsed.culture, type: parsed.type, levelName: parsed.levelName };
      }
    }
    setImageData(prev => replace ? structured : { ...prev, ...structured });
  }, []);

  const restoreSnapshot = useCallback((snap) => {
    setEdbData(snap.edbData);
    setTextData(snap.textData || {});
    setFileName(snap.fileName || 'export_descr_buildings.txt');
    setSelectedBuilding(null);
    setSelectedLevel(null);
    setIsDirty(false);
  }, []);

  const { saveNow: saveSnapshot } = useEDBAutoSave(edbData, textData, fileName);

  const saveNow = useCallback(async () => {
    // Persist to localStorage so data survives page reload
    if (edbData) {
      try {
        const { serializeEDB, serializeTextFile } = await import('./EDBParser');
        localStorage.setItem('m2tw_edb_file', serializeEDB(edbData));
        localStorage.setItem('m2tw_edb_file_name', fileName);
        if (textData && Object.keys(textData).length > 0) {
          const txtSerialized = serializeTextFile(textData);
          try { localStorage.setItem('m2tw_edb_txt_file', txtSerialized); } catch {}
          await saveLargeText(EDB_TXT_LS_KEY, txtSerialized);
        }
      } catch {}
    }
    setIsDirty(false);
    return saveSnapshot();
  }, [edbData, textData, fileName, saveSnapshot]);

  const value = {
    edbData, setEdbData, loadEDB, exportEDB,
    loadTextFile, exportTextFile,
    selectedBuilding, setSelectedBuilding,
    selectedLevel, setSelectedLevel,
    updateBuilding, updateLevel,
    addBuilding, renameBuilding, duplicateBuilding, deleteBuilding, reorderBuildings,
    addLevel, renameLevel, duplicateLevel, deleteLevel,
    textData, setTextData,
    imageData, setImageData, loadTgaImages, loadBuildingTgaImages,
    isDirty, fileName,
    restoreSnapshot, saveNow
  };

  return <EDBContext.Provider value={value}>{children}</EDBContext.Provider>;
}

export function useEDB() {
  const ctx = useContext(EDBContext);
  if (!ctx) throw new Error('useEDB must be within EDBProvider');
  return ctx;
}
