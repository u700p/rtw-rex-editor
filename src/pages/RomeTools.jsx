import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Clipboard, Download, FileText, Image, Upload, Wand2, Copy, Search, CheckCircle2, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inferSiegeEngine, parseEDU, serializeEDU } from '@/components/units/EDUParser';
import { parseDescrSmFactions, serializeDescrSmFactions } from '@/lib/descrSmFactionsCodec';
import { parseTextLocFile, serializeTextLocFile } from '@/lib/textLocParser';
import { textBlob, toCRLF } from '@/lib/lineEndings';
import { getEduRawText } from '@/lib/eduStorage';
import { loadLargeText, saveLargeText } from '@/lib/largeTextStore';
import { patchDmbSlaveTextures } from '@/lib/dmbSlaveTextures';
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

async function getLoadedDmbText() {
  try {
    const direct = localStorage.getItem('m2tw_descr_model_battle_file');
    if (direct) return direct;
    const name = localStorage.getItem('m2tw_modeldb_file_name') || '';
    if (name.toLowerCase() === 'descr_model_battle.txt') {
      const shared = localStorage.getItem('m2tw_modeldb_file');
      if (shared) return shared;
    }
  } catch {}
  try {
    const record = await loadLargeText('m2tw_descr_model_battle_file');
    if (record?.text) return record.text;
  } catch {}
  return '';
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
    engine: inferSiegeEngine(unit) || '',
    ownership: (unit.ownership || []).join(', '),
    missing,
  };
}

function stripPlaceholderOwnership(unit) {
  const ownership = (unit.ownership || []).filter(f => String(f || '').toLowerCase() !== 'new_faction');
  if (ownership.length === (unit.ownership || []).length) return { unit, removed: false };
  return { unit: { ...unit, ownership }, removed: true };
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
      const raw = getEduRawText();
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
    const targetByType = new Map(targetUnits.map(u => [String(u.type || '').toLowerCase(), u]));
    const imported = [];
    const skipped = [];
    const preservedAnimal = [];
    const preservedEngine = [];
    const inferredEngine = [];
    const strippedNewFaction = [];
    const missingLines = [];

    for (const unit of chosen) {
      if (!replaceExisting && existing.has(unit.type.toLowerCase())) {
        skipped.push(`${unit.type} already exists`);
        continue;
      }
      let copy = JSON.parse(JSON.stringify(unit));
      const targetMatch = targetByType.get(String(unit.type || '').toLowerCase());
      if (!copy.animal && targetMatch?.animal) {
        copy.animal = targetMatch.animal;
        preservedAnimal.push(`${copy.type}: ${copy.animal}`);
      }
      if (!copy.engine && targetMatch?.engine) {
        copy.engine = targetMatch.engine;
        preservedEngine.push(`${copy.type}: ${copy.engine}`);
      }
      if (!copy.engine) {
        const engine = inferSiegeEngine(copy);
        if (engine) {
          copy.engine = engine;
          inferredEngine.push(`${copy.type}: ${copy.engine}`);
        }
      }
      const stripped = stripPlaceholderOwnership(copy);
      copy = stripped.unit;
      if (stripped.removed) strippedNewFaction.push(copy.type);
      imported.push(copy);
      const dep = parseDependencyReport(unit, sourceModels);
      if (dep.missing.length) missingLines.push(`${unit.type}: ${dep.missing.join(', ')}`);
      const key = unit.dictionary || unit.type;
      for (const suffix of ['', '_descr', '_descr_short']) {
        const locKey = `${key}${suffix}`;
        if (sourceLoc[locKey] !== undefined) targetLoc[locKey] = sourceLoc[locKey];
      }
    }

    const retainedRaw = replaceExisting
      ? targetUnits.filter(u => !selected.has(u.type))
      : targetUnits;
    const retained = retainedRaw.map(unit => {
      const stripped = stripPlaceholderOwnership(unit);
      if (stripped.removed) strippedNewFaction.push(unit.type);
      return stripped.unit;
    });
    const merged = [...retained, ...imported];
    const report = [
      `Imported units: ${imported.length}`,
      `Skipped units: ${skipped.length}`,
      '',
      imported.map(u => `+ ${u.type}`).join('\n'),
      preservedAnimal.length ? `\nAnimal lines preserved from target:\n${preservedAnimal.map(s => `- ${s}`).join('\n')}` : '',
      preservedEngine.length ? `\nEngine lines preserved from target:\n${preservedEngine.map(s => `- ${s}`).join('\n')}` : '',
      inferredEngine.length ? `\nEngine lines inferred for siege units:\n${inferredEngine.map(s => `- ${s}`).join('\n')}` : '',
      strippedNewFaction.length ? `\nRemoved placeholder ownership new_faction:\n${strippedNewFaction.map(s => `- ${s}`).join('\n')}` : '',
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

function DmbSlaveTextureTab() {
  const [dmbText, setDmbText] = useState('');
  const [eduText, setEduText] = useState('');
  const [targets, setTargets] = useState('cisra_01, itanos_01, massilia_01, thamud_01, kos_01');
  const [patchedText, setPatchedText] = useState('');
  const [log, setLog] = useState('');
  const [message, setMessage] = useState('');

  const useLoadedFiles = async () => {
    const loadedEdu = getEduRawText();
    const loadedDmb = await getLoadedDmbText();
    setEduText(loadedEdu);
    setDmbText(loadedDmb);
    setMessage(`${loadedDmb ? 'Loaded DMB' : 'No loaded DMB found'}; ${loadedEdu ? 'loaded EDU' : 'no loaded EDU found'}.`);
  };

  const runPatch = () => {
    if (!dmbText.trim() || !eduText.trim() || !targets.trim()) {
      setMessage('Load descr_model_battle.txt, export_descr_unit.txt, and at least one target faction.');
      return;
    }
    const result = patchDmbSlaveTextures(dmbText, eduText, targets);
    setPatchedText(result.text);
    setLog(result.log);
    setMessage(`Patched ${result.changes.length} DMB blocks. Missing type refs: ${result.missingTypes.length}.`);
    try { localStorage.setItem('rtw_tools_last_output', result.log); } catch {}
  };

  const downloadPatch = async () => {
    if (!patchedText) return;
    const zip = new JSZip();
    zip.file('descr_model_battle.txt', toCRLF(patchedText));
    zip.file('descr_model_battle_slave_texture_patch.log.txt', toCRLF(log));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'dmb_slave_texture_patch.zip');
  };

  const applyPatch = () => {
    if (!patchedText) return;
    try {
      localStorage.setItem('m2tw_descr_model_battle_file', patchedText);
      localStorage.setItem('m2tw_descr_model_battle_name', 'descr_model_battle.txt');
      localStorage.setItem('m2tw_modeldb_file_name', 'descr_model_battle.txt');
    } catch {}
    saveLargeText('m2tw_descr_model_battle_file', patchedText, { filename: 'descr_model_battle.txt' }).catch(() => {});
    window.dispatchEvent(new CustomEvent('modeldb-file-loaded', {
      detail: { text: patchedText, filename: 'descr_model_battle.txt' },
    }));
    setMessage('Applied patched DMB to the loaded Battle Models data.');
  };

  return (
    <div className="grid grid-cols-[340px_1fr_320px] gap-3 min-h-0">
      <div className="space-y-3">
        <FileInput label="descr_model_battle.txt" accept=".txt" onText={setDmbText} />
        <FileInput label="export_descr_unit.txt" accept=".txt" onText={setEduText} />
        <TextField label="Target factions" value={targets} onChange={setTargets} />
        <Button variant="outline" className="w-full h-8 text-xs" onClick={useLoadedFiles}>Use loaded files</Button>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={runPatch}>
          <Wand2 className="w-3.5 h-3.5" />
          Patch from slave textures
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" disabled={!patchedText} onClick={applyPatch}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Apply to loaded DMB
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" disabled={!patchedText} onClick={downloadPatch}>
          <Download className="w-3.5 h-3.5" />
          Download patched zip
        </Button>
        <p className="text-xs text-amber-300">{message}</p>
        <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-400">
          Copies each matching DMB block's <span className="font-mono text-slate-200">texture slave, ...</span> path
          to missing target factions used by EDU soldier, officer, and mount refs.
        </div>
      </div>

      <textarea
        value={patchedText || dmbText}
        onChange={e => setPatchedText(e.target.value)}
        className="min-h-[560px] rounded border border-slate-700 bg-black/30 p-3 text-[11px] font-mono text-slate-200"
        placeholder="Patched descr_model_battle.txt appears here."
      />

      <pre className="min-h-[560px] overflow-auto rounded border border-slate-700 bg-black/30 p-3 text-[10px] text-slate-300 whitespace-pre-wrap">
        {log || 'Patch log appears here.'}
      </pre>
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
  if (full) return `#${full[1]}${full[2]}${full[3]}`.toLowerCase();
  let rgb = raw.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])).toLowerCase();
  const hsl = raw.match(/^hsl\(\s*([-\d.]+)\s*,?\s*([\d.]+)%?\s*,?\s*([\d.]+)%?\s*\)$/i)
    || raw.match(/^([-\d.]+)\s+([\d.]+)%?\s+([\d.]+)%?$/i);
  if (hsl) {
    const converted = hslToRgb(Number(hsl[1]), Math.max(0, Math.min(100, Number(hsl[2]) || 0)) / 100, Math.max(0, Math.min(100, Number(hsl[3]) || 0)) / 100);
    return rgbToHex(converted.r, converted.g, converted.b).toLowerCase();
  }
  return null;
}

