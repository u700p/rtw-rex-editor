import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { parseAncillariesFile, serializeAncillariesFile, parseTextFile, serializeTextFile } from './AncillariesParser';
import { getTextLocalizationStore } from '@/lib/textLocalizationStore';

const AncillariesContext = createContext(null);

export function AncillariesProvider({ children }) {
  const [ancData, setAncData] = useState(null);
  const [textData, setTextData] = useState(null);
  const [ancFilename, setAncFilename] = useState('export_descr_ancillaries.txt');
  const [textFilename, setTextFilename] = useState('export_ancillaries.txt');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedAnc, setSelectedAnc] = useState(null);
  const [textBinMeta, setTextBinMeta] = useState(null);
  // tgaImages: { [filename_no_ext]: dataUrl }
  const [tgaImages, setTgaImages] = useState({});

  // Snapshots for revert
  const originalAncData = useRef(null);
  const originalTextData = useRef(null);

  const normalizeTextFilename = (filename, fallback = 'export_ancillaries.txt') => {
    return filename || fallback;
  };

  // Listen for TGA images broadcast from Home page
  useEffect(() => {
    const handler = (e) => {
      if (e.detail && typeof e.detail === 'object') {
        setTgaImages(prev => ({ ...prev, ...e.detail }));
      }
    };
    window.addEventListener('load-anc-tga-batch', handler);
    return () => window.removeEventListener('load-anc-tga-batch', handler);
  }, []);

  // Auto-load from localStorage if Home page cached the files
  const loadFromStorage = useCallback(() => {
    try {
      const ancContent = localStorage.getItem('m2tw_anc_file');
      const ancName = localStorage.getItem('m2tw_anc_file_name');
      if (ancContent) {
        const parsed = parseAncillariesFile(ancContent);
        originalAncData.current = JSON.stringify(parsed);
        setAncData(parsed);
        if (ancName) setAncFilename(ancName);
      }
      const txtContent = localStorage.getItem('m2tw_anctxt_file');
      const txtName = localStorage.getItem('m2tw_anctxt_file_name');
      if (txtContent) {
        const parsed = parseTextFile(txtContent);
        originalTextData.current = JSON.stringify(parsed);
        setTextData(parsed);
        if (txtName) setTextFilename(normalizeTextFilename(txtName));
        setTextBinMeta(null);
      } else {
        const store = getTextLocalizationStore();
        const anctxtEntry = Object.entries(store).find(([k]) =>
          k.toLowerCase() === 'export_ancillaries.txt' ||
          k.toLowerCase().includes('export_ancillaries')
        );
        if (anctxtEntry) {
          const [filename, binData] = anctxtEntry;
          const map = {};
          for (const e of binData.entries) map[e.key] = e.value;
          originalTextData.current = JSON.stringify(map);
          setTextData(map);
          setTextFilename(normalizeTextFilename(filename));
          setTextBinMeta(null);
        }
      }
    } catch {}
  }, []);

  const loadAncFile = useCallback((content, filename) => {
    const parsed = parseAncillariesFile(content);
    originalAncData.current = JSON.stringify(parsed);
    setAncData(parsed);
    const fn = filename || 'export_descr_ancillaries.txt';
    setAncFilename(fn);
    setSelectedAnc(null);
    setIsDirty(false);
    try { localStorage.setItem('m2tw_anc_file', content); localStorage.setItem('m2tw_anc_file_name', fn); } catch {}
  }, []);

  const loadTextFile = useCallback((content, filename, textMeta) => {
    // content may be a pre-parsed map or a raw text localization file
    const parsed = (typeof content === 'object' && content !== null && !(content instanceof ArrayBuffer))
      ? content
      : parseTextFile(content);
    originalTextData.current = JSON.stringify(parsed);
    setTextData(parsed);
    const fn = normalizeTextFilename(filename, 'export_ancillaries.txt');
    setTextFilename(fn);
    setTextBinMeta(null);
    try { localStorage.setItem('m2tw_anctxt_file', serializeTextFile(parsed)); localStorage.setItem('m2tw_anctxt_file_name', fn); } catch {}
  }, []);

  useEffect(() => {
    loadFromStorage();
    const handleAnc = (e) => {
      if (e.detail?.content) {
        loadAncFile(e.detail.content, e.detail.filename);
      } else {
        loadFromStorage();
      }
    };
    const handleAncTxt = (e) => {
      if (e.detail?.content) {
        loadTextFile(e.detail.content, e.detail.filename, e.detail.textMeta);
      } else {
        loadFromStorage();
      }
    };
    const handleTextLocalization = () => loadFromStorage();
    window.addEventListener('load-ancillaries', handleAnc);
    window.addEventListener('load-anctxt', handleAncTxt);
    window.addEventListener('text-localization-updated', handleTextLocalization);
    return () => {
      window.removeEventListener('load-ancillaries', handleAnc);
      window.removeEventListener('load-anctxt', handleAncTxt);
      window.removeEventListener('text-localization-updated', handleTextLocalization);
    };
  }, [loadFromStorage, loadAncFile, loadTextFile]);

  const loadTgaImages = useCallback((images) => {
    // images: { [key]: dataUrl }
    setTgaImages(prev => ({ ...prev, ...images }));
  }, []);

  // Persist to localStorage on every change (crash protection)
  useEffect(() => {
    if (!ancData) return;
    try {
      localStorage.setItem('m2tw_anc_file', serializeAncillariesFile(ancData));
    } catch {}
  }, [ancData]);

  useEffect(() => {
    if (!textData) return;
    try {
      localStorage.setItem('m2tw_anctxt_file', serializeTextFile(textData));
    } catch {}
  }, [textData]);

  const updateAncillary = useCallback((index, updated) => {
    setAncData(prev => {
      const ancillaries = [...prev.ancillaries];
      ancillaries[index] = updated;
      return { ...prev, ancillaries };
    });
    setIsDirty(true);
  }, []);

  const updateTrigger = useCallback((index, updated) => {
    setAncData(prev => {
      const triggers = [...(prev.triggers || [])];
      triggers[index] = updated;
      return { ...prev, triggers };
    });
    setIsDirty(true);
  }, []);

  const addTrigger = useCallback((ancName) => {
    const newTrigger = {
      name: `Trigger_${ancName}_New`,
      whenToTest: 'PostBattle',
      conditions: ['Condition IsGeneral true'],
      acquireAncillary: { name: ancName, chance: 10 },
      rawLines: [],
    };
    setAncData(prev => ({ ...prev, triggers: [...(prev.triggers || []), newTrigger] }));
    setIsDirty(true);
  }, []);

  const deleteTrigger = useCallback((index) => {
    setAncData(prev => {
      const triggers = prev.triggers.filter((_, i) => i !== index);
      return { ...prev, triggers };
    });
    setIsDirty(true);
  }, []);

  const addAncillary = useCallback(() => {
    const baseName = 'new_ancillary';
    const newAnc = {
      name: baseName, type: 'Court', transferable: 0,
      image: 'court_noble.tga', unique: false, excludedAncillaries: [],
      excludeCultures: [], description: `${baseName}_desc`,
      effectsDescription: `${baseName}_effects_desc`, effects: [],
    };
    setAncData(prev => ({ ...prev, ancillaries: [...(prev?.ancillaries || []), newAnc] }));
    setTextData(prev => ({
      ...(prev || {}),
      [`${baseName}_desc`]: '',
      [`${baseName}_effects_desc`]: '',
    }));
    setIsDirty(true);
  }, []);

  const duplicateAncillary = useCallback((index) => {
    let newIndex = null;
    setAncData(prev => {
      if (!prev?.ancillaries?.[index]) return prev;
      const source = prev.ancillaries[index];
      const names = new Set(prev.ancillaries.map(a => a.name.toLowerCase()));
      let newName = `${source.name}_copy`;
      let n = 2;
      while (names.has(newName.toLowerCase())) newName = `${source.name}_copy_${n++}`;
      const remapKey = (key) => key ? (key.includes(source.name) ? key.replaceAll(source.name, newName) : `${newName}_${key}`) : key;
      const copy = {
        ...JSON.parse(JSON.stringify(source)),
        name: newName,
        description: remapKey(source.description),
        effectsDescription: remapKey(source.effectsDescription),
        excludedAncillaries: [],
      };
      const duplicatedTriggers = (prev.triggers || [])
        .filter(t => t.acquireAncillary?.name === source.name)
        .map(t => ({
          ...JSON.parse(JSON.stringify(t)),
          name: remapKey(t.name),
          acquireAncillary: { ...(t.acquireAncillary || {}), name: newName },
        }));
      newIndex = (prev.ancillaries || []).length;
      setTextData(textPrev => ({
        ...(textPrev || {}),
        [copy.description]: textPrev?.[source.description] || '',
        [copy.effectsDescription]: textPrev?.[source.effectsDescription] || '',
      }));
      return { ...prev, ancillaries: [...(prev.ancillaries || []), copy], triggers: [...(prev.triggers || []), ...duplicatedTriggers] };
    });
    setIsDirty(true);
    if (newIndex !== null) setSelectedAnc(newIndex);
    return newIndex;
  }, []);

  const deleteAncillary = useCallback((index) => {
    setAncData(prev => {
      const ancillaries = prev.ancillaries.filter((_, i) => i !== index);
      return { ...prev, ancillaries };
    });
    setSelectedAnc(null);
    setIsDirty(true);
  }, []);

  const revertAncillaries = useCallback(() => {
    if (originalAncData.current) setAncData(JSON.parse(originalAncData.current));
    if (originalTextData.current) setTextData(JSON.parse(originalTextData.current));
    setSelectedAnc(null);
    setIsDirty(false);
  }, []);

  const saveAncillaries = useCallback(() => {
    if (ancData) originalAncData.current = JSON.stringify(ancData);
    if (textData) originalTextData.current = JSON.stringify(textData);
    setIsDirty(false);
  }, [ancData, textData]);

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

  const exportAncFile = useCallback(() => {
    if (!ancData) return null;
    return serializeAncillariesFile(ancData);
  }, [ancData]);

  const exportTextFile = useCallback(() => {
    if (!textData) return null;
    return serializeTextFile(textData);
  }, [textData]);

  const getText = useCallback((key) => {
    if (!textData || !key) return '';
    return textData[key] || '';
  }, [textData]);

  const getTgaImage = useCallback((filename) => {
    if (!filename) return null;
    const key = filename.replace(/\.tga$/i, '').toLowerCase();
    return tgaImages[key] || null;
  }, [tgaImages]);

  return (
    <AncillariesContext.Provider value={{
      ancData, textData, tgaImages, textBinMeta,
      ancFilename, textFilename,
      isDirty, selectedAnc,
      setSelectedAnc,
      loadAncFile, loadTextFile, loadTgaImages,
      updateAncillary, addAncillary, duplicateAncillary, deleteAncillary,
      updateTrigger, addTrigger, deleteTrigger,
      revertAncillaries, saveAncillaries,
      updateTextEntry, renameTextKey,
      exportAncFile, exportTextFile,
      getText, getTgaImage,
    }}>
      {children}
    </AncillariesContext.Provider>
  );
}

export function useAncillaries() {
  return useContext(AncillariesContext);
}
