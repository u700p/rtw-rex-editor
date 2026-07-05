import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Image, FolderOpen, Loader2 } from 'lucide-react';
import { decodeTgaToDataUrl } from '@/components/shared/tgaDecoder';
import SymbolGenerator from './SymbolGenerator';

const SYMBOL_GROUPS = [
  {
    label: 'Symbol 24',
    folder: 'data\\menu\\symbols\\FE_buttons_24',
    slots: [
      { key: 'symbol24',        suffix: '',        filename: (f) => `symbol24_${f}.tga` },
      { key: 'symbol24_grey',   suffix: '_grey',   filename: (f) => `symbol24_${f}_grey.tga` },
      { key: 'symbol24_roll',   suffix: '_roll',   filename: (f) => `symbol24_${f}_roll.tga` },
      { key: 'symbol24_select', suffix: '_select', filename: (f) => `symbol24_${f}_select.tga` },
    ],
  },
  {
    label: 'Symbol 48',
    folder: 'data\\menu\\symbols\\FE_buttons_48',
    slots: [
      { key: 'symbol48',        suffix: '',        filename: (f) => `symbol48_${f}.tga` },
      { key: 'symbol48_grey',   suffix: '_grey',   filename: (f) => `symbol48_${f}_grey.tga` },
      { key: 'symbol48_roll',   suffix: '_roll',   filename: (f) => `symbol48_${f}_roll.tga` },
      { key: 'symbol48_select', suffix: '_select', filename: (f) => `symbol48_${f}_select.tga` },
    ],
  },
  {
    label: 'Loading Screen Symbol',
    folder: 'data\\loading_screen\\symbols',
    slots: [
      { key: 'loading_symbol128', suffix: '', filename: (f) => `symbol128_${f}.tga` },
    ],
  },
];

const GENERATED_SYMBOL_SLOTS = {
  '24_standard': 'symbol24',
  '24_grey': 'symbol24_grey',
  '24_roll': 'symbol24_roll',
  '24_select': 'symbol24_select',
  '48_standard': 'symbol48',
  '48_grey': 'symbol48_grey',
  '48_roll': 'symbol48_roll',
  '48_select': 'symbol48_select',
  loading128_standard: 'loading_symbol128',
};

const FACTION_SYMBOL_PREVIEW_KEY = 'm2tw_faction_symbol_previews';

function normalizeFactionName(factionName) {
  return String(factionName || '').trim().toLowerCase();
}

function normalizeImageStem(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.(tga|png|jpe?g|bmp)$/i, '')
    .toLowerCase();
}

function getSymbolStore() {
  if (typeof window === 'undefined') return {};
  if (window._m2tw_faction_symbol_previews) return window._m2tw_faction_symbol_previews;
  try {
    window._m2tw_faction_symbol_previews = JSON.parse(sessionStorage.getItem(FACTION_SYMBOL_PREVIEW_KEY) || '{}');
  } catch {
    window._m2tw_faction_symbol_previews = {};
  }
  return window._m2tw_faction_symbol_previews;
}

function loadFactionSymbols(factionName) {
  const factionKey = normalizeFactionName(factionName);
  if (!factionKey) return {};
  return { ...(getSymbolStore()[factionKey] || {}) };
}

function storeFactionSymbols(factionName, images) {
  if (typeof window === 'undefined') return;
  const factionKey = normalizeFactionName(factionName);
  if (!factionKey) return;
  const store = getSymbolStore();
  store[factionKey] = { ...(store[factionKey] || {}), ...(images || {}) };
  window._m2tw_faction_symbol_previews = store;
  try { sessionStorage.setItem(FACTION_SYMBOL_PREVIEW_KEY, JSON.stringify(store)); } catch {}
}

async function decodePreviewFile(file) {
  if (!file) return null;
  if (/\.tga$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    return decodeTgaToDataUrl(buffer);
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas.toDataURL('image/png');
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function allSymbolSlots(factionName) {
  return SYMBOL_GROUPS.flatMap(group => group.slots.map(slot => ({
    ...slot,
    expectedStem: normalizeImageStem(slot.filename(factionName)),
  })));
}

function SymbolSlot({ label, filename, imageUrl, onLoad }) {
  const inputRef = useRef();
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setLoading(true);
    try {
      const url = await decodePreviewFile(file);
      if (url) onLoad(url);
    } finally {
      setLoading(false);
    }
  }, [onLoad]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative w-full aspect-square rounded border border-slate-600 bg-slate-900 flex items-center justify-center cursor-pointer group overflow-hidden"
        style={{ minWidth: 48, minHeight: 48 }}
        onClick={() => inputRef.current?.click()}
        title={`Load ${filename}`}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
        ) : imageUrl ? (
          <img src={imageUrl} alt={label} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <Image className="w-5 h-5 text-slate-600 group-hover:text-slate-400 transition-colors" />
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Upload className="w-4 h-4 text-white" />
        </div>
        <input ref={inputRef} type="file" accept=".tga,image/png,image/jpeg,image/bmp" className="hidden" onChange={handleFile} />
      </div>
      <span className="text-[9px] text-slate-500 text-center leading-tight break-all">{filename}</span>
    </div>
  );
}

