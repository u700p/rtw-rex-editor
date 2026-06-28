import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Download, FileText, Image, Upload, Wand2, Copy, Search, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseEDU, serializeEDU } from '@/components/units/EDUParser';
import { parseDescrSmFactions, serializeDescrSmFactions } from '@/lib/descrSmFactionsCodec';
import { parseTextLocFile, serializeTextLocFile } from '@/lib/textLocParser';
import { textBlob, toCRLF } from '@/lib/lineEndings';
import romeUi from '@/assets/rome/rome-ui.jpg';

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadText(text, filename) {
  downloadBlob(textBlob(text), filename);
}

function stripComment(line) {
  return String(line || '').replace(/;.*$/, '').trim();
}

function makeUniqueName(base, taken) {
  const used = new Set([...taken].map(v => String(v).toLowerCase()));
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base}_${i++}`;
  return name;
}

function readFileText(file) {
  return file ? file.text() : Promise.resolve('');
}

function parseDependencyReport(unit, modelText) {
  const missing = [];
  const modelNames = new Set();
  if (modelText) {
    for (const raw of modelText.split(/\r?\n/)) {
      const line = stripComment(raw);
      const m = line.match(/^type\s+(.+)/i) || line.match(/^(\S+)\s+\d+\s*$/);
      if (m) modelNames.add(m[1].trim().toLowerCase());
    }
  }
  const soldier = String(unit.soldier || '').split(',')[0]?.trim();
  if (modelText && soldier && !modelNames.has(soldier.toLowerCase())) missing.push(`model type: ${soldier}`);
  if (unit.officer) {
    for (const officer of String(unit.officer).split(',').map(s => s.trim()).filter(Boolean)) {
      if (modelText && !modelNames.has(officer.toLowerCase())) missing.push(`officer model: ${officer}`);
    }
  }
  return {
    soldier,
    mount: unit.mount || '',
    engine: unit.engine || '',
    ownership: (unit.ownership || []).join(', '),
    missing,
  };
}

function UnitImporterTab() {
  const [sourceEdu, setSourceEdu] = useState('');
  const [targetEdu, setTargetEdu] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [sourceModels, setSourceModels] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [lastReport, setLastReport] = useState('');

  const sourceUnits = useMemo(() => {
    try { return sourceEdu ? parseEDU(sourceEdu) : []; } catch { return []; }
  }, [sourceEdu]);
  const targetUnits = useMemo(() => {
    try { return targetEdu ? parseEDU(targetEdu) : []; } catch { return []; }
  }, [targetEdu]);
  const targetTypes = useMemo(() => new Set(targetUnits.map(u => u.type?.toLowerCase())), [targetUnits]);
  const visibleUnits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceUnits.filter(u => !q || [u.type, u.dictionary, u.category, ...(u.ownership || [])].some(v => String(v || '').toLowerCase().includes(q)));
  }, [sourceUnits, query]);

  const loadLocalTarget = () => {
    try {
      const raw = localStorage.getItem('m2tw_units_file');
      if (raw) setTargetEdu(raw);
      const loc = localStorage.getItem('m2tw_export_units_file');
      if (loc) setTargetText(loc);
    } catch {}
  };

  const toggle = (type) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const selectVisible = () => setSelected(prev => new Set([...prev, ...visibleUnits.map(u => u.type)]));

  const buildImport = async () => {
    const chosen = sourceUnits.filter(u => selected.has(u.type));
    const sourceLoc = parseTextLocFile(sourceText || '');
    const targetLoc = parseTextLocFile(targetText || '');
    const existing = new Set(targetUnits.map(u => u.type?.toLowerCase()));
    const imported = [];
    const skipped = [];
    const missingLines = [];

    for (const unit of chosen) {
      if (!replaceExisting && existing.has(unit.type.toLowerCase())) {
        skipped.push(`${unit.type} already exists`);
        continue;
      }
      imported.push(JSON.parse(JSON.stringify(unit)));
      const dep = parseDependencyReport(unit, sourceModels);
      if (dep.missing.length) missingLines.push(`${unit.type}: ${dep.missing.join(', ')}`);
      const key = unit.dictionary || unit.type;
      for (const suffix of ['', '_descr', '_descr_short']) {
        const locKey = `${key}${suffix}`;
        if (sourceLoc[locKey] !== undefined) targetLoc[locKey] = sourceLoc[locKey];
      }
    }

    const retained = replaceExisting
      ? targetUnits.filter(u => !selected.has(u.type))
      : targetUnits;
    const merged = [...retained, ...imported];
    const report = [
      `Imported units: ${imported.length}`,
      `Skipped units: ${skipped.length}`,
      '',
      imported.map(u => `+ ${u.type}`).join('\n'),
      skipped.length ? `\nSkipped:\n${skipped.map(s => `- ${s}`).join('\n')}` : '',
      missingLines.length ? `\nDependency warnings:\n${missingLines.map(s => `- ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    const zip = new JSZip();
    zip.file('export_descr_unit.txt', serializeEDU(merged));
    zip.file('export_units.txt', toCRLF(serializeTextLocFile(targetLoc, { header: 'Merged by Rome Tools unit importer' })));
    zip.file('unit_import_report.txt', toCRLF(report));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'rtw_unit_import.zip');
    setLastReport(report);
    try { localStorage.setItem('rtw_tools_last_output', report); } catch {}
  };

  return (
    <div className="grid grid-cols-[320px_1fr_300px] gap-3 min-h-0">
      <div className="space-y-3">
        <FileInput label="Source export_descr_unit.txt" accept=".txt" onText={setSourceEdu} />
        <FileInput label="Target export_descr_unit.txt" accept=".txt" onText={setTargetEdu} />
        <FileInput label="Source export_units.txt" accept=".txt" onText={setSourceText} />
        <FileInput label="Target export_units.txt" accept=".txt" onText={setTargetText} />
        <FileInput label="Source descr_model_battle.txt" accept=".txt" onText={setSourceModels} />
        <Button variant="outline" className="w-full h-8 text-xs" onClick={loadLocalTarget}>Use loaded target files</Button>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} className="accent-amber-500" />
          Replace existing unit types
        </label>
      </div>

      <div className="border border-slate-700 bg-slate-950/60 rounded overflow-hidden min-h-0 flex flex-col">
        <div className="p-2 border-b border-slate-700 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-amber-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search source units, factions, category..."
            className="flex-1 h-7 px-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-100" />
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={selectVisible}>Select visible</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {visibleUnits.map(unit => {
            const dep = parseDependencyReport(unit, sourceModels);
            const exists = targetTypes.has(unit.type.toLowerCase());
            return (
              <label key={unit.type} className="flex items-start gap-2 p-2 rounded border border-slate-800 hover:border-amber-700/60 bg-slate-900/55 cursor-pointer">
                <input type="checkbox" checked={selected.has(unit.type)} onChange={() => toggle(unit.type)} className="mt-1 accent-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-100 truncate">{unit.type}</span>
                    {exists && <span className="text-[10px] px-1.5 rounded bg-amber-900/40 text-amber-300">exists</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">{unit.category} / {unit.class} - {dep.ownership || 'no ownership'}</p>
                  <p className="text-[10px] text-slate-400 truncate">model: {dep.soldier || 'unknown'}{dep.mount ? ` - mount: ${dep.mount}` : ''}</p>
                  {dep.missing.length > 0 && <p className="text-[10px] text-red-300">Missing: {dep.missing.join(', ')}</p>}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
          <p className="text-xs font-semibold text-slate-100">Import Summary</p>
          <p className="text-[11px] text-slate-400 mt-1">{sourceUnits.length} source units, {targetUnits.length} target units, {selected.size} selected.</p>
          <Button className="w-full h-8 mt-3 text-xs gap-1.5" disabled={selected.size === 0 || !sourceEdu} onClick={buildImport}>
            <Download className="w-3.5 h-3.5" />
            Build import zip
          </Button>
        </div>
        <pre className="h-80 overflow-auto rounded border border-slate-700 bg-black/30 p-2 text-[10px] text-slate-300 whitespace-pre-wrap">{lastReport || 'Reports will appear here after export.'}</pre>
      </div>
    </div>
  );
}

function FileInput({ label, accept, onText, onBuffer }) {
  const handle = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (onBuffer) onBuffer(await file.arrayBuffer(), file);
    if (onText) onText(await file.text(), file);
  };
  return (
    <label className="block rounded border border-slate-700 bg-slate-900/60 p-2 cursor-pointer hover:border-amber-600/60">
      <input type="file" accept={accept} className="hidden" onChange={handle} />
      <span className="flex items-center gap-2 text-xs text-slate-200"><Upload className="w-3.5 h-3.5 text-amber-400" />{label}</span>
    </label>
  );
}

const NAMED_COLORS = {
  olive: '#808000',
  green: '#008000',
  lime: '#00ff00',
  forestgreen: '#228b22',
  darkolivegreen: '#556b2f',
  olivedrab: '#6b8e23',
  khaki: '#f0e68c',
  tan: '#d2b48c',
  brown: '#a52a2a',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  black: '#000000',
  white: '#ffffff',
};

function normalizeColorInput(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw];
  const short = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const full = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(raw);
  return full ? `#${full[1]}${full[2]}${full[3]}`.toLowerCase() : null;
}

function hexToRgb(hex) {
  const normalized = normalizeColorInput(hex) || '#a01e1e';
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 160, g: 30, b: 30 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothMask(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isProtectedMaterial(pixel, hsl, settings) {
  if (!settings.protectMaterials) return false;
  const { r, g, b } = pixel;
  const skinLike = hsl.h >= 12 && hsl.h <= 48 && hsl.s >= 0.14 && hsl.s <= 0.72 && hsl.l >= 0.22 && hsl.l <= 0.84 && r >= g * 0.88 && g >= b * 0.72;
  const leatherOrHair = hsl.h >= 12 && hsl.h <= 55 && hsl.s >= 0.08 && hsl.l >= 0.06 && hsl.l <= 0.52;
  const steelOrIron = hsl.s <= 0.18 && hsl.l >= 0.12 && hsl.l <= 0.88;
  const bronzeOrGold = hsl.h >= 34 && hsl.h <= 62 && hsl.s >= 0.16 && hsl.l >= 0.22 && hsl.l <= 0.78;
  return skinLike || leatherOrHair || steelOrIron || bronzeOrGold;
}

function recolorPasses(settings) {
  const passes = [
    { label: 'primary', source: settings.source, target: settings.target },
  ];
  if (settings.secondaryEnabled) passes.push({ label: 'secondary', source: settings.secondarySource, target: settings.secondaryTarget });
  if (settings.tertiaryEnabled) passes.push({ label: 'tertiary', source: settings.tertiarySource, target: settings.tertiaryTarget });
  return passes.map(pass => {
    const srcRgb = hexToRgb(pass.source);
    const tgtRgb = hexToRgb(pass.target);
    return {
      ...pass,
      srcRgb,
      src: rgbToHsl(srcRgb.r, srcRgb.g, srcRgb.b),
      tgt: rgbToHsl(tgtRgb.r, tgtRgb.g, tgtRgb.b),
    };
  });
}

function recolorImageData(imageData, settings) {
  const passes = recolorPasses(settings);
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const d = out.data;
  const tolerance = Number(settings.tolerance);
  const rgbTolerance = Number(settings.rgbTolerance);
  const strength = Number(settings.strength) / 100;
  const minSat = Number(settings.minSat) / 100;
  const targetSatMix = Number(settings.targetSatMix ?? 30) / 100;
  const saturationAdjust = Number(settings.saturationAdjust ?? 0) / 100;
  const targetLightMix = Number(settings.targetLightMix ?? 0) / 100;
  const lightnessShift = Number(settings.lightnessShift ?? 0) / 100;
  const lightnessContrast = Number(settings.lightnessContrast ?? 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 8) continue;
    const pixel = { r: d[i], g: d[i + 1], b: d[i + 2] };
    const hsl = rgbToHsl(pixel.r, pixel.g, pixel.b);
    if (isProtectedMaterial(pixel, hsl, settings)) continue;
    if (!settings.recolorNeutrals && hsl.s < minSat) continue;
    let best = null;
    for (const pass of passes) {
      const hueMask = settings.useSource ? Math.max(0, 1 - hueDistance(hsl.h, pass.src.h) / Math.max(1, tolerance)) : 1;
      const rgbMask = settings.useSource ? Math.max(0, 1 - colorDistance(pixel, pass.srcRgb) / Math.max(1, rgbTolerance)) : 1;
      const score = Math.sqrt(hueMask * rgbMask);
      if (!best || score > best.score) best = { ...pass, score };
    }
    const satMask = hsl.s >= minSat ? 1 : 0.38;
    const detailMask = settings.protectExtremes && (hsl.l < 0.055 || hsl.l > 0.955) ? 0.18 : 1;
    const mask = smoothMask((best?.score || 0) * satMask * detailMask) * strength;
    if (mask <= 0) continue;
    let recolored;
    if (settings.exactTargetColor) {
      recolored = best.tgtRgb;
    } else {
      const targetSat = clamp01(hsl.s * (1 - targetSatMix) + best.tgt.s * targetSatMix + saturationAdjust);
      const baseLight = settings.preserveLight ? hsl.l : clamp01(hsl.l * 0.82 + best.tgt.l * 0.18);
      const mixedLight = clamp01(baseLight * (1 - targetLightMix) + best.tgt.l * targetLightMix);
      const contrastedLight = clamp01((mixedLight - 0.5) * (1 + lightnessContrast) + 0.5);
      const targetLight = clamp01(contrastedLight + lightnessShift);
      recolored = hslToRgb(best.tgt.h, targetSat, targetLight);
    }
    d[i] = Math.round(d[i] * (1 - mask) + recolored.r * mask);
    d[i + 1] = Math.round(d[i + 1] * (1 - mask) + recolored.g * mask);
    d[i + 2] = Math.round(d[i + 2] * (1 - mask) + recolored.b * mask);
  }
  return out;
}

function decodeTga(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) throw new Error('Invalid TGA');
  const idLength = data[0], colorMapType = data[1], imageType = data[2];
  const width = data[12] | (data[13] << 8), height = data[14] | (data[15] << 8);
  const bpp = data[16], desc = data[17], topOrigin = !!(desc & 0x20);
  if (colorMapType !== 0 || ![2, 10].includes(imageType) || ![24, 32].includes(bpp)) throw new Error('Only true-color TGA is supported');
  const pixels = new Uint8ClampedArray(width * height * 4);
  let src = 18 + idLength, dst = 0, pixel = 0;
  const readPixel = () => {
    const b = data[src++], g = data[src++], r = data[src++], a = bpp === 32 ? data[src++] : 255;
    return [r, g, b, a];
  };
  if (imageType === 2) {
    while (pixel++ < width * height) pixels.set(readPixel(), dst), dst += 4;
  } else {
    while (pixel < width * height) {
      const packet = data[src++], count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        const px = readPixel();
        for (let i = 0; i < count; i++, pixel++, dst += 4) pixels.set(px, dst);
      } else {
        for (let i = 0; i < count; i++, pixel++, dst += 4) pixels.set(readPixel(), dst);
      }
    }
  }
  if (!topOrigin) flipRows(pixels, width, height);
  return new ImageData(pixels, width, height);
}

