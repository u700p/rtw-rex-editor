/**
 * EDBExporter — exports a ZIP containing:
 *   data/export_descr_buildings.txt
 *   data/text/export_buildings.txt
 *
 * The text file is built by:
 *  1. Loading the user's existing export_buildings.txt (optional)
 *  2. Collecting all text keys needed for every building/level in edbData
 *  3. Merging: existing entries are kept; new keys are appended with values
 *     from textData (falling back to base desc if culture-specific is empty)
 */

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileArchive, Upload } from 'lucide-react';
import { useEDB } from './EDBContext';
import { useRefData } from './RefDataContext';
import { serializeEDB } from './EDBParser';
import { parseTextLocFile, serializeTextLocFile } from '@/lib/textLocParser';

const IMAGE_SLOT_DEFS = [
  { type: 'icon',         w: 64,  h: 51  },
  { type: 'panel',        w: 78,  h: 62  },
  { type: 'construction', w: 300, h: 245 },
];

function encodeTGA(canvas, tw, th) {
  const off = document.createElement('canvas');
  off.width = tw; off.height = th;
  off.getContext('2d').drawImage(canvas, 0, 0, tw, th);
  const d = off.getContext('2d').getImageData(0, 0, tw, th).data;
  const hdr = new Uint8Array(18);
  hdr[2] = 2; hdr[12] = tw & 0xff; hdr[13] = tw >> 8;
  hdr[14] = th & 0xff; hdr[15] = th >> 8; hdr[16] = 32; hdr[17] = 0x28;
  const body = new Uint8Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++) {
    body[i*4]=d[i*4+2]; body[i*4+1]=d[i*4+1]; body[i*4+2]=d[i*4]; body[i*4+3]=d[i*4+3];
  }
  const out = new Uint8Array(18 + body.length);
  out.set(hdr); out.set(body, 18); return out;
}

function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.src = dataUrl;
  });
}

// Collect all text entries needed from the current edbData + textData
function buildExpectedEntries(edbData, textData, cultures) {
  const entries = []; // [{ key, value }] in desired order

  const get = (key, fallback = '') => {
    const v = textData[key];
    return (v !== undefined && v !== null && v !== '') ? v : fallback;
  };

  for (const building of edbData.buildings) {
    // Building tree name
    const treeNameKey = `${building.name}_name`;
    entries.push({ key: treeNameKey, value: get(treeNameKey) });

    for (const level of building.levels) {
      const baseName = get(level.name, level.name);
      const baseDesc = get(`${level.name}_desc`, '');
      const baseShort = get(`${level.name}_desc_short`, '');

      // Base level entries
      entries.push({ key: level.name,                    value: baseName });
      entries.push({ key: `${level.name}_desc`,          value: baseDesc });
      entries.push({ key: `${level.name}_desc_short`,    value: baseShort });

      // Per-culture entries
      for (const culture of cultures) {
        const cName  = get(`${level.name}_${culture}`,            baseName);
        const cDesc  = get(`${level.name}_${culture}_desc`,       baseDesc);
        const cShort = get(`${level.name}_${culture}_desc_short`, baseShort);

        entries.push({ key: `${level.name}_${culture}`,            value: cName });
        entries.push({ key: `${level.name}_${culture}_desc`,       value: cDesc });
        entries.push({ key: `${level.name}_${culture}_desc_short`, value: cShort });
      }
    }
  }

  return entries;
}

// Merge new entries into existing entries list (keyed by key string)
function mergeEntries(existingEntries, newEntries) {
  const map = new Map();
  for (const e of existingEntries) map.set(e.key, e.value);
  // Add missing keys at the end
  for (const e of newEntries) {
    if (!map.has(e.key)) {
      map.set(e.key, e.value);
    }
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

export default function EDBExporter() {
  const { edbData, textData, fileName, imageData } = useEDB();
  const { cultures } = useRefData();
  const [existingTextEntries, setExistingTextEntries] = useState([]);
  const [textFileName, setTextFileName] = useState('');
  const [exporting, setExporting] = useState(false);
  const textRef = useRef();

  const handleTextLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseTextLocFile(ev.target.result);
      setExistingTextEntries(Object.entries(parsed).map(([key, value]) => ({ key, value })));
      setTextFileName(file.name);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleExport = async () => {
    if (!edbData) return;
    setExporting(true);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 1. EDB file — encode as UTF-8 with Windows line endings (CRLF)
      const edbText = serializeEDB(edbData).replace(/\n/g, '\r\n');
      zip.file('data/export_descr_buildings.txt', edbText);

      // 2. Building text localization
      const expectedEntries = buildExpectedEntries(edbData, textData, cultures);
      const baseEntries = existingTextEntries;
      const merged = mergeEntries(baseEntries, expectedEntries);
      const textMap = Object.fromEntries(merged.map(({ key, value }) => [key, value]));
      zip.file('data/text/export_buildings.txt', serializeTextLocFile(textMap));

      // 3. Building images as TGA
      if (imageData && Object.keys(imageData).length > 0) {
        for (const [, imgEntry] of Object.entries(imageData)) {
          if (!imgEntry?.url) continue;
          const { culture, levelName, type } = imgEntry;
          if (!culture || !levelName || !type) continue;
          const slotDef = IMAGE_SLOT_DEFS.find(s => s.type === type);
          if (!slotDef) continue;
          const canvas = await dataUrlToCanvas(imgEntry.url);
          const tga = encodeTGA(canvas, slotDef.w, slotDef.h);
          const filename = `#${culture}_${levelName}${type === 'construction' ? '_constructed' : ''}.tga`;
          const subPath = type === 'icon'
            ? `ui/${culture}/buildings/constructed/${filename}`
            : `ui/${culture}/buildings/${filename}`;
          zip.file(`data/${subPath}`, tga);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edb_export.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Optional: load existing text localization to merge into */}
      <input ref={textRef} type="file" className="hidden" accept=".txt,text/plain" onChange={handleTextLoad} />
      <button
        onClick={() => textRef.current?.click()}
        className="h-7 px-2 rounded text-[10px] font-medium flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors shrink-0"
        title="Load existing export_buildings.txt to merge new entries into it"
      >
        <Upload className="w-3 h-3" />
        <span className="hidden xl:block">{textFileName || 'Load text'}</span>
        {textFileName && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
      </button>

      <Button
        size="sm"
        disabled={!edbData || exporting}
        onClick={handleExport}
        className="bg-green-700 text-white px-3 text-xs font-medium rounded-md inline-flex items-center justify-center h-7 gap-1 shrink-0 hover:bg-green-600 disabled:opacity-50"
        title="Export ZIP: export_descr_buildings.txt + export_buildings.txt"
      >
        <FileArchive className="w-3 h-3" />
        <span className="hidden lg:block">{exporting ? 'Exporting…' : 'Export Buildings Data'}</span>
      </Button>
    </div>
  );
}