function hexToRgb(hex) {
  const normalized = normalizeColorInput(hex) || '#a01e1e';
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 160, g: 30, b: 30 };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function hexToHslText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s * 100)}%, ${Math.round(hsl.l * 100)}%)`;
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

function colorDistanceRgb(r, g, b, target) {
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function weightedColorDistance(r, g, b, target) {
  const dr = (r - target.r) * 0.30;
  const dg = (g - target.g) * 0.59;
  const db = (b - target.b) * 0.11;
  const chromaR = (r - target.r) * 0.55;
  const chromaG = (g - target.g) * 0.42;
  const chromaB = (b - target.b) * 0.36;
  return Math.sqrt(dr * dr + dg * dg + db * db + chromaR * chromaR + chromaG * chromaG + chromaB * chromaB);
}

function materialProtectionType(r, g, b, hsl, protectMaterials) {
  if (!protectMaterials) return false;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const saturatedRedCloth = (hsl.h >= 345 || hsl.h <= 18) && hsl.s >= 0.46 && hsl.l >= 0.10 && hsl.l <= 0.66 &&
    r > g * 1.18 && r > b * 1.18;
  const saturatedDyedCloth = hsl.s >= 0.48 && hsl.l >= 0.11 && hsl.l <= 0.72 && spread >= 44;
  const skinLike = !saturatedRedCloth && hsl.h >= 4 && hsl.h <= 52 && hsl.s >= 0.12 && hsl.s <= 0.78 &&
    hsl.l >= 0.20 && hsl.l <= 0.86 && r >= g * 0.78 && r > b * 1.12 && g > b * 0.70;
  const paleSkinLike = !saturatedDyedCloth && hsl.h >= 8 && hsl.h <= 48 && hsl.s >= 0.08 && hsl.s <= 0.42 &&
    hsl.l >= 0.58 && hsl.l <= 0.91 && r >= g * 0.92 && g >= b * 0.80 && r > b * 1.08;
  const darkHairLeather = hsl.h >= 10 && hsl.h <= 48 && hsl.s >= 0.10 &&
    hsl.l >= 0.035 && hsl.l <= 0.50 && r >= g * 0.68 && g >= b * 0.45;
  const steelOrIron = (hsl.s <= 0.18 || spread <= 34) && hsl.l >= 0.10 && hsl.l <= 0.92;
  const blackenedMetal = (hsl.s <= 0.26 || spread <= 42) && hsl.l >= 0.025 && hsl.l <= 0.28;
  const whiteArmorOrLinen = hsl.l >= 0.56 && hsl.s <= 0.38 && spread <= 82 &&
    r >= 126 && g >= 122 && b >= 112;
  const ivoryHighlight = hsl.l >= 0.72 && hsl.s <= 0.46 && spread <= 86 &&
    r >= 165 && g >= 150 && b >= 125;
  const bronzeOrGold = hsl.h >= 30 && hsl.h <= 62 && hsl.s >= 0.18 && hsl.s <= 0.82 &&
    hsl.l >= 0.18 && hsl.l <= 0.80 && r > b * 1.24 && g > b * 0.94;
  if (skinLike || paleSkinLike) return 'skin';
  if (whiteArmorOrLinen || ivoryHighlight) return 'white_armor';
  if (blackenedMetal) return 'dark_metal';
  if (steelOrIron) return 'metal';
  if (darkHairLeather) return 'leather';
  if (bronzeOrGold) return 'bronze';
  return false;
}

function colorMatchScore(r, g, b, hsl, pass, tolerance, rgbTolerance) {
  const hueMask = Math.max(0, 1 - hueDistance(hsl.h, pass.src.h) / tolerance);
  const rgbMask = Math.max(0, 1 - weightedColorDistance(r, g, b, pass.srcRgb) / rgbTolerance);
  if (hueMask <= 0 && rgbMask < 0.46) return 0;
  const satMask = Math.max(0, 1 - Math.abs(hsl.s - pass.src.s) / 0.58);
  const lightMask = Math.max(0, 1 - Math.abs(hsl.l - pass.src.l) / 0.62);
  return clamp01((hueMask * 0.58) + (rgbMask * 0.30) + (satMask * 0.08) + (lightMask * 0.04));
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

function buildRecolorPlan(settings) {
  const targetMix = Number.isFinite(Number(settings.targetMix))
    ? Number(settings.targetMix) / 100
    : (settings.exactTarget ? 0.88 : 0.42);
  return {
    isRecolorPlan: true,
    passes: recolorPasses(settings),
    tolerance: Math.max(1, Number(settings.tolerance) || 1),
    rgbTolerance: Math.max(1, Number(settings.rgbTolerance) || 1),
    strength: Math.max(0, Number(settings.strength) || 0) / 100,
    minSat: Math.max(0, Number(settings.minSat) || 0) / 100,
    lightnessShift: Number(settings.lightnessShift || 0) / 100,
    targetMix: clamp01(targetMix),
    lightnessMix: clamp01(Number(settings.lightnessMix ?? (settings.preserveLight ? 0 : 36)) / 100),
    saturationBoost: Math.max(-100, Math.min(100, Number(settings.saturationBoost || 0))) / 100,
    desaturate: clamp01(Number(settings.desaturate || 0) / 100),
    contrast: Math.max(0.25, Math.min(2.5, Number(settings.contrast ?? 100) / 100)),
    useSource: !!settings.useSource,
    preserveLight: !!settings.preserveLight,
    recolorNeutrals: !!settings.recolorNeutrals,
    protectExtremes: !!settings.protectExtremes,
    protectMaterials: !!settings.protectMaterials,
  };
}

function recolorImageData(imageData, settingsOrPlan) {
  const plan = settingsOrPlan?.isRecolorPlan ? settingsOrPlan : buildRecolorPlan(settingsOrPlan);
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const d = out.data;
  const {
    passes, tolerance, rgbTolerance, strength, minSat, lightnessShift, targetMix,
    lightnessMix, saturationBoost, desaturate, contrast,
    useSource, preserveLight, recolorNeutrals, protectExtremes, protectMaterials,
  } = plan;
  if (!passes.length || strength <= 0) return out;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 8) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const hsl = rgbToHsl(r, g, b);
    if (!recolorNeutrals && hsl.s < minSat) continue;

    let best = passes[0];
    let bestScore = useSource ? 0 : 1;
    for (const pass of passes) {
      if (!useSource) break;
      const score = colorMatchScore(r, g, b, hsl, pass, tolerance, rgbTolerance);
      if (score > bestScore) {
        best = pass;
        bestScore = score;
      }
    }

    const protectedType = materialProtectionType(r, g, b, hsl, protectMaterials);
    if (['skin', 'metal', 'dark_metal', 'white_armor', 'leather'].includes(protectedType)) continue;
    if (protectedType && bestScore < 0.74) continue;
    if (useSource && bestScore < 0.12) continue;
    const satMask = hsl.s >= minSat ? 1 : 0.38;
    const detailMask = protectExtremes && (hsl.l < 0.055 || hsl.l > 0.955) ? 0.18 : 1;
    const materialMask = protectedType === 'bronze' ? 0.46 : protectedType ? 0.32 : 1;
    const mask = clamp01(smoothMask(bestScore * satMask * detailMask * materialMask) * strength);
    if (mask <= 0) continue;
    const mixedSat = hsl.s * (1 - targetMix) + best.tgt.s * targetMix;
    const boostedSat = mixedSat + (saturationBoost >= 0 ? (1 - mixedSat) * saturationBoost : mixedSat * saturationBoost);
    const targetSat = clamp01(boostedSat * (1 - desaturate));
    const baseLight = preserveLight && lightnessMix <= 0
      ? hsl.l
      : clamp01(hsl.l * (1 - lightnessMix) + best.tgt.l * lightnessMix);
    const contrastLight = clamp01((baseLight - 0.5) * contrast + 0.5);
    const targetLight = clamp01(contrastLight + lightnessShift);
    const recolored = hslToRgb(best.tgt.h, targetSat, targetLight);
    d[i] = Math.round(r * (1 - mask) + recolored.r * mask);
    d[i + 1] = Math.round(g * (1 - mask) + recolored.g * mask);
    d[i + 2] = Math.round(b * (1 - mask) + recolored.b * mask);
  }
  return out;
}

function decodeTga(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) throw new Error('Invalid TGA');
  const idLength = data[0], colorMapType = data[1], imageType = data[2];
  const colorMapFirst = data[3] | (data[4] << 8);
  const colorMapLength = data[5] | (data[6] << 8);
  const colorMapDepth = data[7];
  const width = data[12] | (data[13] << 8), height = data[14] | (data[15] << 8);
  const bpp = data[16], desc = data[17], topOrigin = !!(desc & 0x20), rightOrigin = !!(desc & 0x10);
  const isMapped = imageType === 1 || imageType === 9;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGray = imageType === 3 || imageType === 11;
  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  if (!isMapped && !isTrueColor && !isGray) throw new Error('Unsupported TGA image type');
  if (isMapped && colorMapType !== 1) throw new Error('Invalid indexed TGA color map');
  if (!isMapped && colorMapType !== 0) throw new Error('Unsupported TGA color map');
  if (isTrueColor && ![15, 16, 24, 32].includes(bpp)) throw new Error('Unsupported true-color TGA bit depth');
  if (isGray && ![8, 16].includes(bpp)) throw new Error('Unsupported grayscale TGA bit depth');
  if (isMapped && ![8, 15, 16].includes(bpp)) throw new Error('Unsupported indexed TGA bit depth');

  let src = 18 + idLength;
  const readColor = (bits) => {
    if (bits === 32) {
      const b = data[src++], g = data[src++], r = data[src++], a = data[src++];
      return [r, g, b, a];
    }
    if (bits === 24) {
      const b = data[src++], g = data[src++], r = data[src++];
      return [r, g, b, 255];
    }
    if (bits === 15 || bits === 16) {
      const v = data[src++] | (data[src++] << 8);
      const b = Math.round((v & 0x1f) * 255 / 31);
      const g = Math.round(((v >> 5) & 0x1f) * 255 / 31);
      const r = Math.round(((v >> 10) & 0x1f) * 255 / 31);
      return [r, g, b, 255];
    }
    const g = data[src++];
    return [g, g, g, 255];
  };

  let colorMap = null;
  if (isMapped) {
    colorMap = new Map();
    for (let i = 0; i < colorMapLength; i++) {
      colorMap.set(colorMapFirst + i, readColor(colorMapDepth));
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  let dst = 0, pixel = 0;
  const readIndex = () => bpp === 8 ? data[src++] : data[src++] | (data[src++] << 8);
  const readPixel = () => {
    if (isMapped) return colorMap.get(readIndex()) || [0, 0, 0, 0];
    if (isGray) {
      const g = data[src++];
      const a = bpp === 16 ? data[src++] : 255;
      return [g, g, g, a];
    }
    return readColor(bpp);
  };
  if (!isRle) {
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
  if (rightOrigin) flipColumns(pixels, width, height);
  return new ImageData(pixels, width, height);
}

function flipColumns(pixels, width, height) {
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const start = y * row;
    for (let x = 0; x < Math.floor(width / 2); x++) {
      const left = start + x * 4;
      const right = start + (width - 1 - x) * 4;
      for (let i = 0; i < 4; i++) {
        const tmp = pixels[left + i]; pixels[left + i] = pixels[right + i]; pixels[right + i] = tmp;
      }
    }
  }
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return imageData;
}

function imageDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function previewImageData(imageData, maxEdge = 720) {
  const edge = Math.max(imageData.width, imageData.height);
  if (edge <= maxEdge) return imageData;
  const scale = maxEdge / edge;
  const src = imageDataToCanvas(imageData);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(imageData.width * scale));
  canvas.height = Math.max(1, Math.round(imageData.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function decodeBrowserImageBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return imageData;
}

async function readClipboardImageData() {
  if (!navigator.clipboard?.read) throw new Error('Clipboard image reads are not available. Use the screenshot upload button instead.');
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find(type => type.startsWith('image/'));
    if (!imageType) continue;
    return decodeBrowserImageBlob(await item.getType(imageType));
  }
  throw new Error('No image found on the clipboard. Press Print Screen, then try Paste screenshot.');
}

function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

function imageDataToPngBlob(imageData) {
  return new Promise(resolve => imageDataToCanvas(imageData).toBlob(blob => resolve(blob), 'image/png'));
}

function alphaBoundsFromImageData(imageData) {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function resizeIconImageData(imageData, size, mode) {
  const src = imageDataToCanvas(imageData);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let sx = 0, sy = 0, sw = imageData.width, sh = imageData.height;
  if (mode === 'trim-fit') {
    const bounds = alphaBoundsFromImageData(imageData);
    if (bounds) ({ x: sx, y: sy, w: sw, h: sh } = bounds);
  }

  let dx = 0, dy = 0, dw = size, dh = size;
  if (mode !== 'stretch') {
    const padding = mode === 'trim-fit' ? Math.max(1, Math.round(size * 0.03)) : 0;
    const inner = Math.max(1, size - padding * 2);
    const scale = Math.min(inner / sw, inner / sh);
    dw = sw * scale;
    dh = sh * scale;
    dx = padding + (inner - dw) / 2;
    dy = padding + (inner - dh) / 2;
  }

  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, size, size);
}

function factionColorToCss(color, fallback = '#3f6a9f') {
  if (!color) return fallback;
  return rgbToHex(color.r ?? 0, color.g ?? 0, color.b ?? 0);
}

function drawAutoFactionIconImageData(faction, size, variant = 'standard') {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  const primary = factionColorToCss(faction.primary_colour, '#476d9e');
  const secondary = factionColorToCss(faction.secondary_colour, '#e8dfc3');
  const name = String(faction.name || 'faction');
  const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.43;

  const bg = ctx.createRadialGradient(cx - size * 0.16, cy - size * 0.18, size * 0.06, cx, cy, radius);
  bg.addColorStop(0, variant === 'grey' ? '#d8d8d8' : '#ffffff');
  bg.addColorStop(0.18, variant === 'grey' ? '#a8a8a8' : secondary);
  bg.addColorStop(1, variant === 'grey' ? '#505050' : primary);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.strokeStyle = variant === 'select' ? '#fff4a8' : variant === 'roll' ? '#f4d47a' : '#111111';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius - ctx.lineWidth * 2.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = variant === 'grey' ? '#f2f2f2' : secondary;
  ctx.fillStyle = variant === 'grey' ? '#f2f2f2' : secondary;
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const motif = hash % 5;
  if (motif === 0) {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.26);
    ctx.lineTo(0, size * 0.22);
    ctx.moveTo(-size * 0.17, -size * 0.04);
    ctx.lineTo(size * 0.17, -size * 0.04);
    ctx.moveTo(-size * 0.10, size * 0.18);
    ctx.lineTo(size * 0.10, size * 0.18);
    ctx.stroke();
  } else if (motif === 1) {
    ctx.beginPath();
    ctx.arc(-size * 0.04, 0, size * 0.20, Math.PI * 0.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.08, 0, size * 0.16, Math.PI * 0.18, Math.PI * 1.82);
    ctx.strokeStyle = primary;
    ctx.stroke();
  } else if (motif === 2) {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.25);
    ctx.lineTo(size * 0.22, size * 0.18);
    ctx.lineTo(-size * 0.22, size * 0.18);
    ctx.closePath();
    ctx.stroke();
  } else if (motif === 3) {
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.26);
      ctx.quadraticCurveTo(size * 0.09, -size * 0.09, 0, 0);
      ctx.stroke();
    }
  } else {
    ctx.font = `700 ${Math.round(size * 0.34)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = name.split('_').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'F';
    ctx.fillText(initials, 0, size * 0.02);
  }
  ctx.restore();

  if (variant === 'grey') {
    const data = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < data.data.length; i += 4) {
      const avg = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = avg;
    }
    ctx.putImageData(data, 0, 0);
  }
  return ctx.getImageData(0, 0, size, size);
}

function factionNameFromIconFile(file) {
  const stem = String(file?.name || 'faction')
    .replace(/\.(tga|png)$/i, '')
    .toLowerCase()
    .replace(/^(?:symbol(?:24|48|128)_|faction_logo_|small_faction_logo_|loading_logo_|logo_)/i, '');
  return stem.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'faction';
}

function buildSpriteXml(sheetName, icons, size, columns) {
  const lines = [`<sprite_definitions version='7'>`, `  <page file='${sheetName}'>`];
  icons.forEach((icon, j) => {
    const col = j % columns;
    const row = Math.floor(j / columns);
    lines.push(`    <sprite name='${icon.spriteName}' x='${col * size}' y='${row * size}' w='${size}' h='${size}' alpha='1'/>`);
  });
  lines.push('  </page>', '</sprite_definitions>');
  return lines.join('\n');
}

function updateFactionLogoIndexes(text, mapping) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let patched = 0;
  for (let i = 0; i < lines.length; i++) {
    const factionMatch = /^(\s*faction\s+)(\S+)/i.exec(lines[i]);
    if (!factionMatch) continue;
    const factionName = factionMatch[2].trim().toLowerCase();
    const spriteName = mapping[factionName];
    if (!spriteName) continue;
    let blockEnd = lines.length;
    for (let k = i + 1; k < lines.length; k++) {
      if (/^\s*faction\s+\S+/i.test(lines[k])) {
        blockEnd = k;
        break;
      }
    }
    const logoIndex = lines.slice(i + 1, blockEnd).findIndex(line => /^\s*logo_index\b/i.test(line));
    if (logoIndex >= 0) {
      const lineIndex = i + 1 + logoIndex;
      const indent = /^(\s*)/.exec(lines[lineIndex])?.[1] || '';
      lines[lineIndex] = `${indent}logo_index\t\t\t\t${spriteName}`;
      patched++;
    } else {
      const insertAfter = lines.slice(i + 1, blockEnd).findIndex(line => /^\s*loading_logo\b/i.test(line));
      const lineIndex = insertAfter >= 0 ? i + 2 + insertAfter : i + 1;
      lines.splice(lineIndex, 0, `logo_index\t\t\t\t${spriteName}`);
      patched++;
      i++;
    }
  }
  return { text: toCRLF(lines.join('\n')), patched };
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
      if (current % 8 === 7) await yieldToBrowser();
    }
  });
  await Promise.all(workers);
  return results;
}