function flipRows(pixels, width, height) {
  const row = width * 4;
  const tmp = new Uint8ClampedArray(row);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * row, bot = (height - 1 - y) * row;
    tmp.set(pixels.slice(top, top + row));
    pixels.copyWithin(top, bot, bot + row);
    pixels.set(tmp, bot);
  }
}

function encodeTga(imageData) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(18 + width * height * 4);
  out[2] = 2;
  out[12] = width & 255; out[13] = width >> 8;
  out[14] = height & 255; out[15] = height >> 8;
  out[16] = 32; out[17] = 0x28;
  let p = 18;
  for (let i = 0; i < data.length; i += 4) {
    out[p++] = data[i + 2]; out[p++] = data[i + 1]; out[p++] = data[i]; out[p++] = data[i + 3];
  }
  return out;
}

function encodeDds(imageData) {
  const { width, height, data } = imageData;
  const headerSize = 128;
  const bodySize = width * height * 4;
  const out = new Uint8Array(headerSize + bodySize);
  const view = new DataView(out.buffer);

  view.setUint32(0, 0x20534444, true); // DDS
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x0002100f, true); // caps, height, width, pitch, pixelformat
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, width * 4, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x41, true); // RGB + alpha pixels
  view.setUint32(88, 32, true);
  view.setUint32(92, 0x00ff0000, true);
  view.setUint32(96, 0x0000ff00, true);
  view.setUint32(100, 0x000000ff, true);
  view.setUint32(104, 0xff000000, true);
  view.setUint32(108, 0x1000, true); // texture

  let p = headerSize;
  for (let i = 0; i < data.length; i += 4) {
    out[p++] = data[i + 2];
    out[p++] = data[i + 1];
    out[p++] = data[i];
    out[p++] = data[i + 3];
  }
  return out;
}

