import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Swords, Upload, Download, Plus, FileText, CheckCircle2, Copy, Database, Image, FileCode } from 'lucide-react';
import UnitList from '../components/units/UnitList';
import UnitEditorPanel from '../components/units/UnitEditor';
import { parseEDU, serializeEDU, serializeUnit, createDefaultUnit } from '../components/units/EDUParser';
import { parseModeldb, serializeModeldb } from '../lib/modeldbCodec';
import { parseDescrModelBattle, serializeDescrModelBattle, syncDescrModelBattleEntryAliases } from '../lib/descrModelBattleCodec';
import { modeldbStore } from '../lib/modeldbStore';
import { parseStringsBin } from '@/components/strings/stringsBinCodec';
import { decodeTgaToDataUrl } from '@/components/shared/tgaDecoder';
import { parseTextLocFile } from '@/lib/textLocParser';

const STORAGE_KEY = 'm2tw_edu_units';
const EDU_FILE_KEY = 'm2tw_units_file';
const EDU_FILE_NAME_KEY = 'm2tw_edu_file_name';
const EXPORT_UNITS_KEY = 'm2tw_export_units_file';
const UNIT_IMAGES_KEY = 'm2tw_unit_images';

function loadUnits() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return [];
}
function saveUnits(units) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(units)); } catch {}
}

// Parse export_units.txt into a map: dictionary -> { name, long, short }
// M2TW format: {key}value on one line, or {key}\nvalue on next line, with ¬ or tab or no separator
function parseExportUnits(text) {
  const loc = parseTextLocFile(text);
  const map = {};
  for (const [fullKey, value] of Object.entries(loc)) {
    const isShort = fullKey.endsWith('_descr_short');
    const isLong  = !isShort && fullKey.endsWith('_descr');

    if (isShort) {
      const baseKey = fullKey.slice(0, -'_descr_short'.length);
      map[baseKey] = map[baseKey] || {};
      map[baseKey].short = value;
    } else if (isLong) {
      const baseKey = fullKey.slice(0, -'_descr'.length);
      map[baseKey] = map[baseKey] || {};
      map[baseKey].long = value;
    } else {
      // Name entry
      map[fullKey] = map[fullKey] || {};
      map[fullKey].name = value;
    }
  }
  return map;
}