export default function FactionSymbolsTab({ factionName }) {
  const [images, setImages] = useState(() => loadFactionSymbols(factionName));
  const [bulkLoading, setBulkLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');
  const folderRef = useRef();

  useEffect(() => {
    setImages(loadFactionSymbols(factionName));
    setLoadStatus('');
  }, [factionName]);

  const setImage = useCallback((key, url) => {
    setImages(prev => {
      const next = { ...prev, [key]: url };
      storeFactionSymbols(factionName, next);
      return next;
    });
  }, [factionName]);

  const loadGeneratedSymbols = useCallback((generated) => {
    const next = {};
    for (const [id, url] of Object.entries(generated || {})) {
      const slotKey = GENERATED_SYMBOL_SLOTS[id];
      if (slotKey && url) next[slotKey] = url;
    }
    if (Object.keys(next).length) {
      setImages(prev => {
        const merged = { ...prev, ...next };
        storeFactionSymbols(factionName, merged);
        return merged;
      });
      setLoadStatus(`Generated ${Object.keys(next).length} symbol preview${Object.keys(next).length === 1 ? '' : 's'}.`);
    }
  }, [factionName]);

  const loadMatchingFiles = useCallback(async (e) => {
    const files = Array.from(e.target.files || []).filter(file => /\.(tga|png|jpe?g|bmp)$/i.test(file.name));
    e.target.value = '';
    if (!files.length) return;

    const slots = allSymbolSlots(factionName);
    const byStem = new Map(slots.map(slot => [slot.expectedStem, slot]));
    const matched = [];
    for (const file of files) {
      const slot = byStem.get(normalizeImageStem(file.name));
      if (slot) matched.push({ file, slot });
    }

    if (!matched.length) {
      setLoadStatus(`No matching symbol files found for ${factionName}.`);
      return;
    }

    setBulkLoading(true);
    setLoadStatus(`Loading ${matched.length} matching symbol file${matched.length === 1 ? '' : 's'}...`);
    try {
      const decoded = await mapWithLimit(matched, 3, async ({ file, slot }) => {
        const url = await decodePreviewFile(file);
        return url ? [slot.key, url] : null;
      });
      const next = Object.fromEntries(decoded.filter(Boolean));
      setImages(prev => {
        const merged = { ...prev, ...next };
        storeFactionSymbols(factionName, merged);
        return merged;
      });
      setLoadStatus(`Loaded ${Object.keys(next).length}/${matched.length} faction logo preview${matched.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setLoadStatus(`Logo load failed: ${err.message}`);
    } finally {
      setBulkLoading(false);
    }
  }, [factionName]);

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-600 pb-2">
        <p className="text-sm font-semibold text-slate-200">Faction Symbols</p>
        <p className="text-xs text-slate-400">Preview and load .tga symbol files for <span className="font-mono text-amber-400">{factionName}</span></p>
      </div>

      <SymbolGenerator factionName={factionName} onGeneratedSymbols={loadGeneratedSymbols} />

      <div className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/50 p-2">
        <button
          type="button"
          onClick={() => folderRef.current?.click()}
          disabled={bulkLoading}
          className="h-7 px-2 rounded border border-slate-600 text-[10px] text-slate-300 hover:border-amber-500 hover:text-amber-300 disabled:opacity-50 flex items-center gap-1.5"
        >
          {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
          Load Matching Logos
        </button>
        <input
          ref={folderRef}
          type="file"
          accept=".tga,image/png,image/jpeg,image/bmp"
          multiple
          webkitdirectory=""
          className="hidden"
          onChange={loadMatchingFiles}
        />
        <p className="text-[10px] text-slate-500 flex-1">
          {loadStatus || `Matches symbol24_${factionName}.tga, symbol48_${factionName}.tga, and symbol128_${factionName}.tga.`}
        </p>
      </div>

      {SYMBOL_GROUPS.map((group) => (
        <div key={group.label} className="space-y-2">
          <div>
            <p className="text-[11px] font-semibold text-slate-300">{group.label}</p>
            <p className="text-[9px] text-slate-500 font-mono">{group.folder}</p>
          </div>
          <div className={`grid gap-3 ${group.slots.length === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
            {group.slots.map((slot) => (
              <SymbolSlot
                key={slot.key}
                label={slot.key}
                filename={slot.filename(factionName)}
                imageUrl={images[slot.key] || null}
                onLoad={(url) => setImage(slot.key, url)}
              />
            ))}
          </div>
        </div>
      ))}

      <p className="text-[10px] text-slate-600 italic pt-1">
        Click any slot to load the corresponding .tga file. Previews are view-only and not saved to disk.
      </p>
    </div>
  );
}