function appendSuffix(filename, suffix, ext) {
  const parts = String(filename || 'texture').replace(/\\/g, '/').split('/');
  const base = parts.pop() || 'texture';
  const stem = base.replace(/\.(tga|dds|png|jpg|jpeg)$/i, '');
  parts.push(`${stem}${suffix || ''}.${ext}`);
  return parts.join('/');
}

function rgb565(v) {
  return { r: ((v >> 11) & 31) * 255 / 31, g: ((v >> 5) & 63) * 255 / 63, b: (v & 31) * 255 / 31, a: 255 };
}

function decodeDds(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x20534444) throw new Error('Invalid DDS');
  const height = view.getUint32(12, true), width = view.getUint32(16, true);
  const fourCC = String.fromCharCode(view.getUint8(84), view.getUint8(85), view.getUint8(86), view.getUint8(87));
  const rgbBits = view.getUint32(88, true);
  const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), view.getUint32(104, true)];
  const src = new Uint8Array(buffer, 128);
  if (fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5') return decodeDxt(src, width, height, fourCC);
  if (rgbBits === 32) return decodeDds32(src, width, height, masks);
  throw new Error(`Unsupported DDS format: ${fourCC || `${rgbBits}-bit RGB`}`);
}

function maskInfo(mask) {
  if (!mask) return { shift: 0, bits: 0, max: 1 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0 && shift < 32) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1 && bits < 8) bits++;
  return { shift, bits, max: (1 << bits) - 1 };
}

