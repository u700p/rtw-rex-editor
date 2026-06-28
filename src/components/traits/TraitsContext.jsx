import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { parseTraitsFile, serializeTraitsFile, parseTextFile, serializeTextFile } from './TraitsParser';
import { getTextLocalizationStore } from '@/lib/textLocalizationStore';

const TraitsContext = createContext(null);

export function TraitsProvider({ children }) {
  const [traitsData, setTraitsData] = useState(null);
  const [textData, setTextData] = useState(null);
  const [traitsFilename, setTraitsFilename] = useState('export_descr_character_traits.txt');
  const [textFilename, setTextFilename] = useState('export_VnVs.txt');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedTrait, setSelectedTrait] = useState(null);
  const [textBinMeta, setTextBinMeta] = useState({ magic1: 2, magic2: 2048 });

  // Snapshots for revert
  const originalTraitsData = useRef(null);
  const originalTextData = useRef(null);

  const normalizeTextFilename = (filename, fallback = 'export_VnVs.txt') => {
    return filename || fallback;
  };

  // Auto-load from localStorage if Home page cached the files
  const loadFromStorage = useCallback(() => {
    try {
      const traitsContent = localStorage.getItem('m2tw_traits_file');
      const traitsName = localStorage.getItem('m2tw_traits_file_name');
      if (traitsContent) {
        const parsed = parseTraitsFile(traitsContent);
        originalTraitsData.current = JSON.stringify(parsed);
        setTraitsData(parsed);
        if (traitsName) setTraitsFilename(traitsName);
      }
      const vnvsContent = localStorage.getItem('m2tw_vnvs_file');
      const vnvsName = localStorage.getItem('m2tw_vnvs_file_name');
      if (vnvsContent) {
        const parsed = parseTextFile(vnvsContent);
        originalTextData.current = JSON.stringify(parsed);
        setTextData(parsed);
        setTextBinMeta(null);
        if (vnvsName) setTextFilename(normalizeTextFilename(vnvsName));
      } else {
        const store = getTextLocalizationStore();
        const vnvsBinEntry = Object.entries(store).find(([k]) => k.toLowerCase().includes('vnv'));
        const vnvsBin = vnvsBinEntry?.[1];
        if (vnvsBin) {
          const map = {};
          for (const e of vnvsBin.entries) map[e.key] = e.value;
          originalTextData.current = JSON.stringify(map);
          setTextData(map);
          setTextBinMeta(null);
          setTextFilename(normalizeTextFilename(vnvsBinEntry[0]));
        }
      }
    } catch {}
  }, []);

  const loadTraitsFile = useCallback((content, filename) => {
    const parsed = parseTraitsFile(content);
    originalTraitsData.current = JSON.stringify(parsed);
    setTraitsData(parsed);
    const fn = filename || 'export_descr_character_traits.txt';
    setTraitsFilename(fn);
    setSelectedTrait(null);
    setIsDirty(false);
    try { localStorage.setItem('m2tw_traits_file', content); localStorage.setItem('m2tw_traits_file_name', fn); } catch {}
  }, []);

  const loadTextFile = useCallback((content, filename, textMeta) => {
    // content may be a pre-parsed map or a raw text localization file
    const parsed = (typeof content === 'object' && content !== null && !(content instanceof ArrayBuffer))
      ? content
      : parseTextFile(content);
    originalTextData.current = JSON.stringify(parsed);
    setTextData(parsed);
    setTextBinMeta(null);
    const fn = normalizeTextFilename(filename, 'export_VnVs.txt');
    setTextFilename(fn);
    try { localStorage.setItem('m2tw_vnvs_file', serializeTextFile(parsed)); localStorage.setItem('m2tw_vnvs_file_name', fn); } catch {}
  }, []);

  useEffect(() => {
    loadFromStorage();
    const handleTraits = (e) => {
      if (e.detail?.content) {
        loadTraitsFile(e.detail.content, e.detail.filename);
      } else {
        loadFromStorage();
      }
    };
    const handleVnvs = (e) => {
      if (e.detail?.content) {
        loadTextFile(e.detail.content, e.detail.filename, e.detail.textMeta);
      } else {
        loadFromStorage();
      }
    };
    const handleTextLocalization = () => loadFromStorage();
    window.addEventListener('load-traits', handleTraits);
    window.addEventListener('load-vnvs', handleVnvs);
    window.addEventListener('text-localization-updated', handleTextLocalization);
    return () => {
      window.removeEventListener('load-traits', handleTraits);
      window.removeEventListener('load-vnvs', handleVnvs);
      window.removeEventListener('text-localization-updated', handleTextLocalization);
    };
  }, [loadFromStorage, loadTraitsFile, loadTextFile]);

  // Persist to localStorage whenever traitsData or textData changes (crash protection)
  useEffect(() => {
    if (!traitsData) return;
    try {
      localStorage.setItem('m2tw_traits_file', serializeTraitsFile(traitsData));
    } catch {}
  }, [traitsData]);

  useEffect(() => {
    if (!textData) return;
    try {
      localStorage.setItem('m2tw_vnvs_file', serializeTextFile(textData));
    } catch {}
  }, [textData]);

  const updateTrait = useCallback((index, updated) => {
    setTraitsData(prev => {
      const traits = [...prev.traits];
      traits[index] = updated;
      return { ...prev, traits };
    });
    setIsDirty(true);
  }, []);

  const updateTrigger = useCallback((index, updated) => {
    setTraitsData(prev => {
      const triggers = [...prev.triggers];
      triggers[index] = updated;
      return { ...prev, triggers };
    });
    setIsDirty(true);
  }, []);

  const addTrigger = useCallback((traitName) => {
    const newTrigger = {
      name: `Trigger_${traitName}_New`,
      whenToTest: 'PostBattle',
      conditions: ['Condition IsGeneral true'],
      affects: [{ trait: traitName, value: 1, chance: 10 }],
      rawLines: [],
    };
    setTraitsData(prev => ({ ...prev, triggers: [...(prev.triggers || []), newTrigger] }));
    setIsDirty(true);
  }, []);

  const deleteTrigger = useCallback((index) => {
    setTraitsData(prev => {
      const triggers = prev.triggers.filter((_, i) => i !== index);
      return { ...prev, triggers };
    });
    setIsDirty(true);
  }, []);

  const addTrait = useCallback(() => {
    const baseName = 'NewTrait';
    const newTrait = {
      name: baseName,
      characters: ['family'],
      hidden: false,
      excludeCultures: [],
      noGoingBackLevel: null,
      antiTraits: [],
      levels: [{
        name: `${baseName}_Level1`,
        description: `${baseName}_Level1_desc`,
        effectsDescription: `${baseName}_Level1_effects_desc`,
        gainMessage: '', loseMessage: '',
        epithet: `${baseName}_Level1_epithet_desc`,
        threshold: 1, effects: [],
      }],
    };
    setTraitsData(prev => {
      if (!prev) return { traits: [newTrait], triggers: [] };
      return { ...prev, traits: [...(prev.traits || []), newTrait] };
    });
    // Pre-populate empty text entries so they show up in the export
    setTextData(prev => ({
      ...(prev || {}),
      [`${baseName}_Level1_desc`]: '',
      [`${baseName}_Level1_effects_desc`]: '',
      [`${baseName}_Level1_epithet_desc`]: '',
    }));
    setIsDirty(true);
  }, []);

  const duplicateTrait = useCallback((index) => {
    let newIndex = null;
    setTraitsData(prev => {
      if (!prev?.traits?.[index]) return prev;
      const source = prev.traits[index];
      const names = new Set(prev.traits.map(t => t.name.toLowerCase()));
      let newName = `${source.name}_copy`;
      let n = 2;
      while (names.has(newName.toLowerCase())) newName = `${source.name}_copy_${n++}`;
      const remapKey = (key) => key ? (key.includes(source.name) ? key.replaceAll(source.name, newName) : `${newName}_${key}`) : key;
      const copy = JSON.parse(JSON.stringify(source));
      copy.name = newName;
      copy.antiTraits = [];
      copy.levels = (copy.levels || []).map(level => ({
        ...level,
        name: remapKey(level.name),
        description: remapKey(level.description),
        effectsDescription: remapKey(level.effectsDescription),
        gainMessage: remapKey(level.gainMessage),
        loseMessage: remapKey(level.loseMessage),
        epithet: remapKey(level.epithet),
      }));
      const duplicatedTriggers = (prev.triggers || [])
        .filter(t => (t.affects || []).some(a => a.trait === source.name))
        .map(t => ({
          ...JSON.parse(JSON.stringify(t)),
          name: remapKey(t.name),
          affects: (t.affects || []).map(a => a.trait === source.name ? { ...a, trait: newName } : a),
        }));
      newIndex = (prev.traits || []).length;
      setTextData(textPrev => {
        const next = { ...(textPrev || {}) };
        for (const level of source.levels || []) {
          for (const key of [level.description, level.effectsDescription, level.gainMessage, level.loseMessage, level.epithet].filter(Boolean)) {
            next[remapKey(key)] = next[key] || '';
          }
        }
        return next;
      });
      return { ...prev, traits: [...(prev.traits || []), copy], triggers: [...(prev.triggers || []), ...duplicatedTriggers] };
    });
    setIsDirty(true);
    if (newIndex !== null) setSelectedTrait(newIndex);
    return newIndex;
  }, []);

  const deleteTrait = useCallback((index) => {
    setTraitsData(prev => {
      const traits = prev.traits.filter((_, i) => i !== index);
      return { ...prev, traits };
    });
    setSelectedTrait(null);
    setIsDirty(true);
  }, []);

  const revertTraits = useCallback(() => {
    if (originalTraitsData.current) {
      setTraitsData(JSON.parse(originalTraitsData.current));
    }
    if (originalTextData.current) {
      setTextData(JSON.parse(originalTextData.current));
    }
    setSelectedTrait(null);
    setIsDirty(false);
  }, []);

  const saveTraits = useCallback(() => {
    // Commit current state as new baseline
    if (traitsData) originalTraitsData.current = JSON.stringify(traitsData);
    if (textData) originalTextData.current = JSON.stringify(textData);
    setIsDirty(false);
  }, [traitsData, textData]);

  const updateTextEntry = useCallback((key, value) => {
    setTextData(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const renameTextKey = useCallback((oldKey, newKey) => {
    if (!oldKey || !newKey || oldKey === newKey) return;
    setTextData(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      next[newKey] = next[oldKey] ?? '';
      delete next[oldKey];
      return next;
    });
    setIsDirty(true);
  }, []);

  const exportTraitsFile = useCallback(() => {
    if (!traitsData) return null;
    return serializeTraitsFile(traitsData);
  }, [traitsData]);

  const exportTextFile = useCallback(() => {
    if (!textData) return null;
    return serializeTextFile(textData);
  }, [textData]);

  const getText = useCallback((key) => {
    if (!textData || !key) return '';
    return textData[key] || '';
  }, [textData]);

  return (
    <TraitsContext.Provider value={{
      traitsData, textData,
      traitsFilename, textFilename, textBinMeta,
      isDirty, selectedTrait,
      setSelectedTrait,
      loadTraitsFile, loadTextFile,
      updateTrait, addTrait, duplicateTrait, deleteTrait,
      updateTrigger, addTrigger, deleteTrigger,
      revertTraits, saveTraits,
      updateTextEntry, renameTextKey,
      exportTraitsFile, exportTextFile,
      getText,
    }}>
      {children}
    </TraitsContext.Provider>
  );
}

export function useTraits() {
  return useContext(TraitsContext);
}