function textureWorkerLimit(count) {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.min(count, Math.max(2, Math.min(4, Math.floor(cores / 2) || 2)));
}

const BEST_RECOLOR_SETTINGS = {
  source: '#9e1a1a',
  target: '#2f6fc0',
  tolerance: 18,
  rgbTolerance: 145,
  strength: 86,
  minSat: 26,
  targetMix: 84,
  saturationBoost: 0,
  desaturate: 0,
  lightnessMix: 0,
  contrast: 100,
  secondarySource: '#d7c04a',
  secondaryTarget: '#e4e4e4',
  tertiarySource: '#2d6d37',
  tertiaryTarget: '#8c2f2f',
  lightnessShift: 0,
  suffix: '_recolor',
  outputFormat: 'both',
  useSource: true,
  preserveLight: true,
  recolorNeutrals: false,
  protectExtremes: true,
  protectMaterials: true,
  exactTarget: true,
  secondaryEnabled: false,
  tertiaryEnabled: false,
};

const AI_RECOLOR_TARGETS = [
  ['source', 'Source'],
  ['target', 'Target'],
  ['secondarySource', '2nd source'],
  ['secondaryTarget', '2nd target'],
  ['tertiarySource', '3rd source'],
  ['tertiaryTarget', '3rd target'],
];

const AI_IMAGE_STYLE_PRESETS = {
  unit: [
    'RTW unit texture repaint',
    'historical bronze age realism',
    'Hellenistic linen and bronze',
    'desert frontier militia',
    'elite royal guard',
    'weathered campaign veteran',
  ],
  symbol: [
    'RTW faction medallion',
    'clean heraldic emblem',
    'engraved bronze icon',
    'painted shield symbol',
    'stone seal relief',
    'high-contrast UI icon',
  ],
  eventpic: [
    'RTW event picture',
    'painted historical event panel',
    'campaign parchment illustration',
    'ancient battlefield vignette',
    'temple court scene',
    'city conquest report art',
  ],
  art: [
    'historical concept art',
    'RTW loading-screen art',
    'campaign UI illustration',
    'artifact reference sheet',
    'faction mood painting',
    'unit equipment callout sheet',
  ],
};

const AI_IDEA_PARTS = {
  unitRoles: ['royal spearmen', 'desert archers', 'camel scouts', 'harbor militia', 'sacred guard', 'citizen cavalry', 'hill skirmishers', 'temple bodyguards'],
  eventScenes: ['ambush in a dry wadi', 'king receiving tribute at a stone shrine', 'harbor revolt at dusk', 'caravan attacked near a watchtower', 'oasis treaty ceremony', 'siege engineers testing a ballista'],
  symbolMotifs: ['crescent and star', 'palm and spear', 'bull horn crown', 'ship prow', 'lion over waves', 'sun disk', 'sacred mountain', 'bronze horse head'],
  materials: ['bronze, linen, dyed wool', 'painted leather and dark iron', 'ivory cloth with bronze trim', 'red wool and polished bronze', 'sea-blue enamel and silver', 'black leather with gold paint'],
  moods: ['disciplined and ancient', 'weathered but elite', 'sacred and royal', 'frontier-born and practical', 'maritime and wealthy', 'nomadic and fast-moving'],
};

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildBingStylePrompt(form, referenceName = 'uploaded reference') {
  const isSymbol = form.mode === 'symbol';
  const isEventPic = form.mode === 'eventpic';
  const isArt = form.mode === 'art';
  const faction = form.faction || 'new faction';
  const culture = form.culture || 'ancient Mediterranean';
  const colors = form.colors || 'historically plausible faction colors';
  const subject = isSymbol ? (form.subject || 'faction symbol') : isEventPic ? (form.subject || 'campaign event picture') : isArt ? (form.subject || 'historical concept art') : (form.subject || 'unit texture');
  const style = form.style || (AI_IMAGE_STYLE_PRESETS[form.mode]?.[0] || 'RTW asset art');
  const details = form.details || 'high quality, game-ready, historically plausible';
  const assetLine = isSymbol
    ? `Create a faction symbol/icon for ${faction}, ${culture}. Subject: ${subject}.`
    : isEventPic
      ? `Create an RTW event picture for ${faction}, ${culture}. Scene: ${subject}.`
      : isArt
        ? `Create supporting mod art for ${faction}, ${culture}. Subject: ${subject}.`
        : `Create a unit image/texture for ${faction}, ${culture}. Unit: ${subject}.`;
  const preserveLine = isSymbol
    ? 'Preserve the uploaded icon composition, transparent background, centered silhouette, circular symbol framing if present, exact readable shape, and strong contrast at 256, 128, 48, and 24 pixel sizes.'
    : isEventPic
      ? 'Preserve the uploaded event picture aspect ratio, readable silhouettes, RTW-era painterly contrast, and any UI-safe empty margins. No text inside the image.'
      : isArt
        ? 'If a reference is uploaded, preserve the important silhouette, framing, subject placement, and material identity while improving polish and readability.'
        : 'Preserve the uploaded UV layout, canvas size, alpha, seams, body part placement, folds, baked shadows, silhouettes, and every small texture island. Keep the exact same pose/card framing if the reference is a unit card.';

  return [
    `Image-to-image edit using "${referenceName}" as the strict reference.`,
    assetLine,
    `Style: ${style}. Palette/materials: ${colors}. Details: ${details}.`,
    preserveLine,
    'Do not crop, rotate, change UV island positions, add text, invent unrelated objects, alter skin, faces, hair, leather, fur, wood, bronze, steel, gold, iron, blackened metal, white/linen armor, transparent pixels, or baked shadows unless specifically requested.',
    form.negative ? `Avoid: ${form.negative}.` : 'Avoid modern fantasy, glowing effects, blurry edges, new backgrounds, and layout drift.',
    'Output should look like the same game asset after a careful AI-assisted art pass, not a new unrelated illustration.'
  ].join('\n');
}

function parseRtwPromptColorPairs(text) {
  const matches = [...String(text || '').matchAll(/(primary_colour|secondary_colour)\s+red\s+(\d+)\s*,\s*green\s+(\d+)\s*,\s*blue\s+(\d+)/gi)]
    .map(match => ({
      key: match[1].toLowerCase(),
      rgb: {
        r: Math.max(0, Math.min(255, Number(match[2]) || 0)),
        g: Math.max(0, Math.min(255, Number(match[3]) || 0)),
        b: Math.max(0, Math.min(255, Number(match[4]) || 0)),
      },
    }));
  const byKey = { primary_colour: [], secondary_colour: [] };
  for (const match of matches) byKey[match.key]?.push(match.rgb);
  return {
    primarySource: byKey.primary_colour[0] || null,
    primaryTarget: byKey.primary_colour[1] || null,
    secondarySource: byKey.secondary_colour[0] || null,
    secondaryTarget: byKey.secondary_colour[1] || null,
  };
}

function buildAtlasPromptSettings(text) {
  const parsed = parseRtwPromptColorPairs(text);
  const primarySource = parsed.primarySource || { r: 255, g: 255, b: 140 };
  const primaryTarget = parsed.primaryTarget || { r: 91, g: 190, b: 183 };
  const secondarySource = parsed.secondarySource || { r: 0, g: 0, b: 0 };
  const secondaryTarget = parsed.secondaryTarget || { r: 192, g: 178, b: 109 };
  return {
    ...BEST_RECOLOR_SETTINGS,
    source: rgbToHex(primarySource.r, primarySource.g, primarySource.b),
    target: rgbToHex(primaryTarget.r, primaryTarget.g, primaryTarget.b),
    secondaryEnabled: !!(parsed.secondarySource && parsed.secondaryTarget),
    secondarySource: rgbToHex(secondarySource.r, secondarySource.g, secondarySource.b),
    secondaryTarget: rgbToHex(secondaryTarget.r, secondaryTarget.g, secondaryTarget.b),
    tolerance: 16,
    rgbTolerance: 96,
    strength: 100,
    targetMix: 82,
    minSat: parsed.secondarySource ? 0 : 12,
    recolorNeutrals: !!parsed.secondarySource,
    preserveLight: true,
    lightnessMix: 0,
    saturationBoost: 0,
    desaturate: 0,
    contrast: 100,
    protectExtremes: true,
    protectMaterials: true,
    useSource: true,
    exactTarget: true,
  };
}

function generateAiImageIdeas({ mode, faction, culture, colors }) {
  const ideas = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const material = colors || randomPick(AI_IDEA_PARTS.materials);
    const mood = randomPick(AI_IDEA_PARTS.moods);
    if (mode === 'symbol') {
      const motif = randomPick(AI_IDEA_PARTS.symbolMotifs);
      ideas.push(`${faction || 'Faction'} symbol: ${motif}, ${culture || 'ancient mixed culture'}, ${material}, ${mood}, readable at tiny UI sizes`);
    } else if (mode === 'eventpic') {
      const scene = randomPick(AI_IDEA_PARTS.eventScenes);
      ideas.push(`${faction || 'Faction'} event picture: ${scene}, ${culture || 'ancient mixed culture'}, ${material}, ${mood}, RTW campaign event art`);
    } else if (mode === 'art') {
      const role = randomPick(AI_IDEA_PARTS.unitRoles);
      ideas.push(`${faction || 'Faction'} concept art: ${role}, ${culture || 'ancient mixed culture'}, ${material}, ${mood}, useful as event/loading/art reference`);
    } else {
      const role = randomPick(AI_IDEA_PARTS.unitRoles);
      ideas.push(`${faction || 'Faction'} ${role}: ${culture || 'ancient mixed culture'}, ${material}, ${mood}, preserve RTW UV/card layout`);
    }
  }
  return ideas;
}