function decodeDds32(src, width, height, masks) {
  const infos = masks.map(maskInfo);
  const out = new Uint8ClampedArray(width * height * 4);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < width * height; i++) {
    const v = view.getUint32(i * 4, true);
    out[i * 4] = Math.round((((v & masks[0]) >>> infos[0].shift) / infos[0].max) * 255);
    out[i * 4 + 1] = Math.round((((v & masks[1]) >>> infos[1].shift) / infos[1].max) * 255);
    out[i * 4 + 2] = Math.round((((v & masks[2]) >>> infos[2].shift) / infos[2].max) * 255);
    out[i * 4 + 3] = masks[3] ? Math.round((((v & masks[3]) >>> infos[3].shift) / infos[3].max) * 255) : 255;
  }
  return new ImageData(out, width, height);
}

function decodeDxt(src, width, height, fourCC) {
  const out = new Uint8ClampedArray(width * height * 4);
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  let p = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const alpha = new Array(16).fill(255);
      if (fourCC === 'DXT3') {
        for (let i = 0; i < 8; i++) {
          const byte = src[p + i];
          alpha[i * 2] = (byte & 15) * 17;
          alpha[i * 2 + 1] = (byte >> 4) * 17;
        }
      } else if (fourCC === 'DXT5') {
        const a0 = src[p], a1 = src[p + 1];
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i <= 6; i++) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        else { for (let i = 1; i <= 4; i++) table.push(Math.round(((5 - i) * a0 + i * a1) / 5)); table.push(0, 255); }
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(src[p + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = table[Number((bits >> BigInt(3 * i)) & 7n)];
      }
      const cp = p + (fourCC === 'DXT1' ? 0 : 8);
      const c0 = src[cp] | (src[cp + 1] << 8), c1 = src[cp + 2] | (src[cp + 3] << 8);
      const colors = [rgb565(c0), rgb565(c1)];
      if (c0 > c1 || fourCC !== 'DXT1') {
        colors.push({ r: (2 * colors[0].r + colors[1].r) / 3, g: (2 * colors[0].g + colors[1].g) / 3, b: (2 * colors[0].b + colors[1].b) / 3, a: 255 });
        colors.push({ r: (colors[0].r + 2 * colors[1].r) / 3, g: (colors[0].g + 2 * colors[1].g) / 3, b: (colors[0].b + 2 * colors[1].b) / 3, a: 255 });
      } else {
        colors.push({ r: (colors[0].r + colors[1].r) / 2, g: (colors[0].g + colors[1].g) / 2, b: (colors[0].b + colors[1].b) / 2, a: 255 });
        colors.push({ r: 0, g: 0, b: 0, a: 0 });
      }
      const idxBits = src[cp + 4] | (src[cp + 5] << 8) | (src[cp + 6] << 16) | (src[cp + 7] << 24);
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx + px, y = by + py;
        if (x >= width || y >= height) continue;
        const ci = (idxBits >>> (2 * (py * 4 + px))) & 3;
        const dst = (y * width + x) * 4;
        out[dst] = colors[ci].r; out[dst + 1] = colors[ci].g; out[dst + 2] = colors[ci].b; out[dst + 3] = Math.min(colors[ci].a, alpha[py * 4 + px]);
      }
      p += blockBytes;
    }
  }
  return new ImageData(out, width, height);
}