// Serialize descriptions map back to export_units.txt text
function serializeExportUnits(descrMap) {
  const lines = [];
  for (const [key, val] of Object.entries(descrMap)) {
    lines.push(`{${key}}\t${val.name || ''}`);
    lines.push('');
    if (val.long) {
      lines.push(`{${key}_descr}`);
      lines.push(val.long);
      lines.push('');
    }
    if (val.short) {
      lines.push(`{${key}_descr_short}`);
      lines.push(val.short);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function loadUnitImages() {
  try {
    const s = localStorage.getItem(UNIT_IMAGES_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

function parseBattleModels(text, filename = '') {
  if (!text || typeof text !== 'string') return null;
  const lowerName = filename.toLowerCase();
  if (lowerName === 'descr_model_battle.txt' || (/^type\s+\S+/im.test(text) && /(?:^model_(?:flexi|mesh|stat)|^texture\s+)/im.test(text))) {
    return parseDescrModelBattle(text);
  }
  return parseModeldb(text);
}

function serializeBattleModels(parsed) {
  return parsed?.sourceFormat === 'descr_model_battle'
    ? serializeDescrModelBattle(parsed)
    : serializeModeldb(parsed);
}

function battleModelsDownloadName(parsed) {
  return parsed?.sourceFormat === 'descr_model_battle' ? 'descr_model_battle.txt' : 'battle_models.modeldb';
}

export default function UnitEditorPage() {
  const [units, setUnits] = useState(loadUnits);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filename, setFilename] = useState('export_descr_unit.txt');
  const [copied, setCopied] = useState(false);
  const [descrMap, setDescrMap] = useState(() => {
    try {
      // Parse raw file, then overlay any manual edits saved on top
      const raw = localStorage.getItem(EXPORT_UNITS_KEY);
      const base = raw ? parseExportUnits(raw) : {};
      const editsRaw = localStorage.getItem(EXPORT_UNITS_KEY + '_edits');
      const edits = editsRaw ? JSON.parse(editsRaw) : {};
      // Merge: edits override parsed values per-key per-field
      const merged = { ...base };
      for (const [k, v] of Object.entries(edits)) {
        merged[k] = { ...(merged[k] || {}), ...v };
      }
      return merged;
    } catch { return {}; }
  });
  const [unitImages, setUnitImages] = useState(() => window._m2tw_unit_images || loadUnitImages());
  const [modeldb, setModeldb] = useState(() => modeldbStore.get());
  const fileRef = useRef();
  const modeldbRef = useRef();
  const stringsBinRef = useRef();
  const unitUiFolderRef = useRef();

  // Auto-load from cached EDU file on mount (always prefer the raw file over stale parsed cache)
  useEffect(() => {
    try {
      const eduContent = localStorage.getItem(EDU_FILE_KEY);
      const eduName = localStorage.getItem(EDU_FILE_NAME_KEY);
      if (eduContent) {
        const parsed = parseEDU(eduContent);
        if (parsed.length > 0) {
          setUnits(parsed);
          saveUnits(parsed);
          if (eduName) setFilename(eduName);
        }
      }
    } catch {}
  }, []);

  // Auto-load modeldb from localStorage if available
  useEffect(() => {
    if (!modeldb) {
      try {
        const raw = localStorage.getItem('m2tw_modeldb_file');
        const name = localStorage.getItem('m2tw_modeldb_file_name') || '';
        if (raw) {
          const parsed = parseBattleModels(raw, name);
          modeldbStore.set(parsed);
          setModeldb(parsed);
        }
      } catch {}
    }
  }, []);

  // Listen for modeldb loaded from event (manual load button or folder import)
  useEffect(() => {
    const handler = (e) => {
      try {
        if (e.type === 'modeldb-loaded') {
          setModeldb(e.detail || null);
          return;
        }
        const text = typeof e.detail === 'string' ? e.detail : e.detail?.text;
        const filename = typeof e.detail === 'object' ? e.detail?.filename : '';
        const parsed = parseBattleModels(text, filename);
        if (!parsed) return;
        modeldbStore.set(parsed);
        setModeldb(parsed);
        if (text) {
          try {
            localStorage.setItem('m2tw_modeldb_file', text);
            if (filename) localStorage.setItem('m2tw_modeldb_file_name', filename);
          } catch {}
        }
      } catch {}
    };
    window.addEventListener('modeldb-loaded', handler);
    window.addEventListener('modeldb-file-loaded', handler);
    return () => {
      window.removeEventListener('modeldb-loaded', handler);
      window.removeEventListener('modeldb-file-loaded', handler);
    };
  }, []);

  const handleModeldbLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseBattleModels(ev.target.result, file.name);
        modeldbStore.set(parsed);
        setModeldb(parsed);
        try {
          localStorage.setItem('m2tw_modeldb_file', ev.target.result);
          localStorage.setItem('m2tw_modeldb_file_name', file.name);
        } catch {}
      } catch (err) {
        alert('Failed to parse battle model file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUpdateModeldbEntry = (name, updatedEntry) => {
    if (!modeldb) return;
    const preparedEntry = modeldb.sourceFormat === 'descr_model_battle'
      ? syncDescrModelBattleEntryAliases(updatedEntry, 'legacy')
      : updatedEntry;
    const entries = modeldb.entries.map(e => (e.name || e.type) === name ? preparedEntry : e);
    const byName = {};
    const byType = {};
    for (const entry of entries) {
      const entryName = entry.name || entry.type;
      if (!entryName) continue;
      byName[entryName.toLowerCase()] = entry;
      byType[(entry.type || entryName).toLowerCase()] = entry;
    }
    const updated = { ...modeldb, entries, byName, byType };
    modeldbStore.update(updated);
    setModeldb(updated);
  };

  const handleDownloadModeldb = () => {
    if (!modeldb) return;
    const text = serializeBattleModels(modeldb);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = battleModelsDownloadName(modeldb); a.click();
    URL.revokeObjectURL(url);
  };

  // Listen for unit images loaded from Home page
  useEffect(() => {
    const handler = (e) => {
      setUnitImages(e.detail);
      try { localStorage.setItem(UNIT_IMAGES_KEY, JSON.stringify(e.detail)); } catch {}
    };
    window.addEventListener('load-unit-images', handler);
    return () => window.removeEventListener('load-unit-images', handler);
  }, []);

  // Live-reload descriptions when Home page loads export_units.txt
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem(EXPORT_UNITS_KEY);
        if (!raw) return;
        const base = parseExportUnits(raw);
        const editsRaw = localStorage.getItem(EXPORT_UNITS_KEY + '_edits');
        const edits = editsRaw ? JSON.parse(editsRaw) : {};
        const merged = { ...base };
        for (const [k, v] of Object.entries(edits)) {
          merged[k] = { ...(merged[k] || {}), ...v };
        }
        setDescrMap(merged);
      } catch {}
    };
    window.addEventListener('load-export-units', handler);
    return () => window.removeEventListener('load-export-units', handler);
  }, []);

  const active = units[activeIndex] || null;
  const activeDescr = active ? (descrMap[active.dictionary] ?? null) : null;

  const update = (units) => { setUnits(units); saveUnits(units); };

  const handleDescrChange = (val) => {
    if (!active) return;
    const updated = { ...descrMap, [active.dictionary]: val };
    setDescrMap(updated);
    // Save edits back as a JSON overlay; the raw file is preserved separately
    try { localStorage.setItem(EXPORT_UNITS_KEY + '_edits', JSON.stringify(updated)); } catch {}
  };

  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFilename(file.name);
    localStorage.setItem(EDU_FILE_NAME_KEY, file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsed = parseEDU(text);
      update(parsed);
      setActiveIndex(0);
      // Persist so Unit Card Generator (and other tools) can read it
      try { localStorage.setItem(EDU_FILE_KEY, text); } catch {}
      // Notify same-tab listeners (UnitCardGenerator etc.)
      window.dispatchEvent(new CustomEvent('edu-file-loaded'));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAdd = () => {
    const newUnit = createDefaultUnit();
    const updated = [...units, newUnit];
    update(updated);
    setActiveIndex(updated.length - 1);
  };

  const handleDelete = (i) => {
    const updated = units.filter((_, idx) => idx !== i);
    update(updated);
    setActiveIndex(Math.max(0, i - 1));
  };

  const handleDuplicate = (i) => {
    const copy = { ...units[i], type: units[i].type + '_copy', dictionary: units[i].dictionary + '_copy' };
    const updated = [...units.slice(0, i + 1), copy, ...units.slice(i + 1)];
    update(updated);
    setActiveIndex(i + 1);
  };

  const handleChange = (unit) => {
    const updated = units.map((u, i) => i === activeIndex ? unit : u);
    update(updated);
  };

  const handleImageUpload = (key, dataUrl) => {
    const updated = { ...(unitImages || {}), [key]: dataUrl };
    window._m2tw_unit_images = updated;
    setUnitImages(updated);
    try { localStorage.setItem(UNIT_IMAGES_KEY, JSON.stringify(updated)); } catch {}
  };

  const handleImageDelete = (key) => {
    const updated = { ...(unitImages || {}) };
    // Try exact key and lowercase
    delete updated[key];
    for (const k of Object.keys(updated)) {
      if (k.toLowerCase() === key.toLowerCase()) delete updated[k];
    }
    window._m2tw_unit_images = updated;
    setUnitImages(updated);
    try { localStorage.setItem(UNIT_IMAGES_KEY, JSON.stringify(updated)); } catch {}
  };

  const handleStringsBinLoad = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let newDescr = {};
    if (file.name.toLowerCase().endsWith('.txt')) {
      const text = await file.text();
      newDescr = parseExportUnits(text);
      try {
        localStorage.setItem(EXPORT_UNITS_KEY, text);
        localStorage.setItem('m2tw_export_units_file_name', file.name);
      } catch {}
    } else {
      const buf = await file.arrayBuffer();
      const parsed = parseStringsBin(buf);
      if (!parsed) return;
      const map = {};
      for (const entry of parsed.entries) map[entry.key] = entry.value;
      for (const [key, val] of Object.entries(map)) {
        if (key.endsWith('_descr_short')) {
          const base = key.slice(0, -'_descr_short'.length);
          newDescr[base] = { ...(newDescr[base] || {}), short: val };
        } else if (key.endsWith('_descr')) {
          const base = key.slice(0, -'_descr'.length);
          newDescr[base] = { ...(newDescr[base] || {}), long: val };
        } else {
          newDescr[key] = { ...(newDescr[key] || {}), name: val };
        }
      }
    }
    // Merge over existing
    setDescrMap(prev => {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(newDescr)) {
        merged[k] = { ...(merged[k] || {}), ...v };
      }
      try { localStorage.setItem(EXPORT_UNITS_KEY + '_edits', JSON.stringify(merged)); } catch {}
      return merged;
    });
  };

  const [showMemoryNotice, setShowMemoryNotice] = useState(false);

  const handleUnitUiFolderLoad = async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.tga'));
    e.target.value = '';
    if (!files.length) return;
    const images = {};
    for (const file of files) {
      const buf = await file.arrayBuffer();
      // Store under full relative path (lowercased) AND bare filename for flexible lookup
      const dataUrl = decodeTgaToDataUrl(buf);
      if (dataUrl) {
        const bareName = file.name.replace(/\.tga$/i, '').toLowerCase();
        // webkitRelativePath gives e.g. "units/english/unit_spearmen.tga"
        const relPath = (file.webkitRelativePath || file.name).replace(/\.tga$/i, '').toLowerCase();
        images[bareName] = dataUrl;
        if (relPath !== bareName) images[relPath] = dataUrl;
      }
    }
    const updated = { ...(unitImages || {}), ...images };
    window._m2tw_unit_images = updated;
    setUnitImages(updated);
    try { localStorage.setItem(UNIT_IMAGES_KEY, JSON.stringify(updated)); } catch {}
    if (files.length > 50) setShowMemoryNotice(true);
  };

  const handleDownload = () => {
    const text = serializeEDU(units);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyUnit = () => {
    if (!active) return;
    navigator.clipboard.writeText(serializeUnit(active));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Memory notice modal */}
      {showMemoryNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-sm font-bold text-foreground">Large image set loaded</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  A large number of TGA images have been decoded and stored in memory as base64 PNG data URLs.
                  This can significantly increase browser memory usage and may cause the page to slow down or
                  reload unexpectedly on low-memory devices. Consider loading only the sub-folders you need
                  (e.g. <code className="font-mono bg-accent px-1 rounded">data\ui\units</code> or{' '}
                  <code className="font-mono bg-accent px-1 rounded">data\ui\unit_info</code> separately).
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowMemoryNotice(false)}
                className="px-4 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card/50">
        <Swords className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground">Unit Editor</span>
        <span className="text-[10px] text-muted-foreground font-mono">— export_descr_unit.txt</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <Upload className="w-3 h-3" />
            Load EDU file
          </button>
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={handleFileLoad} />
          <button
            onClick={() => modeldbRef.current?.click()}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors ${modeldb ? 'border-green-700 text-green-400 hover:bg-green-950' : 'border-border hover:bg-accent text-muted-foreground hover:text-foreground'}`}
          >
            <Database className="w-3 h-3" />
            {modeldb ? `Battle Models (${modeldb.entries.length})` : 'Load Battle Models'}
          </button>
          <input ref={modeldbRef} type="file" accept=".modeldb,.txt" className="hidden" onChange={handleModeldbLoad} />
          <button
            onClick={() => stringsBinRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title="Load export_units.txt or export_units.txt.strings.bin"
          >
            <FileCode className="w-3 h-3" />
            Load Unit Text
          </button>
          <input ref={stringsBinRef} type="file" accept=".txt,.bin,.strings.bin" className="hidden" onChange={handleStringsBinLoad} />
          <button
            onClick={() => unitUiFolderRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title="Load data\ui\units\ and data\ui\unit_info\ folders"
          >
            <Image className="w-3 h-3" />
            Load UI images
          </button>
          <input ref={unitUiFolderRef} type="file" accept=".tga" className="hidden" multiple webkitdirectory="" onChange={handleUnitUiFolderLoad} />
          {active && (
            <button
              onClick={handleCopyUnit}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {copied ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy unit'}
            </button>
          )}
          <Button size="sm" className="h-7 text-[11px] gap-1.5" onClick={handleDownload} disabled={units.length === 0}>
            <Download className="w-3.5 h-3.5" />
            Download EDU
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Left: unit list */}
        <div className="w-48 lg:w-56 border-r border-border shrink-0">
          <UnitList
            units={units}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
          />
        </div>

        {/* Center: unit editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          {active ? (
            <UnitEditorPanel
              unit={active}
              onChange={handleChange}
              descr={activeDescr}
              onDescrChange={handleDescrChange}
              unitImages={unitImages}
              onImageUpload={handleImageUpload}
              onImageDelete={handleImageDelete}
              modeldb={modeldb}
              onUpdateModeldbEntry={handleUpdateModeldbEntry}
              onDownloadModeldb={handleDownloadModeldb}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <FileText className="w-12 h-12 opacity-20" />
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-foreground">No units loaded</p>
                <p className="text-xs">Load an existing <code className="font-mono bg-accent px-1 rounded">export_descr_unit.txt</code><br />or add a new unit to get started.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" />
                  Load EDU file
                </Button>
                <Button size="sm" onClick={handleAdd}>
                  <Plus className="w-3.5 h-3.5" />
                  New unit
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