function detectFactionColorCandidates(imageData, maxCandidates = 5) {
  if (!imageData?.data) return [];
  const { data, width, height } = imageData;
  const buckets = new Map();
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 160000));

  for (let pixel = 0; pixel < total; pixel += step) {
    const i = pixel * 4;
    const a = data[i + 3];
    if (a < 16) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const hsl = rgbToHsl(r, g, b);
    if (hsl.s < 0.22 || hsl.l < 0.06 || hsl.l > 0.88) continue;
    if (materialProtectionType(r, g, b, hsl, true)) continue;
    const key = `${Math.round(hsl.h / 8)}:${Math.round(hsl.s * 12)}:${Math.round(hsl.l * 10)}`;
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, sat: 0, light: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.sat += hsl.s;
    bucket.light += hsl.l;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const ranked = Array.from(buckets.values())
    .filter(bucket => bucket.count >= 8)
    .map(bucket => {
      const r = bucket.r / bucket.count;
      const g = bucket.g / bucket.count;
      const b = bucket.b / bucket.count;
      const sat = bucket.sat / bucket.count;
      const light = bucket.light / bucket.count;
      const hsl = rgbToHsl(r, g, b);
      return {
        hex: rgbToHex(r, g, b),
        rgb: { r, g, b },
        hsl,
        count: bucket.count,
        score: bucket.count * (0.55 + sat) * (1 - Math.abs(light - 0.50) * 0.58),
      };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const candidate of ranked) {
    const duplicate = picked.some(existing =>
      hueDistance(candidate.hsl.h, existing.hsl.h) < 12 ||
      colorDistanceRgb(candidate.rgb.r, candidate.rgb.g, candidate.rgb.b, existing.rgb) < 32
    );
    if (!duplicate) picked.push(candidate);
    if (picked.length >= maxCandidates) break;
  }
  return picked.map(({ rgb, hsl, ...candidate }) => candidate);
}

function buildUvLockedPrompt(settings, brief, textureName = 'RTW texture') {
  const source = settings.source?.toUpperCase?.() || '#9E1A1A';
  const target = settings.target?.toUpperCase?.() || '#2F6FC0';
  const extra = String(brief || '').trim();
  return [
    `Image-to-image edit for "${textureName}".`,
    'Use the uploaded image as the exact UV texture reference. Preserve the same canvas size, UV islands, seams, silhouettes, alpha/transparency, borders, icons, folds, scratches, dirt, baked shadows, and small painted details.',
    `Recolor only the faction-colored cloth, shields, banners, painted trim, and tunic areas from ${source} toward ${target}.`,
    settings.secondaryEnabled ? `Also map secondary faction color ${settings.secondarySource?.toUpperCase?.()} toward ${settings.secondaryTarget?.toUpperCase?.()}.` : '',
    settings.tertiaryEnabled ? `Also map tertiary faction color ${settings.tertiarySource?.toUpperCase?.()} toward ${settings.tertiaryTarget?.toUpperCase?.()}.` : '',
    'Do not alter skin, faces, hair, leather, fur, wood, bronze, steel, gold, iron, blackened metal, white/linen armor, weapons, transparent pixels, UV placement, baked shadows, or the texture layout. Avoid adding new objects or changing the design.',
    extra ? `Style/detail request: ${extra}` : 'Style/detail request: keep it historically plausible and game-ready for Rome Total War.',
    'Output should look like the same texture file after a careful faction recolor, not a new illustration.'
  ].filter(Boolean).join('\n');
}

function TextureRecolorTab() {
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState(BEST_RECOLOR_SETTINGS);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('');
  const [sampler, setSampler] = useState(null);
  const [samplerTarget, setSamplerTarget] = useState('source');
  const [aiBrief, setAiBrief] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const previewCacheRef = useRef({ file: null, imageData: null, dataUrl: '' });
  const previewRunRef = useRef(0);

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const getPreviewOriginal = async (file) => {
    const cached = previewCacheRef.current;
    if (cached.file === file && cached.imageData) return cached;
    const imageData = await decodeImageFile(file);
    const previewData = previewImageData(imageData);
    const dataUrl = imageDataUrl(previewData);
    previewCacheRef.current = { file, imageData, previewData, dataUrl };
    return previewCacheRef.current;
  };

  const loadPreview = async (fileList, activeSettings = settings) => {
    const first = fileList[0];
    if (!first) return;
    const runId = ++previewRunRef.current;
    try {
      const plan = buildRecolorPlan(activeSettings);
      const original = await getPreviewOriginal(first);
      const processed = recolorImageData(original.previewData || original.imageData, plan);
      if (runId === previewRunRef.current) setPreview({ name: first.name, before: original.dataUrl, after: imageDataUrl(processed) });
    } catch (err) {
      setStatus(`Preview failed: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!files.length) return;
    const timer = setTimeout(() => {
      loadPreview(files, settings);
    }, 180);
    return () => clearTimeout(timer);
  }, [settings, files]);

  const handleFiles = async (e) => {
    const list = Array.from(e.target.files || []).filter(file => /\.(tga|dds|png|jpe?g)$/i.test(file.name));
    e.target.value = '';
    previewCacheRef.current = { file: null, imageData: null, dataUrl: '' };
    setFiles(list);
    setStatus(`${list.length} texture files queued.`);
    await loadPreview(list);
  };

  const refreshPreview = () => loadPreview(files);
  const applyBestSettings = async () => {
    const next = { ...BEST_RECOLOR_SETTINGS };
    setSettings(next);
    setStatus('Applied best RTW recolor settings.');
    if (files.length) await loadPreview(files, next);
  };
  const clearQueue = () => {
    setFiles([]);
    setPreview(null);
    previewCacheRef.current = { file: null, imageData: null, dataUrl: '' };
    setStatus('Texture queue cleared.');
  };

  const applySmartRecolor = async () => {
    const first = files[0];
    if (!first) {
      setStatus('Load a texture first, then use AI smart recolor.');
      return;
    }
    try {
      const original = await getPreviewOriginal(first);
      const candidates = detectFactionColorCandidates(original.imageData);
      if (!candidates.length) {
        setStatus('No strong faction-color candidates detected. Try using the screenshot/color sampler.');
        return;
      }
      const next = {
        ...settings,
        source: candidates[0].hex,
        tolerance: 24,
        rgbTolerance: 165,
        strength: 90,
        minSat: 22,
        targetMix: 88,
        saturationBoost: 0,
        desaturate: 0,
        lightnessMix: 0,
        contrast: 100,
        useSource: true,
        exactTarget: true,
        preserveLight: true,
        protectExtremes: true,
        protectMaterials: true,
        secondaryEnabled: candidates.length > 1,
        secondarySource: candidates[1]?.hex || settings.secondarySource,
      };
      setSettings(next);
      setStatus(`AI smart recolor detected source colors: ${candidates.map(c => c.hex.toUpperCase()).join(', ')}`);
      await loadPreview(files, next);
    } catch (err) {
      setStatus(`AI smart recolor failed: ${err.message}`);
    }
  };

  const loadSamplerImageData = (imageData, name = 'screenshot') => {
    setSampler({ name, imageData, src: imageDataUrl(imageData) });
    setStatus(`Loaded ${name} for color sampling.`);
  };

  const handleSamplerUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      loadSamplerImageData(await decodeImageFile(file), file.name);
    } catch (err) {
      setStatus(`Screenshot load failed: ${err.message}`);
    }
  };

  const pasteSamplerScreenshot = async () => {
    try {
      loadSamplerImageData(await readClipboardImageData(), 'clipboard screenshot');
    } catch (err) {
      setStatus(`Paste screenshot failed: ${err.message}`);
    }
  };

  const handleSamplerPick = (hex) => {
    update(samplerTarget, hex);
    setStatus(`Picked ${hex.toUpperCase()} for ${AI_RECOLOR_TARGETS.find(([key]) => key === samplerTarget)?.[1] || samplerTarget}.`);
  };

  const generateAiPrompt = async () => {
    const prompt = buildUvLockedPrompt(settings, aiBrief, files[0]?.name || preview?.name || 'RTW texture');
    setAiPrompt(prompt);
    try {
      await navigator.clipboard?.writeText(prompt);
      setStatus('Copied UV-locked image-to-image prompt.');
    } catch {
      setStatus('Generated UV-locked image-to-image prompt.');
    }
  };

  const exportZip = async () => {
    const zip = new JSZip();
    const plan = buildRecolorPlan(settings);
    let completed = 0;
    const progressStep = files.length > 100 ? 10 : files.length > 40 ? 5 : 1;
    setStatus(`Processing ${files.length} texture file${files.length === 1 ? '' : 's'}...`);

    const results = await mapWithLimit(files, textureWorkerLimit(files.length), async (file) => {
      try {
        const original = await decodeImageFile(file);
        const processed = recolorImageData(original, plan);
        const sourcePath = file.webkitRelativePath || file.name;
        const outputs = [];
        if (settings.outputFormat === 'tga' || settings.outputFormat === 'both') {
          const outName = appendSuffix(sourcePath, settings.suffix, 'tga');
          outputs.push({ name: outName, data: encodeTga(processed) });
        }
        if (settings.outputFormat === 'dds' || settings.outputFormat === 'both') {
          const outName = appendSuffix(sourcePath, settings.suffix, 'dds');
          outputs.push({ name: outName, data: encodeDds(processed) });
        }
        completed += 1;
        if (completed === files.length || completed % progressStep === 0) setStatus(`Processed ${completed}/${files.length}: ${sourcePath}`);
        return { line: `OK ${sourcePath} -> ${outputs.map(out => out.name).join(', ')}`, outputs };
      } catch (err) {
        completed += 1;
        if (completed === files.length || completed % progressStep === 0) setStatus(`Processed ${completed}/${files.length}: ${file.name}`);
        return { line: `FAILED ${file.name}: ${err.message}`, outputs: [] };
      }
    });

    const lines = results.map(result => result.line);
    for (const result of results) {
      for (const output of result.outputs) zip.file(output.name, output.data);
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
          <input type="file" accept=".tga,.dds,.png,.jpg,.jpeg" multiple webkitdirectory="" className="hidden" onChange={handleFiles} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load texture folder</span>
        </label>
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>{files.length} queued</span>
          <button onClick={clearQueue} disabled={!files.length} className="text-slate-400 hover:text-slate-200 disabled:opacity-40">Clear</button>
        </div>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={applySmartRecolor} disabled={!files.length}>
          <Wand2 className="w-3.5 h-3.5" />
          AI smart recolor
        </Button>
        <Swatch label="Source faction color" value={settings.source} onChange={v => update('source', v)} />
        <Swatch label="Target faction color" value={settings.target} onChange={v => update('target', v)} />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={settings.secondaryEnabled} onChange={e => update('secondaryEnabled', e.target.checked)} className="accent-amber-500" />
          Secondary color pass
        </label>
        <div className={`grid grid-cols-2 gap-2 rounded border border-slate-800/70 p-2 ${settings.secondaryEnabled ? 'bg-slate-900/50' : 'bg-slate-950/40 opacity-70'}`}>
          <Swatch label="Secondary source" value={settings.secondarySource} onChange={v => update('secondarySource', v)} />
          <Swatch label="Secondary target" value={settings.secondaryTarget} onChange={v => update('secondaryTarget', v)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={settings.tertiaryEnabled} onChange={e => update('tertiaryEnabled', e.target.checked)} className="accent-amber-500" />
          Tertiary color pass
        </label>
        <div className={`grid grid-cols-2 gap-2 rounded border border-slate-800/70 p-2 ${settings.tertiaryEnabled ? 'bg-slate-900/50' : 'bg-slate-950/40 opacity-70'}`}>
          <Swatch label="Tertiary source" value={settings.tertiarySource} onChange={v => update('tertiarySource', v)} />
          <Swatch label="Tertiary target" value={settings.tertiaryTarget} onChange={v => update('tertiaryTarget', v)} />
        </div>
        <Range label="Hue tolerance" value={settings.tolerance} min={1} max={180} onChange={v => update('tolerance', v)} />
        <Range label="RGB tolerance" value={settings.rgbTolerance} min={24} max={360} onChange={v => update('rgbTolerance', v)} />
        <Range label="Strength" value={settings.strength} min={1} max={200} onChange={v => update('strength', v)} />
        <Range label="Minimum saturation" value={settings.minSat} min={0} max={100} onChange={v => update('minSat', v)} />
        <Range label="Target color mix" value={settings.targetMix ?? (settings.exactTarget ? 88 : 42)} min={0} max={100} onChange={v => update('targetMix', v)} />
        <Range label="Saturation boost" value={settings.saturationBoost ?? 0} min={-100} max={100} onChange={v => update('saturationBoost', v)} />
        <Range label="Desaturate output" value={settings.desaturate ?? 0} min={0} max={100} onChange={v => update('desaturate', v)} />
        <Range label="Lightness target mix" value={settings.lightnessMix ?? 0} min={0} max={100} onChange={v => update('lightnessMix', v)} />
        <Range label="Lightness shift" value={settings.lightnessShift} min={-35} max={35} onChange={v => update('lightnessShift', v)} />
        <Range label="Contrast" value={settings.contrast ?? 100} min={50} max={150} onChange={v => update('contrast', v)} />
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
          ['exactTarget', 'Use exact target color'],
          ['preserveLight', 'Preserve shadows/highlights'],
          ['recolorNeutrals', 'Allow low-saturation pixels'],
          ['protectExtremes', 'Protect black/white detail'],
          ['protectMaterials', 'Protect skin/hair/leather/armor'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={e => {
                const checked = e.target.checked;
                setSettings(prev => ({
                  ...prev,
                  [key]: checked,
                  ...(key === 'exactTarget' ? { targetMix: checked ? 88 : 42 } : {}),
                  ...(key === 'preserveLight' ? { lightnessMix: checked ? 0 : 36 } : {}),
                }));
              }}
              className="accent-amber-500"
            />
            {label}
          </label>
        ))}
        <Button variant="outline" className="w-full h-8 text-xs" onClick={applyBestSettings}>Best settings</Button>
        <Button variant="outline" className="w-full h-8 text-xs" onClick={refreshPreview} disabled={!files.length}>Refresh preview</Button>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={exportZip} disabled={!files.length}>
          <Download className="w-3.5 h-3.5" />
          Export recolored zip
        </Button>
      </div>
      <div className="rounded border border-slate-700 bg-slate-950/60 p-3 min-h-[420px]">
        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <PreviewImage label={`${preview.name} original`} src={preview.before} />
              <PreviewImage label="recolored output" src={preview.after} />
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] uppercase text-slate-500">UV-locked image-to-image prompt</span>
                <Button variant="outline" className="h-6 px-2 text-[10px]" onClick={generateAiPrompt}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy prompt
                </Button>
              </div>
              <textarea
                value={aiBrief}
                onChange={e => setAiBrief(e.target.value)}
                placeholder="Optional description for Bing-style image-to-image generation..."
                className="w-full h-16 resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
              />
              {aiPrompt && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400">{aiPrompt}</pre>}
            </div>
          </div>
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-500">Load textures to preview recolor results.</div>
        )}
      </div>
      <div className="space-y-3">
        <ColorSampler
          sampler={sampler}
          activeTarget={samplerTarget}
          onTargetChange={setSamplerTarget}
          onUpload={handleSamplerUpload}
          onPaste={pasteSamplerScreenshot}
          onPick={handleSamplerPick}
        />
        <pre className="rounded border border-slate-700 bg-black/30 p-2 text-[10px] text-slate-300 whitespace-pre-wrap overflow-auto max-h-[360px]">{status || 'Supports true-color/RLE TGA, DXT1/DXT3/DXT5 DDS, browser image formats, screenshot sampling, and UV-locked AI prompt export.'}</pre>
      </div>
    </div>
  );
}

function Swatch({ label, value, onChange }) {
  const normalized = normalizeColorInput(value) || '#000000';
  const [draft, setDraft] = useState(value || normalized);
  const [message, setMessage] = useState('');
  const draftColor = normalizeColorInput(draft);
  const draftIsValid = !!draftColor;
  useEffect(() => {
    setDraft(value || normalized);
    setMessage('');
  }, [value, normalized]);

  const commit = () => {
    const next = normalizeColorInput(draft);
    if (next) {
      setDraft(next);
      setMessage('');
      onChange(next);
    } else {
      setDraft(value || normalized);
      setMessage('Use #RRGGBB, rgb(r,g,b), hsl(h,s%,l%), or a named color.');
    }
  };
  const commitPicker = (next) => {
    const normalizedNext = normalizeColorInput(next) || normalized;
    setDraft(normalizedNext);
    setMessage('');
    onChange(normalizedNext);
  };
  const copyColor = async () => {
    const text = `${normalized.toUpperCase()} ${hexToHslText(normalized)}`;
    try {
      await navigator.clipboard?.writeText(text);
      setMessage('Copied.');
    } catch {
      setDraft(text);
      setMessage('Copy blocked; text placed in the field.');
    }
  };
  const pasteColor = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      const next = normalizeColorInput(text);
      if (!next) {
        setMessage('Clipboard does not contain a supported color.');
        return;
      }
      setDraft(next);
      setMessage('');
      onChange(next);
    } catch {
      setMessage('Clipboard read blocked; paste into the field.');
    }
  };
  const handleKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyColor();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteColor();
    } else if (event.key === 'Enter') {
      commit();
    }
  };

  return (
    <div className="block space-y-1">
      <span className="flex items-center justify-between gap-2 text-[10px] uppercase text-slate-500">
        <span className="truncate">{label}</span>
        <span className="font-mono text-[9px] text-slate-600">{normalized.toUpperCase()} {hexToHslText(normalized)}</span>
      </span>
      <div className="grid grid-cols-[2.25rem_1fr_auto_auto] items-center gap-1.5">
        <input
          type="color"
          value={normalized}
          onInput={e => commitPicker(e.currentTarget.value)}
          onChange={e => commitPicker(e.target.value)}
          className="h-7 w-9 rounded border border-slate-600 bg-slate-900 p-0.5 cursor-pointer"
          aria-label={`${label} color picker`}
          title="Open native color picker"
        />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          placeholder="#808000, hsl(60, 100%, 25%), or olive"
          spellCheck={false}
          className={`h-7 min-w-0 px-2 text-[11px] font-mono bg-slate-900 border rounded cursor-text focus:outline-none focus:ring-1 ${draftIsValid ? 'border-slate-700 focus:border-amber-400 focus:ring-amber-400/40' : 'border-red-700/70 text-red-300 focus:border-red-500 focus:ring-red-500/40'}`}
        />
        <button type="button" onClick={copyColor} className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-amber-500">Copy</button>
        <button type="button" onClick={pasteColor} className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-amber-500">Paste</button>
      </div>
      {message && <p className="text-[9px] text-amber-300">{message}</p>}
    </div>
  );
}

function ColorSampler({ sampler, activeTarget, onTargetChange, onUpload, onPaste, onPick }) {
  const imgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const sampleAt = (event, commit = false) => {
    if (!sampler?.imageData || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(sampler.imageData.width - 1, Math.floor((event.clientX - rect.left) * sampler.imageData.width / rect.width)));
    const y = Math.max(0, Math.min(sampler.imageData.height - 1, Math.floor((event.clientY - rect.top) * sampler.imageData.height / rect.height)));
    const i = (y * sampler.imageData.width + x) * 4;
    const data = sampler.imageData.data;
    const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
    setHover({ x, y, hex });
    if (commit) onPick(hex);
  };

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase text-slate-500">Screenshot color sampler</span>
        {hover && <span className="font-mono text-[10px] text-slate-300">{hover.hex.toUpperCase()} @ {hover.x},{hover.y}</span>}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" className="h-7 text-[10px] gap-1" onClick={onPaste}>
          <Clipboard className="w-3 h-3" />
          Paste screenshot
        </Button>
        <label className="h-7 rounded border border-slate-700 bg-slate-950/60 hover:border-amber-500/60 px-2 flex items-center justify-center gap-1 text-[10px] text-slate-200 cursor-pointer">
          <Upload className="w-3 h-3" />
          Upload image
          <input type="file" accept=".png,.jpg,.jpeg,.webp,.tga,.dds" className="hidden" onChange={onUpload} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {AI_RECOLOR_TARGETS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onTargetChange(key)}
            className={`h-6 px-2 rounded border text-[10px] ${activeTarget === key ? 'border-amber-500 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-950/50 text-slate-400 hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {sampler ? (
        <div className="rounded border border-slate-800 bg-black/40 overflow-hidden">
          <img
            ref={imgRef}
            src={sampler.src}
            alt={sampler.name}
            onPointerMove={sampleAt}
            onPointerDown={event => sampleAt(event, true)}
            className="w-full max-h-56 object-contain image-render-pixelated"
            style={{ cursor: 'crosshair', touchAction: 'none' }}
            draggable={false}
          />
        </div>
      ) : (
        <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-3 text-[10px] text-slate-500">
          Press Print Screen, then Paste screenshot, or upload an image. Click a pixel to set the selected source/target color.
        </div>
      )}
    </div>
  );
}

function Range({ label, value, min, max, onChange }) {
  const commit = (next) => {
    const numeric = Number(next);
    if (!Number.isFinite(numeric)) return;
    onChange(Math.max(min, Math.min(max, numeric)));
  };

  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase text-slate-500">
        <span>{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => commit(e.target.value)}
          className="h-5 w-16 rounded border border-slate-700 bg-slate-900 px-1 text-right text-[10px] text-slate-200"
        />
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => commit(e.target.value)} className="w-full accent-amber-500 cursor-pointer" />
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

function SpriteLogoGeneratorTab() {
  const [files, setFiles] = useState([]);
  const [factionText, setFactionText] = useState(() => {
    try {
      return localStorage.getItem('m2tw_sm_factions_raw') || localStorage.getItem('m2tw_factions_file') || sessionStorage.getItem('m2tw_factions_raw') || '';
    } catch { return ''; }
  });
  const [settings, setSettings] = useState({ size: 128, columns: 8, maxPerSheet: 64, fitMode: 'trim-fit', prefix: 'faction_logo_spritesheet' });
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('');

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));
  const numeric = (key, value, min, max) => {
    const n = Math.max(min, Math.min(max, Number(value) || min));
    update(key, n);
  };

  const handleIcons = (e) => {
    const list = Array.from(e.target.files || [])
      .filter(file => /\.(tga|png)$/i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    e.target.value = '';
    setFiles(list);
    setResult(null);
    setStatus(`${list.length} icon file${list.length === 1 ? '' : 's'} queued.`);
  };

  const generate = async () => {
    if (!files.length) return;
    const size = Math.max(16, Math.min(512, Number(settings.size) || 128));
    const columns = Math.max(1, Math.min(32, Number(settings.columns) || 8));
    const maxPerSheet = Math.max(1, Math.min(512, Number(settings.maxPerSheet) || 64));
    const prefix = String(settings.prefix || 'faction_logo_spritesheet').trim() || 'faction_logo_spritesheet';
    setStatus(`Processing ${files.length} icon file${files.length === 1 ? '' : 's'}...`);

    const icons = (await mapWithLimit(files, textureWorkerLimit(files.length), async (file) => {
      const imageData = await decodeImageFile(file);
      const resized = resizeIconImageData(imageData, size, settings.fitMode);
      const faction = factionNameFromIconFile(file);
      return {
        fileName: file.name,
        faction,
        spriteName: `FACTION_LOGO_${faction.toUpperCase()}`,
        imageData: resized,
      };
    })).filter(Boolean);

    const zip = new JSZip();
    const sheets = [];
    const mapping = {};
    for (const icon of icons) mapping[icon.faction] = icon.spriteName;

    for (let i = 0, sheetIndex = 0; i < icons.length; i += maxPerSheet, sheetIndex++) {
      const chunk = icons.slice(i, i + maxPerSheet);
      const rows = Math.max(1, Math.ceil(chunk.length / columns));
      const canvas = document.createElement('canvas');
      canvas.width = columns * size;
      canvas.height = rows * size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      chunk.forEach((icon, j) => {
        const x = (j % columns) * size;
        const y = Math.floor(j / columns) * size;
        ctx.putImageData(icon.imageData, x, y);
      });

      const sheetName = `${prefix}_${sheetIndex}.tga`;
      const xmlName = `${prefix}_${sheetIndex}.xml`;
      const sheetData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const xml = buildSpriteXml(sheetName, chunk, size, columns);
      zip.file(sheetName, encodeTga(sheetData));
      zip.file(xmlName, toCRLF(xml));
      sheets.push({ sheetName, xmlName, count: chunk.length, width: canvas.width, height: canvas.height, preview: canvas.toDataURL('image/png') });
    }

    let patchedText = '';
    let patchedCount = 0;
    if (factionText.trim()) {
      const patched = updateFactionLogoIndexes(factionText, mapping);
      patchedText = patched.text;
      patchedCount = patched.patched;
      zip.file('descr_sm_factions_patched.txt', patchedText);
    }

    const report = [
      `Icons: ${icons.length}`,
      `Sheets: ${sheets.length}`,
      `Size: ${size}x${size}`,
      `Columns: ${columns}`,
      `Max per sheet: ${maxPerSheet}`,
      `Patched factions: ${patchedCount}`,
      '',
      ...icons.map(icon => `${icon.fileName} -> ${icon.spriteName}`),
    ].join('\n');
    zip.file('faction_logo_spritesheet_report.txt', toCRLF(report));
    const blob = await zip.generateAsync({ type: 'blob' });
    setResult({ blob, sheets, report, patchedText, patchedCount });
    setStatus(`Created ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} and ${icons.length} sprite${icons.length === 1 ? '' : 's'}.`);
    try { localStorage.setItem('rtw_tools_last_output', report); } catch {}
  };

  const generateAllFactionIcons = async () => {
    const parsed = parseDescrSmFactions(factionText);
    const factions = parsed.filter(faction => faction?.name);
    if (!factions.length) {
      setStatus('Load descr_sm_factions.txt first so the tool can read faction IDs and colors.');
      return;
    }
    setStatus(`Generating icon sets for ${factions.length} factions...`);
    await yieldToBrowser();
    const zip = new JSZip();
    const report = [];
    const slots = [
      ['data/menu/symbols/FE_buttons_24', 'symbol24', 24, ['standard', 'grey', 'roll', 'select']],
      ['data/menu/symbols/FE_buttons_48', 'symbol48', 48, ['standard', 'grey', 'roll', 'select']],
      ['data/menu/symbols/FE_buttons_128', 'symbol128', 128, ['standard']],
      ['data/loading_screen/symbols', 'symbol128', 128, ['standard']],
      ['data/loading_screen/symbols', 'symbol128', 256, ['standard']],
    ];

    for (const faction of factions) {
      for (const [folder, prefixName, size, variants] of slots) {
        for (const variant of variants) {
          const suffix = variant === 'standard' ? '' : `_${variant}`;
          const x2 = folder.includes('loading_screen') && size === 256 ? '_x2' : '';
          const name = `${prefixName}_${faction.name}${suffix}${x2}.tga`;
          const imageData = drawAutoFactionIconImageData(faction, size, variant);
          zip.file(`${folder}/${name}`, encodeTga(imageData));
          report.push(`${folder}/${name}`);
        }
      }
    }

    const patched = updateFactionLogoIndexes(factionText, Object.fromEntries(
      factions.map(faction => [faction.name.toLowerCase(), `FACTION_LOGO_${faction.name.toUpperCase()}`])
    ));
    if (patched.text) zip.file('descr_sm_factions_patched.txt', patched.text);
    zip.file('auto_faction_icon_report.txt', toCRLF([
      `Generated faction icon sets: ${factions.length}`,
      `Files: ${report.length}`,
      '',
      ...report,
    ].join('\n')));
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    downloadBlob(blob, 'rtw_auto_faction_icons.zip');
    setStatus(`Generated ${report.length} icon files for ${factions.length} factions.`);
  };

  return (
    <div className="grid grid-cols-[320px_1fr_360px] gap-3 min-h-0">
      <div className="space-y-3">
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.png" multiple className="hidden" onChange={handleIcons} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load icon files</span>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.png" multiple webkitdirectory="" className="hidden" onChange={handleIcons} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load icon folder</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase text-slate-500">Size</span>
            <input type="number" min="16" max="512" value={settings.size} onChange={e => numeric('size', e.target.value, 16, 512)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase text-slate-500">Columns</span>
            <input type="number" min="1" max="32" value={settings.columns} onChange={e => numeric('columns', e.target.value, 1, 32)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase text-slate-500">Max</span>
            <input type="number" min="1" max="512" value={settings.maxPerSheet} onChange={e => numeric('maxPerSheet', e.target.value, 1, 512)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs" />
          </label>
        </div>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Fit mode</span>
          <select value={settings.fitMode} onChange={e => update('fitMode', e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs">
            <option value="trim-fit">Trim + fit</option>
            <option value="contain">Contain</option>
            <option value="stretch">Stretch exact</option>
          </select>
        </label>
        <TextField label="Output prefix" value={settings.prefix} onChange={value => update('prefix', value)} />
        <FileInput label="Load descr_sm_factions.txt" accept=".txt" onText={setFactionText} />
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>{files.length} queued</span>
          <button onClick={() => { setFiles([]); setResult(null); setStatus('Sprite logo queue cleared.'); }} disabled={!files.length} className="text-slate-400 hover:text-slate-200 disabled:opacity-40">Clear</button>
        </div>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={generate} disabled={!files.length}>
          <Wand2 className="w-3.5 h-3.5" />
          Generate sheets
        </Button>
        <Button className="w-full h-8 text-xs gap-1.5 bg-emerald-700 hover:bg-emerald-600" onClick={generateAllFactionIcons} disabled={!factionText.trim()}>
          <Wand2 className="w-3.5 h-3.5" />
          Auto-generate all faction icons
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={() => result?.blob && downloadBlob(result.blob, 'rtw_faction_logo_spritesheets.zip')} disabled={!result?.blob}>
          <Download className="w-3.5 h-3.5" />
          Download zip
        </Button>
        <p className="text-xs text-amber-300 whitespace-pre-wrap">{status}</p>
      </div>

      <div className="rounded border border-slate-700 bg-slate-950/60 p-3 min-h-[520px] overflow-auto">
        {result?.sheets?.length ? (
          <div className="grid grid-cols-2 gap-3">
            {result.sheets.map(sheet => (
              <div key={sheet.sheetName} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                  <span className="font-mono text-slate-300 truncate">{sheet.sheetName}</span>
                  <span>{sheet.width}x{sheet.height}</span>
                </div>
                <div className="rounded border border-slate-700 bg-black/40 overflow-hidden">
                  <img src={sheet.preview} alt={sheet.sheetName} className="w-full h-auto" style={{ imageRendering: 'pixelated' }} />
                </div>
                <p className="text-[9px] text-slate-600 font-mono">{sheet.xmlName} - {sheet.count} sprites</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-500">Load PNG/TGA faction icons.</div>
        )}
      </div>

      <div className="grid grid-rows-[1fr_1fr] gap-3 min-h-[520px]">
        <textarea
          value={result?.patchedText || factionText}
          onChange={e => setFactionText(e.target.value)}
          spellCheck={false}
          className="min-h-0 rounded border border-slate-700 bg-black/30 p-3 text-[10px] font-mono text-slate-200"
          placeholder="descr_sm_factions.txt"
        />
        <pre className="min-h-0 overflow-auto rounded border border-slate-700 bg-black/30 p-3 text-[10px] text-slate-300 whitespace-pre-wrap">
          {result?.report || 'Sprite sheet report appears here.'}
        </pre>
      </div>
    </div>
  );
}

export function AiImageWorkshopTab() {
  const [form, setForm] = useState({
    mode: 'unit',
    faction: 'thamud_01',
    culture: 'Hellenized Phoenician pre-Islamic Arabic',
    subject: 'elite desert spearman unit texture',
    colors: 'deep red cloth, warm bronze, ivory linen, dark leather',
    style: AI_IMAGE_STYLE_PRESETS.unit[0],
    details: 'sharper cloth folds, cleaner trim, historically plausible weathering',
    negative: '',
  });
  const [reference, setReference] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [generated, setGenerated] = useState(null);
  const [status, setStatus] = useState('');

  const update = (key, value) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'mode') {
        next.style = AI_IMAGE_STYLE_PRESETS[value]?.[0] || AI_IMAGE_STYLE_PRESETS.unit[0];
        next.subject = value === 'symbol'
          ? 'crescent, palm, and spear faction emblem'
          : value === 'eventpic'
            ? 'desert ambush campaign event picture'
            : value === 'art'
              ? 'royal desert guard concept art'
              : 'elite desert spearman unit texture';
      }
      return next;
    });
  };

  const handleReference = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imageData = await decodeImageFile(file);
      setReference({ name: file.name, width: imageData.width, height: imageData.height, src: imageDataUrl(imageData), imageData });
      setGenerated(null);
      setStatus(`Loaded ${file.name} (${imageData.width}x${imageData.height}).`);
    } catch (err) {
      setStatus(`Reference load failed: ${err.message}`);
    }
  };

  const generatePrompt = async () => {
    const next = buildBingStylePrompt(form, reference?.name || 'uploaded reference');
    setPrompt(next);
    try { localStorage.setItem('rtw_ai_generator_last_prompt', next); } catch {}
    try {
      await navigator.clipboard?.writeText(next);
      setStatus('Copied image-to-image prompt.');
    } catch {
      setStatus('Generated image-to-image prompt.');
    }
  };

  const generateIdeas = async () => {
    const next = generateAiImageIdeas(form);
    setIdeas(next);
    const text = next.map((idea, i) => `${i + 1}. ${idea}`).join('\n');
    try {
      await navigator.clipboard?.writeText(text);
      setStatus('Generated and copied ideas.');
    } catch {
      setStatus('Generated ideas.');
    }
  };

  const generateLocalAtlasPng = async () => {
    if (!reference?.imageData) {
      setStatus('Load a RTW texture atlas first.');
      return;
    }
    const activePrompt = prompt || buildBingStylePrompt(form, reference.name);
    const settings = buildAtlasPromptSettings(activePrompt);
    setStatus('Generating local RTW atlas recolor PNG...');
    await yieldToBrowser();
    const output = recolorImageData(reference.imageData, settings);
    const blob = await imageDataToPngBlob(output);
    if (!blob) {
      setStatus('PNG export failed.');
      return;
    }
    const outName = String(reference.name || 'rtw_texture.png')
      .replace(/\.(tga|dds|png|jpg|jpeg|webp)$/i, '')
      .replace(/\.tga\.dds$/i, '') + '.png';
    const src = imageDataUrl(output);
    setGenerated({
      name: outName,
      src,
      blob,
      width: output.width,
      height: output.height,
      settings,
    });
    setStatus(`Generated ${outName} with preserved canvas, UV layout, and alpha.`);
  };

  const downloadKit = () => {
    const kit = {
      mode: form.mode,
      reference: reference ? { name: reference.name, width: reference.width, height: reference.height } : null,
      prompt: prompt || buildBingStylePrompt(form, reference?.name || 'uploaded reference'),
      ideas,
      generated: generated ? { name: generated.name, width: generated.width, height: generated.height, settings: generated.settings } : null,
      settings: form,
    };
    downloadBlob(new Blob([JSON.stringify(kit, null, 2)], { type: 'application/json' }), `ai_img2img_${form.mode}_kit.json`);
  };

  return (
    <div className="grid grid-cols-[320px_1fr_360px] gap-3 min-h-0">
      <div className="space-y-3">
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Mode</span>
          <select value={form.mode} onChange={e => update('mode', e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs">
            <option value="unit">Unit img2img</option>
            <option value="symbol">Faction symbol/icon img2img</option>
            <option value="eventpic">Event picture art</option>
            <option value="art">General mod art</option>
          </select>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.dds,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleReference} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load reference image</span>
        </label>
        <TextField label="Faction" value={form.faction} onChange={value => update('faction', value)} />
        <TextField label="Culture combo" value={form.culture} onChange={value => update('culture', value)} />
        <TextField label={form.mode === 'symbol' ? 'Symbol subject' : form.mode === 'eventpic' ? 'Event scene' : form.mode === 'art' ? 'Art subject' : 'Unit subject'} value={form.subject} onChange={value => update('subject', value)} />
        <TextField label="Palette/materials" value={form.colors} onChange={value => update('colors', value)} />
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Style preset</span>
          <select value={form.style} onChange={e => update('style', e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs">
            {AI_IMAGE_STYLE_PRESETS[form.mode].map(style => <option key={style} value={style}>{style}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Extra description</span>
          <textarea value={form.details} onChange={e => update('details', e.target.value)} className="w-full h-20 mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Avoid</span>
          <textarea value={form.negative} onChange={e => update('negative', e.target.value)} className="w-full h-16 mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" />
        </label>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={generatePrompt}>
          <Wand2 className="w-3.5 h-3.5" />
          Generate img2img prompt
        </Button>
        <Button className="w-full h-8 text-xs gap-1.5 bg-emerald-700 hover:bg-emerald-600" onClick={generateLocalAtlasPng} disabled={!reference}>
          <Image className="w-3.5 h-3.5" />
          Generate local PNG
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={() => generated?.blob && downloadBlob(generated.blob, generated.name)} disabled={!generated?.blob}>
          <Download className="w-3.5 h-3.5" />
          Download generated PNG
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={generateIdeas}>
          <Search className="w-3.5 h-3.5" />
          Generate ideas
        </Button>
        <Button variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={downloadKit}>
          <Download className="w-3.5 h-3.5" />
          Download kit
        </Button>
        <p className="text-xs text-amber-300 whitespace-pre-wrap">{status}</p>
      </div>

      <div className="rounded border border-slate-700 bg-slate-950/60 p-3 min-h-[520px] overflow-auto">
        {reference ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="font-mono text-slate-300 truncate">{reference.name}</span>
                <span>{reference.width}x{reference.height}</span>
              </div>
              <div className="rounded border border-slate-700 bg-black/40 overflow-hidden">
                <img src={reference.src} alt={reference.name} className="w-full h-auto image-render-pixelated" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="font-mono text-slate-300 truncate">{generated?.name || 'Generated PNG'}</span>
                {generated && <span>{generated.width}x{generated.height}</span>}
              </div>
              <div className="rounded border border-slate-700 bg-black/40 overflow-hidden min-h-32 grid place-items-center">
                {generated ? (
                  <img src={generated.src} alt={generated.name} className="w-full h-auto image-render-pixelated" />
                ) : (
                  <span className="text-xs text-slate-600">Generated atlas preview appears here.</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-500">Load a unit texture, unit card, symbol128, symbol48, or icon reference.</div>
        )}
      </div>

      <div className="grid grid-rows-[1fr_1fr] gap-3 min-h-[520px]">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          spellCheck={false}
          className="min-h-0 rounded border border-slate-700 bg-black/30 p-3 text-[11px] text-slate-200"
          placeholder="Generated Bing/Copilot-style image-to-image prompt appears here."
        />
        <div className="min-h-0 rounded border border-slate-700 bg-black/30 p-3 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase text-slate-500">Idea generator</span>
            <button onClick={() => navigator.clipboard?.writeText(ideas.map((idea, i) => `${i + 1}. ${idea}`).join('\n'))} disabled={!ideas.length} className="text-[10px] text-slate-400 hover:text-slate-100 disabled:opacity-40">Copy</button>
          </div>
          {ideas.length ? (
            <div className="space-y-2">
              {ideas.map((idea, i) => (
                <button key={`${idea}-${i}`} onClick={() => update('subject', idea)} className="w-full text-left rounded border border-slate-800 bg-slate-900/50 p-2 text-[11px] text-slate-300 hover:border-amber-500/50">
                  {i + 1}. {idea}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-full grid place-items-center text-xs text-slate-500">Generate ideas for units or faction symbols.</div>
          )}
        </div>
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

function sanitizeRtwId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceIdentifierText(value, sourceId, targetId) {
  const text = String(value ?? '');
  const source = String(sourceId || '').trim();
  const target = String(targetId || '').trim();
  if (!source || !target || source.toLowerCase() === target.toLowerCase()) return text;
  const rx = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(source)})(?=$|[^A-Za-z0-9])`, 'gi');
  return text.replace(rx, (_, prefix, hit) => {
    const next = hit === hit.toUpperCase() ? target.toUpperCase() : target;
    return `${prefix}${next}`;
  });
}

function renameDeepIds(value, sourceId, targetId) {
  if (typeof value === 'string') return replaceIdentifierText(value, sourceId, targetId);
  if (Array.isArray(value)) return value.map(item => renameDeepIds(item, sourceId, targetId));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = renameDeepIds(item, sourceId, targetId);
    return out;
  }
  return value;
}

function sourceFilePath(file) {
  return String(file?.webkitRelativePath || file?.name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function sourceDataPath(file) {
  const rel = sourceFilePath(file);
  const lower = rel.toLowerCase();
  if (lower.startsWith('data/')) return rel;
  const dataIndex = lower.indexOf('/data/');
  if (dataIndex >= 0) return rel.slice(dataIndex + 1);
  const parts = rel.split('/').filter(Boolean);
  return `data/${parts.length > 1 ? parts.slice(1).join('/') : rel}`;
}

function indexModFiles(files) {
  return Array.from(files || []).map(file => {
    const rel = sourceFilePath(file);
    const dataPath = sourceDataPath(file);
    return {
      file,
      rel,
      dataPath,
      lowerRel: rel.toLowerCase(),
      lowerData: dataPath.toLowerCase(),
      name: String(file.name || '').toLowerCase(),
    };
  });
}

function findIndexedFile(index, candidates) {
  const wanted = (Array.isArray(candidates) ? candidates : [candidates])
    .map(path => String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase());
  return index.find(entry => wanted.includes(entry.lowerData))
    || index.find(entry => wanted.some(path => entry.lowerData.endsWith(`/${path}`) || entry.lowerRel.endsWith(`/${path}`) || entry.name === path));
}

async function readIndexedText(index, candidates) {
  const entry = findIndexedFile(index, candidates);
  return entry ? entry.file.text() : '';
}

function getLoadedSmFactionText() {
  try {
    return localStorage.getItem('m2tw_sm_factions_raw')
      || localStorage.getItem('m2tw_factions_file')
      || sessionStorage.getItem('m2tw_factions_raw')
      || '';
  } catch {
    return '';
  }
}

function getLoadedExportUnitsText() {
  try {
    return localStorage.getItem('m2tw_export_units_file') || '';
  } catch {
    return '';
  }
}

function buildCopiedFaction(sourceText, targetText, sourceId, targetId) {
  if (!sourceText.trim()) return { text: '', faction: null, warning: 'Source descr_sm_factions.txt was not found.' };
  const sourceFactions = parseDescrSmFactions(sourceText);
  const sourceFaction = sourceFactions.find(f => String(f.name || '').toLowerCase() === sourceId.toLowerCase());
  if (!sourceFaction) return { text: '', faction: null, warning: `Faction ${sourceId} was not found in source descr_sm_factions.txt.` };
  const copied = renameDeepIds(JSON.parse(JSON.stringify(sourceFaction)), sourceId, targetId);
  copied.name = targetId;
  copied.rebel_symbol = copied.rebel_symbol || 'models_strat/symbol_slaves.CAS';
  copied.loading_logo = `loading_screen/symbols/symbol128_${targetId}.tga`;
  copied.logo_index = `FACTION_LOGO_${targetId.toUpperCase()}`;
  copied.small_logo_index = `SMALL_FACTION_LOGO_${targetId.toUpperCase()}`;

  const targetFactions = targetText.trim() ? parseDescrSmFactions(targetText) : [];
  const outFactions = targetFactions.length
    ? targetFactions.filter(f => String(f.name || '').toLowerCase() !== targetId.toLowerCase())
    : [];
  outFactions.push(copied);
  return { text: serializeDescrSmFactions(outFactions), faction: sourceFaction, copied };
}

function copyUnitForFaction(unit, sourceId, targetId, targetOnlyOwnership) {
  const copied = renameDeepIds(JSON.parse(JSON.stringify(unit)), sourceId, targetId);
  if (targetOnlyOwnership) {
    copied.ownership = [targetId];
  } else {
    const ownership = (copied.ownership || [])
      .map(f => String(f || '').toLowerCase() === sourceId.toLowerCase() ? targetId : f)
      .filter(f => f && String(f).toLowerCase() !== 'new_faction');
    if (!ownership.some(f => String(f).toLowerCase() === targetId.toLowerCase())) ownership.push(targetId);
    copied.ownership = [...new Set(ownership)];
  }
  copied.engine = copied.engine || inferSiegeEngine(copied) || '';
  return copied;
}

function unitBelongsToSource(unit, sourceId) {
  const lowerSource = sourceId.toLowerCase();
  const owners = (unit.ownership || []).map(f => String(f || '').toLowerCase());
  if (owners.includes(lowerSource)) return true;
  return [unit.type, unit.dictionary, unit.soldier_model, unit.officer1, unit.officer2, unit.officer3]
    .some(value => String(value || '').toLowerCase().includes(lowerSource));
}

function mergeUnitsByType(targetUnits, copiedUnits) {
  const copiedByType = new Map(copiedUnits.map(unit => [String(unit.type || '').toLowerCase(), unit]));
  const used = new Set();
  const merged = targetUnits.map(unit => {
    const key = String(unit.type || '').toLowerCase();
    if (!copiedByType.has(key)) return unit;
    used.add(key);
    return copiedByType.get(key);
  });
  for (const unit of copiedUnits) {
    const key = String(unit.type || '').toLowerCase();
    if (!used.has(key)) merged.push(unit);
  }
  return merged;
}

function unitLocKeyMatches(key, unit) {
  const lower = String(key || '').toLowerCase();
  const tokens = [unit.dictionary, unit.type].map(v => String(v || '').toLowerCase()).filter(v => v.length > 2);
  return tokens.some(token => lower === token || lower.startsWith(`${token}_`) || lower.includes(token));
}

function renameUnitLocKey(key, sourceUnit, copiedUnit, sourceId, targetId) {
  let out = replaceIdentifierText(key, sourceId, targetId);
  if (sourceUnit.dictionary && copiedUnit.dictionary) out = replaceIdentifierText(out, sourceUnit.dictionary, copiedUnit.dictionary);
  if (sourceUnit.type && copiedUnit.type) out = replaceIdentifierText(out, sourceUnit.type, copiedUnit.type);
  return out;
}

function mergeCopiedUnitText(sourceText, targetText, pairs, sourceId, targetId) {
  if (!sourceText.trim()) return { text: '', count: 0 };
  const sourceMap = parseTextLocFile(sourceText);
  const targetMap = targetText.trim() ? parseTextLocFile(targetText) : {};
  let count = 0;
  for (const [key, value] of Object.entries(sourceMap)) {
    const pair = pairs.find(item => unitLocKeyMatches(key, item.source));
    if (!pair) continue;
    const nextKey = renameUnitLocKey(key, pair.source, pair.copy, sourceId, targetId);
    targetMap[nextKey] = replaceIdentifierText(value, sourceId, targetId);
    count++;
  }
  return {
    text: serializeTextLocFile(targetMap, { header: 'Merged by Rome Tools mod copier' }),
    count,
  };
}

function dmbTypeNamesFromUnits(units) {
  const names = new Set();
  for (const unit of units) {
    [unit.soldier_model, unit.officer1, unit.officer2, unit.officer3, unit.mount, unit.animal]
      .filter(Boolean)
      .forEach(name => names.add(String(name).toLowerCase()));
  }
  return names;
}

function extractDmbBlocks(text, typeNames) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = stripComment(lines[i]).match(/^type\s+(.+)/i);
    if (!match) continue;
    const name = match[1].trim();
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^type\s+/i.test(stripComment(lines[j]))) {
        end = j;
        break;
      }
    }
    if (typeNames.has(name.toLowerCase())) blocks.push({ name, text: lines.slice(i, end).join('\n') });
    i = end - 1;
  }
  return blocks;
}

function mergeDmbBlocks(targetText, blocks, sourceId, targetId) {
  const existing = new Set();
  for (const raw of String(targetText || '').split(/\r?\n/)) {
    const match = stripComment(raw).match(/^type\s+(.+)/i);
    if (match) existing.add(match[1].trim().toLowerCase());
  }
  const appended = [];
  for (const block of blocks) {
    const renamedName = replaceIdentifierText(block.name, sourceId, targetId).toLowerCase();
    if (existing.has(renamedName)) continue;
    appended.push(replaceIdentifierText(block.text, sourceId, targetId));
    existing.add(renamedName);
  }
  if (!appended.length) return { text: targetText, count: 0 };
  const base = targetText.trimEnd();
  return { text: toCRLF(`${base}${base ? '\n\n' : ''}${appended.join('\n\n')}\n`), count: appended.length };
}

function dmbAssetPaths(blocks) {
  const paths = new Set();
  const rx = /\b(?:data[\\/])?(?:models_unit|unit_models|models_strat|sprites|textures|ui)[\\/][^\s,;'"<>]+/gi;
  for (const block of blocks || []) {
    for (const match of String(block.text || '').matchAll(rx)) {
      const clean = match[0].replace(/\\/g, '/').replace(/[),.]+$/, '');
      paths.add(clean.toLowerCase().startsWith('data/') ? clean : `data/${clean}`);
    }
  }
  return [...paths];
}

function indexedEntryForDataPath(index, path) {
  const lower = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const bare = lower.replace(/^data\//, '');
  return index.find(entry => entry.lowerData === lower || entry.lowerData.endsWith(`/${bare}`));
}

function unitAssetTokens(units, sourceId, faction) {
  const tokens = new Set([sourceId.toLowerCase()]);
  if (faction?.culture) tokens.add(String(faction.culture).toLowerCase());
  for (const unit of units) {
    [unit.type, unit.dictionary, unit.soldier_model, unit.officer1, unit.officer2, unit.officer3, unit.mount, unit.animal]
      .filter(Boolean)
      .forEach(token => tokens.add(String(token).toLowerCase()));
  }
  return [...tokens].filter(token => token.length > 2);
}

function shouldCopyModAsset(entry, tokens) {
  if (!/\.(tga|dds|png|jpg|jpeg|cas|spr|texture|txt)$/i.test(entry.name)) return false;
  if (/\/(?:text\/|export_descr_unit\.txt|descr_sm_factions\.txt|descr_model_battle\.txt)/i.test(entry.lowerData)) return false;
  return tokens.some(token => entry.lowerData.includes(token));
}

function renamedDataPath(path, sourceId, targetId) {
  return replaceIdentifierText(String(path || '').replace(/\\/g, '/'), sourceId, targetId);
}

function findFactionIconEntry(index, sourceId, faction) {
  const hints = [
    faction?.loading_logo,
    `loading_screen/symbols/symbol128_${sourceId}.tga`,
    `menu/symbols/fe_buttons_128/symbol128_${sourceId}.tga`,
    `menu/symbols/fe_buttons_48/symbol48_${sourceId}.tga`,
    `menu/symbols/fe_buttons_24/symbol24_${sourceId}.tga`,
  ].filter(Boolean).map(path => String(path).replace(/\\/g, '/').toLowerCase());
  const images = index.filter(entry => /\.(tga|dds|png|jpg|jpeg)$/i.test(entry.name));
  const hinted = images.find(entry => hints.some(hint => entry.lowerData.endsWith(hint) || entry.lowerData.includes(hint)));
  if (hinted) return hinted;
  return images
    .filter(entry => entry.lowerData.includes(sourceId.toLowerCase()) && /(?:symbol|logo|faction|fe_buttons|loading_screen)/i.test(entry.lowerData))
    .sort((a, b) => {
      const score = path => (path.includes('symbol128') ? 0 : path.includes('loading_screen') ? 1 : path.includes('symbol48') ? 2 : 3);
      return score(a.lowerData) - score(b.lowerData);
    })[0] || null;
}

async function addResizedFactionIcons(zip, iconEntry, targetId) {
  if (!iconEntry) return [];
  const imageData = await decodeImageFile(iconEntry.file);
  const outputs = [
    [`data/loading_screen/symbols/symbol128_${targetId}.tga`, 128],
    [`data/loading_screen/symbols/symbol128_${targetId}_x2.tga`, 256],
    [`data/loading_screen/symbols/symbol256_${targetId}.tga`, 256],
    [`data/menu/symbols/FE_buttons_128/symbol128_${targetId}.tga`, 128],
    [`data/menu/symbols/FE_buttons_48/symbol48_${targetId}.tga`, 48],
    [`data/menu/symbols/FE_buttons_24/symbol24_${targetId}.tga`, 24],
  ];
  for (const [path, size] of outputs) {
    zip.file(path, encodeTga(resizeIconImageData(imageData, size, 'trim-fit')));
  }
  return outputs.map(([path]) => path);
}

const MOD_COPIER_REFERENCE_TEXTS = [
  'data/descr_banners.txt',
  'data/descr_rebel_factions.txt',
  'data/descr_character.txt',
  'data/descr_names.txt',
  'data/descr_strat.txt',
  'data/text/names.txt',
  'data/text/expanded_bi.txt',
  'data/text/campaign_descriptions.txt',
  'data/text/menu_english.txt',
];

function ModCopierTab() {
  const [files, setFiles] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetOnlyOwnership, setTargetOnlyOwnership] = useState(true);
  const [copyAssets, setCopyAssets] = useState(true);
  const [resizeIcons, setResizeIcons] = useState(true);
  const [status, setStatus] = useState('Load a source mod data folder to copy faction files, units, models, UI, and icons.');
  const [report, setReport] = useState('');

  const handleFolder = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    setFiles(list);
    setReport('');
    setStatus(`${list.length} file${list.length === 1 ? '' : 's'} indexed from source mod.`);
  };

  const buildCopy = async () => {
    const cleanSource = sanitizeRtwId(sourceId);
    const cleanTarget = sanitizeRtwId(targetId);
    if (!files.length || !cleanSource || !cleanTarget) {
      setStatus('Choose a source folder and enter both source/replacer id and new faction id.');
      return;
    }

    setStatus('Reading source files and building copier ZIP...');
    const index = indexModFiles(files);
    const zip = new JSZip();
    const lines = [`Source id: ${cleanSource}`, `Target id: ${cleanTarget}`];
    let copiedDmbBlocks = [];

    const sourceSm = await readIndexedText(index, ['data/descr_sm_factions.txt', 'descr_sm_factions.txt']);
    const targetSm = getLoadedSmFactionText();
    const factionCopy = buildCopiedFaction(sourceSm, targetSm, cleanSource, cleanTarget);
    if (factionCopy.text) {
      zip.file('data/descr_sm_factions.txt', factionCopy.text);
      lines.push('+ descr_sm_factions.txt merged/copied');
    }
    if (factionCopy.warning) lines.push(`! ${factionCopy.warning}`);

    const sourceEdu = await readIndexedText(index, ['data/export_descr_unit.txt', 'export_descr_unit.txt']);
    let copiedPairs = [];
    let copiedUnits = [];
    if (sourceEdu.trim()) {
      const sourceUnits = parseEDU(sourceEdu).filter(unit => unitBelongsToSource(unit, cleanSource));
      copiedPairs = sourceUnits.map(source => ({ source, copy: copyUnitForFaction(source, cleanSource, cleanTarget, targetOnlyOwnership) }));
      copiedUnits = copiedPairs.map(pair => pair.copy);
      const targetEdu = getEduRawText();
      const targetUnits = targetEdu ? parseEDU(targetEdu) : [];
      const merged = targetUnits.length ? mergeUnitsByType(targetUnits, copiedUnits) : copiedUnits;
      if (merged.length) zip.file('data/export_descr_unit.txt', serializeEDU(merged));
      lines.push(`+ units copied: ${copiedUnits.length}`);
      const animalCount = copiedUnits.filter(unit => unit.animal).length;
      const engineCount = copiedUnits.filter(unit => unit.engine || inferSiegeEngine(unit)).length;
      if (animalCount) lines.push(`  animal lines preserved: ${animalCount}`);
      if (engineCount) lines.push(`  siege engine lines preserved/inferred: ${engineCount}`);
    } else {
      lines.push('! Source export_descr_unit.txt was not found.');
    }

    const sourceExportUnits = await readIndexedText(index, ['data/text/export_units.txt', 'text/export_units.txt', 'export_units.txt']);
    const mergedLoc = mergeCopiedUnitText(sourceExportUnits, getLoadedExportUnitsText(), copiedPairs, cleanSource, cleanTarget);
    if (mergedLoc.text) {
      zip.file('data/text/export_units.txt', mergedLoc.text);
      lines.push(`+ export_units.txt entries copied: ${mergedLoc.count}`);
    }

    const sourceDmb = await readIndexedText(index, ['data/descr_model_battle.txt', 'descr_model_battle.txt']);
    if (sourceDmb.trim() && copiedUnits.length) {
      const blocks = extractDmbBlocks(sourceDmb, dmbTypeNamesFromUnits(copiedPairs.map(pair => pair.source)));
      copiedDmbBlocks = blocks;
      const targetDmb = await getLoadedDmbText();
      const mergedDmb = mergeDmbBlocks(targetDmb, blocks, cleanSource, cleanTarget);
      if (mergedDmb.text?.trim()) zip.file('data/descr_model_battle.txt', mergedDmb.text);
      lines.push(`+ DMB model blocks copied: ${mergedDmb.count}`);
    }

    const iconEntry = findFactionIconEntry(index, cleanSource, factionCopy.faction);
    if (resizeIcons) {
      try {
        const iconPaths = await addResizedFactionIcons(zip, iconEntry, cleanTarget);
        if (iconPaths.length) lines.push(`+ resized faction icons: ${iconPaths.length}`);
        else lines.push('! No faction icon image found to resize.');
      } catch (err) {
        lines.push(`! Icon resize failed: ${err.message}`);
      }
    }

    if (copyAssets) {
      const tokens = unitAssetTokens(copiedPairs.map(pair => pair.source), cleanSource, factionCopy.faction);
      const assetMap = new Map();
      for (const entry of index.filter(entry => shouldCopyModAsset(entry, tokens))) assetMap.set(entry.lowerData, entry);
      for (const path of dmbAssetPaths(copiedDmbBlocks)) {
        const entry = indexedEntryForDataPath(index, path);
        if (entry) assetMap.set(entry.lowerData, entry);
      }
      const assets = [...assetMap.values()];
      let copied = 0;
      for (const entry of assets) {
        const path = renamedDataPath(entry.dataPath, cleanSource, cleanTarget);
        zip.file(path, await entry.file.arrayBuffer());
        copied++;
        if (copied % 40 === 0) await yieldToBrowser();
      }
      lines.push(`+ asset files copied: ${copied}`);
      if (copiedDmbBlocks.length) lines.push(`  DMB path-following enabled for models_unit/unit_models assets`);
    }

    let referenceCount = 0;
    for (const refPath of MOD_COPIER_REFERENCE_TEXTS) {
      const entry = findIndexedFile(index, refPath);
      if (!entry) continue;
      const raw = await entry.file.text();
      if (!raw.toLowerCase().includes(cleanSource.toLowerCase())) continue;
      const renamed = replaceIdentifierText(raw, cleanSource, cleanTarget);
      zip.file(`_merge_reference/${entry.dataPath}`, toCRLF(renamed));
      referenceCount++;
    }
    if (referenceCount) lines.push(`+ extra text merge references: ${referenceCount}`);

    lines.push('', ...copiedUnits.map(unit => `unit: ${unit.type} -> ownership ${unit.ownership.join(', ')}`));
    const finalReport = lines.join('\n');
    zip.file('mod_copier_report.txt', toCRLF(finalReport));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${cleanTarget}_mod_copy.zip`);
    setReport(finalReport);
    setStatus(`Created ${cleanTarget}_mod_copy.zip`);
    try { localStorage.setItem('rtw_tools_last_output', finalReport); } catch {}
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-3 min-h-0">
      <div className="space-y-3">
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" multiple webkitdirectory="" className="hidden" onChange={handleFolder} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><FolderOpen className="w-3.5 h-3.5 text-amber-400" />Load source mod folder</span>
        </label>
        <TextField label="Source/replacer id" value={sourceId} onChange={setSourceId} />
        <TextField label="New faction id" value={targetId} onChange={setTargetId} />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={targetOnlyOwnership} onChange={e => setTargetOnlyOwnership(e.target.checked)} className="accent-amber-500" />
          Unit ownership becomes target faction only
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={copyAssets} onChange={e => setCopyAssets(e.target.checked)} className="accent-amber-500" />
          Copy matching model/UI/texture assets
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={resizeIcons} onChange={e => setResizeIcons(e.target.checked)} className="accent-amber-500" />
          Resize faction icons to 128, 128x2, and 256
        </label>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={buildCopy} disabled={!files.length || !sourceId || !targetId}>
          <Copy className="w-3.5 h-3.5" />
          Build copier ZIP
        </Button>
        <p className="text-xs text-amber-300">{status}</p>
        <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-400">
          Uses the loaded target files when available, so faction/unit/text exports merge instead of replacing your current mod.
        </div>
      </div>
      <pre className="min-h-[560px] overflow-auto rounded border border-slate-700 bg-black/30 p-3 text-[11px] text-slate-300 whitespace-pre-wrap">
        {report || 'Copier report appears here after export.'}
      </pre>
    </div>
  );
}

function optimizedPngName(file, flattenTgaDds) {
  const rawPath = String(file.webkitRelativePath || file.name || 'texture').replace(/\\/g, '/');
  const withoutSuffix = flattenTgaDds
    ? rawPath.replace(/\.tga\.dds$/i, '').replace(/\.(tga|dds)$/i, '')
    : rawPath.replace(/\.(tga|dds)$/i, '');
  return `${withoutSuffix || 'texture'}.png`;
}

function PngConverterTab() {
  const [files, setFiles] = useState([]);
  const [flattenTgaDds, setFlattenTgaDds] = useState(true);
  const [status, setStatus] = useState('Load .tga, .dds, or .tga.dds files/folders, then export optimized lossless PNGs.');
  const [busy, setBusy] = useState(false);

  const loadFiles = (event) => {
    const picked = Array.from(event.target.files || [])
      .filter(file => /\.(?:tga|dds)$/i.test(file.name) || /\.tga\.dds$/i.test(file.name));
    event.target.value = '';
    setFiles(picked);
    setStatus(picked.length ? `Loaded ${picked.length} texture file${picked.length === 1 ? '' : 's'}.` : 'No .tga/.dds files found.');
  };

  const exportPngZip = async () => {
    if (!files.length) {
      setStatus('Load texture files first.');
      return;
    }
    setBusy(true);
    const zip = new JSZip();
    const report = [];
    let converted = 0;
    let failed = 0;
    try {
      await mapWithLimit(files, textureWorkerLimit(files.length), async (file, index) => {
        try {
          const imageData = await decodeImageFile(file);
          const png = await imageDataToPngBlob(imageData);
          if (!png) throw new Error('Browser PNG encoder returned no data.');
          const outPath = optimizedPngName(file, flattenTgaDds);
          zip.file(outPath, png);
          converted += 1;
          report.push(`OK\t${file.webkitRelativePath || file.name}\t${outPath}\t${imageData.width}x${imageData.height}`);
        } catch (err) {
          failed += 1;
          report.push(`FAIL\t${file.webkitRelativePath || file.name}\t${err.message}`);
        }
        if (index % 12 === 0) setStatus(`Converted ${converted}/${files.length} PNGs...`);
      });
      zip.file('png_conversion_report.txt', toCRLF([
        'RTW TGA/DDS to optimized PNG conversion',
        `Converted: ${converted}`,
        `Failed: ${failed}`,
        '',
        ...report,
      ].join('\n')));
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
      downloadBlob(blob, 'rtw_optimized_pngs.zip');
      setStatus(`Exported ${converted} optimized PNG${converted === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-3 min-h-0">
      <div className="space-y-3">
        <label className="block rounded border border-slate-700 bg-slate-900/70 p-3 cursor-pointer hover:border-amber-500/60">
          <input type="file" accept=".tga,.dds" multiple webkitdirectory="" className="hidden" onChange={loadFiles} />
          <span className="flex items-center gap-2 text-xs text-slate-200">
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            Load texture folder/files
          </span>
          <span className="block mt-1 text-[10px] text-slate-500">Accepts .tga, .dds, and .tga.dds while preserving folder paths in the zip.</span>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input type="checkbox" checked={flattenTgaDds} onChange={e => setFlattenTgaDds(e.target.checked)} className="accent-amber-500" />
          Convert names like texture.tga.dds to texture.png
        </label>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={exportPngZip} disabled={!files.length || busy}>
          <Download className="w-3.5 h-3.5" />
          Export optimized PNG zip
        </Button>
        <p className="text-xs text-amber-300 whitespace-pre-wrap">{status}</p>
      </div>
      <div className="rounded border border-slate-700 bg-slate-900/50 p-3 min-h-[560px]">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs font-semibold text-slate-200">Queued Textures</p>
          <span className="text-[10px] text-slate-500">{files.length} files</span>
        </div>
        <div className="max-h-[520px] overflow-auto text-[11px] font-mono text-slate-400 space-y-1">
          {files.length ? files.slice(0, 500).map(file => (
            <div key={`${file.webkitRelativePath || file.name}:${file.size}`} className="flex items-center justify-between gap-3 rounded bg-slate-950/40 px-2 py-1">
              <span className="truncate">{file.webkitRelativePath || file.name}</span>
              <span className="text-slate-600 shrink-0">{Math.ceil(file.size / 1024)} KB</span>
            </div>
          )) : (
            <div className="text-slate-600">No textures loaded yet.</div>
          )}
          {files.length > 500 && <div className="text-slate-600">Showing first 500 files. Export still includes all loaded textures.</div>}
        </div>
      </div>
    </div>
  );
}

function parseNumericList(value) {
  return String(value || '').split(',').map(part => {
    const n = Number(part.trim());
    return Number.isFinite(n) ? n : null;
  });
}

function roundedCost(value) {
  return Math.max(20, Math.round(value / 10) * 10);
}

function balanceOneUnit(unit, strength) {
  const copy = JSON.parse(JSON.stringify(unit));
  const cost = parseNumericList(copy.stat_cost);
  if (cost.length < 6 || cost[1] == null || cost[2] == null) return { unit: copy, changed: false, before: copy.stat_cost, after: copy.stat_cost };
  const pri = parseNumericList(copy.stat_pri);
  const armour = parseNumericList(copy.stat_pri_armour);
  const mental = parseNumericList(copy.stat_mental);
  const health = parseNumericList(copy.stat_health);
  const attack = pri[0] ?? 0;
  const charge = pri[1] ?? 0;
  const armourTotal = (armour[0] ?? 0) + (armour[1] ?? 0) + (armour[2] ?? 0);
  const morale = mental[0] ?? 0;
  const hp = Math.max(1, health[0] ?? 1);
  const soldiers = Math.max(1, Number(copy.soldier_num) || 60);
  const category = String(copy.category || '').toLowerCase();
  const className = String(copy.class || '').toLowerCase();
  let multiplier = 1;
  if (category.includes('cavalry')) multiplier *= 1.23;
  if (category.includes('missile')) multiplier *= 1.08;
  if (category.includes('siege') || copy.engine) multiplier *= 1.35;
  if (className.includes('light')) multiplier *= 0.88;
  if (className.includes('heavy')) multiplier *= 1.08;
  const score = soldiers * (attack * 2.05 + charge * 0.85 + armourTotal * 1.55 + morale * 1.75 + hp * 6.5) * multiplier / 10;
  const targetRecruit = roundedCost(Math.max(90, Math.min(2600, score)));
  const targetUpkeep = roundedCost(Math.max(30, targetRecruit * (category.includes('siege') ? 0.22 : 0.28)));
  const nextRecruit = roundedCost(cost[1] * (1 - strength) + targetRecruit * strength);
  const nextUpkeep = roundedCost(cost[2] * (1 - strength) + targetUpkeep * strength);
  cost[0] = nextRecruit > 1600 ? 4 : nextRecruit > 1000 ? 3 : nextRecruit > 420 ? 2 : 1;
  cost[1] = nextRecruit;
  cost[2] = nextUpkeep;
  if (cost[5] != null) cost[5] = nextRecruit;
  copy.stat_cost = cost.map((value, index) => value == null ? (String(unit.stat_cost).split(',')[index] || '0').trim() : String(Math.round(value))).join(', ');
  return { unit: copy, changed: copy.stat_cost !== unit.stat_cost, before: unit.stat_cost, after: copy.stat_cost };
}

function VanillaUnitBalancerTab() {
  const [eduText, setEduText] = useState('');
  const [preset, setPreset] = useState('standard');
  const [report, setReport] = useState('');
  const [status, setStatus] = useState('Load vanilla export_descr_unit.txt or use the currently loaded EDU.');
  const strength = preset === 'light' ? 0.32 : preset === 'strong' ? 0.82 : 0.55;

  const useLoaded = () => {
    const raw = getEduRawText();
    if (raw) {
      setEduText(raw);
      setStatus('Loaded current EDU from the editor.');
    } else {
      setStatus('No current EDU is loaded in the editor.');
    }
  };

  const balance = async () => {
    if (!eduText.trim()) {
      setStatus('Load export_descr_unit.txt first.');
      return;
    }
    const units = parseEDU(eduText);
    const results = units.map(unit => balanceOneUnit(unit, strength));
    const changed = results.filter(item => item.changed);
    const out = serializeEDU(results.map(item => item.unit));
    const lines = [
      `Preset: ${preset}`,
      `Units scanned: ${units.length}`,
      `Units adjusted: ${changed.length}`,
      '',
      ...changed.slice(0, 250).map(item => `${item.unit.type}: ${item.before} -> ${item.after}`),
      changed.length > 250 ? `...${changed.length - 250} more adjusted units` : '',
    ].filter(Boolean).join('\n');
    const zip = new JSZip();
    zip.file('data/export_descr_unit.txt', out);
    zip.file('vanilla_unit_balance_report.txt', toCRLF(lines));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `vanilla_unit_balance_${preset}.zip`);
    setReport(lines);
    setStatus(`Balanced ${changed.length} of ${units.length} units.`);
    try { localStorage.setItem('rtw_tools_last_output', lines); } catch {}
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-3 min-h-0">
      <div className="space-y-3">
        <FileInput label="Load export_descr_unit.txt" accept=".txt" onText={setEduText} />
        <Button variant="outline" className="w-full h-8 text-xs" onClick={useLoaded}>Use loaded EDU</Button>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Balance preset</span>
          <select value={preset} onChange={e => setPreset(e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded px-2 text-xs">
            <option value="standard">Standard vanilla pass</option>
            <option value="light">Light cost smoothing</option>
            <option value="strong">Strong cost rebalance</option>
          </select>
        </label>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={balance} disabled={!eduText.trim()}>
          <Wand2 className="w-3.5 h-3.5" />
          Export balanced EDU
        </Button>
        <p className="text-xs text-amber-300">{status}</p>
        <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-400">
          Adjusts recruitment cost, upkeep, custom battle cost, and recruit turns from unit size, attack, defence, morale, health, class, and category.
        </div>
      </div>
      <pre className="min-h-[560px] overflow-auto rounded border border-slate-700 bg-black/30 p-3 text-[11px] text-slate-300 whitespace-pre-wrap">
        {report || 'Balance report appears here after export.'}
      </pre>
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

export default function RomeTools({ initialTab = 'importer' }) {
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem('rtw_tools_active_tab') || initialTab; } catch { return initialTab; }
  });
  const chooseTab = (next) => {
    setTab(next);
    try { sessionStorage.setItem('rtw_tools_active_tab', next); } catch {}
  };
  const tabs = [
    ['importer', 'Unit Importer', FileText],
    ['mod-copier', 'Mod Copier', FolderOpen],
    ['balancer', 'Unit Balancer', Wand2],
    ['recolor', 'Texture Recolorizer', Wand2],
    ['png-converter', 'PNG Converter', Image],
    ['ai-img2img', 'AI Img2Img', Image],
    ['sprite-logos', 'Sprite Logos', Image],
    ['dmb-slave', 'DMB Textures', FileText],
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
            <div className="flex flex-wrap justify-end gap-1 max-w-[720px]">
              {tabs.map(([id, label, Icon]) => (
                <button key={id} onClick={() => chooseTab(id)}
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
        {tab === 'mod-copier' && <ModCopierTab />}
        {tab === 'balancer' && <VanillaUnitBalancerTab />}
        {tab === 'recolor' && <TextureRecolorTab />}
        {tab === 'png-converter' && <PngConverterTab />}
        {tab === 'ai-img2img' && <AiImageWorkshopTab />}
        {tab === 'sprite-logos' && <SpriteLogoGeneratorTab />}
        {tab === 'dmb-slave' && <DmbSlaveTextureTab />}
        {tab === 'duplicate' && <DuplicatorsTab />}
      </div>
      <div className="h-8 border-t border-slate-800 px-3 flex items-center gap-2 text-[10px] text-slate-500">
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        Local-only tools. No login, no upload.
      </div>
    </div>
  );
}