async function decodeImageFile(file) {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith('.tga')) return decodeTga(buffer);
  if (name.endsWith('.dds')) return decodeDds(buffer);
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function TextureRecolorTab() {
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState({
    source: '#9e1a1a', target: '#2f6fc0', tolerance: 38, rgbTolerance: 190, strength: 88, minSat: 18,
    targetSatMix: 30, saturationAdjust: 0, targetLightMix: 0, lightnessShift: 0, lightnessContrast: 0,
    secondarySource: '#d7c04a', secondaryTarget: '#e4e4e4',
    tertiarySource: '#2d6d37', tertiaryTarget: '#8c2f2f',
    suffix: '_recolor', outputFormat: 'both',
    useSource: true, preserveLight: true, exactTargetColor: false, recolorNeutrals: false, protectExtremes: true,
    protectMaterials: true, secondaryEnabled: false, tertiaryEnabled: false,
  });
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('');

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const loadPreview = async (fileList) => {
    const first = fileList[0];
    if (!first) return;
    try {
      const original = await decodeImageFile(first);
      const processed = recolorImageData(original, settings);
      setPreview({ name: first.name, before: imageDataUrl(original), after: imageDataUrl(processed) });
    } catch (err) {
      setStatus(`Preview failed: ${err.message}`);
    }
  };

  const handleFiles = async (e) => {
    const list = Array.from(e.target.files || []).filter(file => /\.(tga|dds|png|jpe?g)$/i.test(file.name));
    e.target.value = '';
    setFiles(list);
    setStatus(`${list.length} texture files queued.`);
    await loadPreview(list);
  };

  const refreshPreview = () => loadPreview(files);
  const clearQueue = () => {
    setFiles([]);
    setPreview(null);
    setStatus('Texture queue cleared.');
  };

  const exportZip = async () => {
    const zip = new JSZip();
    const lines = [];
    for (const file of files) {
      try {
        const original = await decodeImageFile(file);
        const processed = recolorImageData(original, settings);
        const sourcePath = file.webkitRelativePath || file.name;
        const outNames = [];
        if (settings.outputFormat === 'tga' || settings.outputFormat === 'both') {
          const outName = appendSuffix(sourcePath, settings.suffix, 'tga');
          zip.file(outName, encodeTga(processed));
          outNames.push(outName);
        }
        if (settings.outputFormat === 'dds' || settings.outputFormat === 'both') {
          const outName = appendSuffix(sourcePath, settings.suffix, 'dds');
          zip.file(outName, encodeDds(processed));
          outNames.push(outName);
        }
        lines.push(`OK ${sourcePath} -> ${outNames.join(', ')}`);
      } catch (err) {
        lines.push(`FAILED ${file.name}: ${err.message}`);
      }
    }
    zip.file('recolor_report.txt', toCRLF(lines.join('\n')));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'rtw_texture_recolor.zip');
    setStatus(lines.join('\n'));
    try { localStorage.setItem('rtw_tools_last_output', lines.join('\n')); } catch {}
  };

  return (
    <div className="grid grid-cols-[300px_1fr_300px] gap-3">
      <div className="space-y-3">
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.dds,.png,.jpg,.jpeg" multiple className="hidden" onChange={handleFiles} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load TGA/DDS textures</span>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.dds,.png,.jpg,.jpeg" multiple webkitdirectory="" directory="" className="hidden" onChange={handleFiles} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load texture folder</span>
        </label>
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>{files.length} queued</span>
          <button onClick={clearQueue} disabled={!files.length} className="text-slate-400 hover:text-slate-200 disabled:opacity-40">Clear</button>
        </div>
        <Swatch label="Source faction color" value={settings.source} onChange={v => update('source', v)} />
        <Swatch label="Target faction color" value={settings.target} onChange={v => update('target', v)} />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={settings.secondaryEnabled} onChange={e => update('secondaryEnabled', e.target.checked)} className="accent-amber-500" />
          Secondary color pass
        </label>
        {settings.secondaryEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Swatch label="Secondary source" value={settings.secondarySource} onChange={v => update('secondarySource', v)} />
            <Swatch label="Secondary target" value={settings.secondaryTarget} onChange={v => update('secondaryTarget', v)} />
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={settings.tertiaryEnabled} onChange={e => update('tertiaryEnabled', e.target.checked)} className="accent-amber-500" />
          Tertiary color pass
        </label>
        {settings.tertiaryEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Swatch label="Tertiary source" value={settings.tertiarySource} onChange={v => update('tertiarySource', v)} />
            <Swatch label="Tertiary target" value={settings.tertiaryTarget} onChange={v => update('tertiaryTarget', v)} />
          </div>
        )}
        <Range label="Hue tolerance" value={settings.tolerance} min={1} max={180} onChange={v => update('tolerance', v)} />
        <Range label="RGB tolerance" value={settings.rgbTolerance} min={24} max={360} onChange={v => update('rgbTolerance', v)} />
        <Range label="Strength" value={settings.strength} min={1} max={100} onChange={v => update('strength', v)} />
        <Range label="Minimum saturation" value={settings.minSat} min={0} max={100} onChange={v => update('minSat', v)} />
        <Range label="Target saturation mix" value={settings.targetSatMix} min={0} max={100} onChange={v => update('targetSatMix', v)} />
        <Range label="Saturation adjust" value={settings.saturationAdjust} min={-50} max={50} onChange={v => update('saturationAdjust', v)} />
        <Range label="Target lightness mix" value={settings.targetLightMix} min={0} max={100} onChange={v => update('targetLightMix', v)} />
        <Range label="Lightness shift" value={settings.lightnessShift} min={-50} max={50} onChange={v => update('lightnessShift', v)} />
        <Range label="Lightness contrast" value={settings.lightnessContrast} min={-50} max={50} onChange={v => update('lightnessContrast', v)} />
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Batch suffix</span>
          <input
            value={settings.suffix}
            onChange={e => update('suffix', e.target.value)}
            className="w-full h-8 mt-1 px-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Export format</span>
          <select
            value={settings.outputFormat}
            onChange={e => update('outputFormat', e.target.value)}
            className="w-full h-8 mt-1 px-2 text-xs bg-slate-900 border border-slate-700 rounded"
          >
            <option value="both">TGA + DDS</option>
            <option value="tga">TGA only</option>
            <option value="dds">DDS only</option>
          </select>
        </label>
        {[
          ['useSource', 'Match source hue'],
          ['preserveLight', 'Preserve shadows/highlights'],
          ['exactTargetColor', 'Exact target RGB'],
          ['recolorNeutrals', 'Allow low-saturation pixels'],
          ['protectExtremes', 'Protect black/white detail'],
          ['protectMaterials', 'Protect skin/hair/leather/armor'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings[key]} onChange={e => update(key, e.target.checked)} className="accent-amber-500" />
            {label}
          </label>
        ))}
        <Button variant="outline" className="w-full h-8 text-xs" onClick={refreshPreview} disabled={!files.length}>Refresh preview</Button>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={exportZip} disabled={!files.length}>
          <Download className="w-3.5 h-3.5" />
          Export recolored zip
        </Button>
      </div>
      <div className="rounded border border-slate-700 bg-slate-950/60 p-3 min-h-[420px]">
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <PreviewImage label={`${preview.name} original`} src={preview.before} />
            <PreviewImage label="recolored output" src={preview.after} />
          </div>
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-500">Load textures to preview recolor results.</div>
        )}
      </div>
      <pre className="rounded border border-slate-700 bg-black/30 p-2 text-[10px] text-slate-300 whitespace-pre-wrap overflow-auto">{status || 'Supports true-color/RLE TGA, DXT1/DXT3/DXT5 DDS, and browser image formats. Output uses 32-bit TGA and uncompressed 32-bit DDS for cleaner results.'}</pre>
    </div>
  );
}

function Swatch({ label, value, onChange }) {
  const normalized = normalizeColorInput(value) || '#000000';
  const [draft, setDraft] = useState(value || normalized);
  useEffect(() => {
    setDraft(value || normalized);
  }, [value, normalized]);

  const commit = () => {
    const next = normalizeColorInput(draft);
    if (next) onChange(next);
    else setDraft(value || normalized);
  };

  return (
    <label className="block">
      <span className="text-[10px] uppercase text-slate-500">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input type="color" value={normalized} onChange={e => onChange(e.target.value)} className="w-10 h-8 bg-transparent border-0" />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder="#808000 or olive"
          className="flex-1 h-8 px-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded"
        />
      </div>
    </label>
  );
}

function Range({ label, value, min, max, onChange }) {
  return (
    <label className="block">
      <div className="flex justify-between text-[10px] uppercase text-slate-500"><span>{label}</span><span>{value}</span></div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-amber-500" />
    </label>
  );
}

function PreviewImage({ label, src }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-500 mb-1">{label}</p>
      <div className="border border-slate-700 bg-black/40 rounded overflow-hidden">
        <img src={src} alt={label} className="w-full h-auto image-render-pixelated" />
      </div>
    </div>
  );
}

function cloneDelimitedBlock(text, startRegex, stopRegex, transform) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const start = lines.findIndex(line => startRegex.test(stripComment(line)));
  if (start === -1) throw new Error('Source block not found');
  let end = start + 1;
  while (end < lines.length && !stopRegex.test(stripComment(lines[end]))) end++;
  const block = lines.slice(start, end);
  const clone = transform(block.join('\n')).split('\n');
  return [...lines.slice(0, end), '', ...clone, ...lines.slice(end)].join('\n');
}

function duplicateRegionBlock(text, source, target, settlement, rgb) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const clean = lines.map(stripComment);
  const start = clean.findIndex(line => line.toLowerCase() === source.toLowerCase());
  if (start === -1) throw new Error('Region not found');
  let end = start + 8;
  while (end < lines.length && !/^\S+$/.test(clean[end]) && clean[end]) end++;
  const block = lines.slice(start, end);
  block[0] = target;
  if (settlement) block[1] = `\t${settlement}`;
  if (rgb) block[4] = `\t${rgb}`;
  return [...lines.slice(0, end), '', ...block, ...lines.slice(end)].join('\n');
}

function duplicateStratSettlement(text, sourceRegion, targetRegion, targetSettlement) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^settlement\b/i.test(stripComment(lines[i]))) continue;
    let depth = 0, end = i;
    for (; end < lines.length; end++) {
      const line = stripComment(lines[end]);
      if (line.includes('{')) depth++;
      if (line.includes('}')) {
        depth--;
        if (depth <= 0) break;
      }
    }
    const block = lines.slice(i, end + 1);
    if (!block.some(line => stripComment(line).toLowerCase() === `region ${sourceRegion}`.toLowerCase())) continue;
    const clone = block.map(line => {
      if (/^\s*region\s+/i.test(line)) return line.replace(/region\s+\S+/i, `region ${targetRegion}`);
      if (/^\s*settlement_name\s+/i.test(line) && targetSettlement) return line.replace(/settlement_name\s+\S+/i, `settlement_name ${targetSettlement}`);
      if (/^\s*x\s+/i.test(line)) return line.replace(/x\s+(\d+)/i, (_, n) => `x ${Number(n) + 2}`);
      if (/^\s*y\s+/i.test(line)) return line.replace(/y\s+(\d+)/i, (_, n) => `y ${Number(n) + 2}`);
      return line;
    });
    return [...lines.slice(0, end + 1), '', ...clone, ...lines.slice(end + 1)].join('\n');
  }
  throw new Error('Settlement region not found in descr_strat');
}

function DuplicatorsTab() {
  const [kind, setKind] = useState('faction');
  const [input, setInput] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [settlement, setSettlement] = useState('');
  const [rgb, setRgb] = useState('120 80 40');
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('');

  const run = () => {
    try {
      let out = input;
      if (kind === 'faction') {
        const factions = parseDescrSmFactions(input);
        const src = factions.find(f => f.name.toLowerCase() === source.toLowerCase());
        if (!src) throw new Error('Source faction not found');
        const copy = JSON.parse(JSON.stringify(src));
        copy.name = target;
        const upper = target.toUpperCase();
        copy.symbol = (copy.symbol || '').replace(new RegExp(source, 'ig'), target);
        copy.rebel_symbol = copy.rebel_symbol || 'models_strat/symbol_slaves.CAS';
        copy.loading_logo = (copy.loading_logo || `loading_screen/symbols/symbol128_${target}.tga`).replace(new RegExp(source, 'ig'), target);
        copy.logo_index = `FACTION_LOGO_${upper}`;
        copy.small_logo_index = `SMALL_FACTION_LOGO_${upper}`;
        out = serializeDescrSmFactions([...factions, copy]);
      } else if (kind === 'unit') {
        const units = parseEDU(input);
        const src = units.find(u => u.type.toLowerCase() === source.toLowerCase());
        if (!src) throw new Error('Source unit not found');
        const copy = JSON.parse(JSON.stringify(src));
        copy.type = target;
        copy.dictionary = target;
        out = serializeEDU([...units, copy]);
      } else if (kind === 'trait') {
        out = cloneDelimitedBlock(input, new RegExp(`^Trait\\s+${source}$`, 'i'), /^(Trait|Trigger)\s+/i, block => block.replace(new RegExp(`Trait\\s+${source}`, 'i'), `Trait ${target}`).replaceAll(source, target));
      } else if (kind === 'ancillary') {
        out = cloneDelimitedBlock(input, new RegExp(`^Ancillary\\s+${source}$`, 'i'), /^(Ancillary|Trigger)\s+/i, block => block.replace(new RegExp(`Ancillary\\s+${source}`, 'i'), `Ancillary ${target}`).replaceAll(source, target));
      } else if (kind === 'region') {
        out = duplicateRegionBlock(input, source, target, settlement, rgb);
      } else if (kind === 'descr_strat') {
        out = duplicateStratSettlement(input, source, target, settlement);
      }
      setOutput(out);
      setMessage(`Duplicated ${source} -> ${target}`);
      try { localStorage.setItem('rtw_tools_last_output', `Duplicated ${source} -> ${target}`); } catch {}
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="grid grid-cols-[300px_1fr] gap-3 min-h-0">
      <div className="space-y-3">
        <FileInput label="Load source text file" accept=".txt" onText={setInput} />
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Duplicator type</span>
          <select value={kind} onChange={e => setKind(e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs">
            <option value="faction">descr_sm_factions faction</option>
            <option value="descr_strat">descr_strat settlement</option>
            <option value="unit">export_descr_unit unit</option>
            <option value="ancillary">export_descr_ancillaries ancillary</option>
            <option value="trait">export_descr_character_traits trait</option>
            <option value="region">descr_regions region</option>
          </select>
        </label>
        <TextField label={kind === 'descr_strat' ? 'Source region' : 'Source name'} value={source} onChange={setSource} />
        <TextField label={kind === 'descr_strat' ? 'New region' : 'New name'} value={target} onChange={setTarget} />
        {(kind === 'region' || kind === 'descr_strat') && <TextField label="New settlement name" value={settlement} onChange={setSettlement} />}
        {kind === 'region' && <TextField label="New map RGB" value={rgb} onChange={setRgb} />}
        <Button className="w-full h-8 text-xs gap-1.5" onClick={run} disabled={!input || !source || !target}>
          <Copy className="w-3.5 h-3.5" />
          Duplicate
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={() => downloadText(output, `${kind}_duplicated.txt`)} disabled={!output}>
          <Download className="w-3.5 h-3.5" />
          Download output
        </Button>
        <p className="text-xs text-amber-300">{message}</p>
      </div>
      <textarea value={output || input} onChange={e => setOutput(e.target.value)} className="min-h-[520px] rounded border border-slate-700 bg-black/30 p-3 text-[11px] font-mono text-slate-200" />
    </div>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs font-mono" />
    </label>
  );
}

export default function RomeTools() {
  const [tab, setTab] = useState('importer');
  const tabs = [
    ['importer', 'Unit Importer', FileText],
    ['recolor', 'Texture Recolorizer', Wand2],
    ['duplicate', 'Duplicators', Copy],
  ];

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      <div className="h-32 shrink-0 border-b border-slate-800 bg-cover bg-center relative" style={{ backgroundImage: `linear-gradient(90deg, rgba(8, 7, 5, 0.94), rgba(8, 7, 5, 0.72)), url(${romeUi})` }}>
        <div className="absolute inset-0 p-4 flex flex-col justify-end">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase text-amber-400">Rome Total War Workshop</p>
              <h1 className="text-2xl font-bold text-slate-100">Rome Tools</h1>
            </div>
            <div className="flex gap-1">
              {tabs.map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`h-8 px-3 rounded border text-xs flex items-center gap-1.5 ${tab === id ? 'border-amber-500 bg-amber-600/20 text-amber-200' : 'border-slate-700 bg-slate-900/75 text-slate-300 hover:text-white'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-auto">
        {tab === 'importer' && <UnitImporterTab />}
        {tab === 'recolor' && <TextureRecolorTab />}
        {tab === 'duplicate' && <DuplicatorsTab />}
      </div>
      <div className="h-8 border-t border-slate-800 px-3 flex items-center gap-2 text-[10px] text-slate-500">
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        Local-only tools. No login, no upload.
      </div>
    </div>
  );
}
