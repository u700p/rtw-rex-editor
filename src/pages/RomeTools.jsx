import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Clipboard, Download, FileText, Image, Upload, Wand2, Copy, Search, CheckCircle2 } from 'lucide-react';
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
  return full ? `#${full[1]}${full[2]}${full[3]}`.toLowerCase() : null;
}

function hexToRgb(hex) {
  const normalized = normalizeColorInput(hex) || '#a01e1e';
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 160, g: 30, b: 30 };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
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
  const whiteArmorOrLinen = hsl.l >= 0.56 && hsl.s <= 0.38 && spread <= 82 &&
    r >= 126 && g >= 122 && b >= 112;
  const ivoryHighlight = hsl.l >= 0.72 && hsl.s <= 0.46 && spread <= 86 &&
    r >= 165 && g >= 150 && b >= 125;
  const bronzeOrGold = hsl.h >= 30 && hsl.h <= 62 && hsl.s >= 0.18 && hsl.s <= 0.82 &&
    hsl.l >= 0.18 && hsl.l <= 0.80 && r > b * 1.24 && g > b * 0.94;
  if (skinLike || paleSkinLike) return 'skin';
  if (whiteArmorOrLinen || ivoryHighlight) return 'white_armor';
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
    if (protectedType === 'skin' || protectedType === 'metal' || protectedType === 'white_armor') continue;
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
  tolerance: 24,
  rgbTolerance: 165,
  strength: 90,
  minSat: 22,
  targetMix: 88,
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
};

const AI_IDEA_PARTS = {
  unitRoles: ['royal spearmen', 'desert archers', 'camel scouts', 'harbor militia', 'sacred guard', 'citizen cavalry', 'hill skirmishers', 'temple bodyguards'],
  symbolMotifs: ['crescent and star', 'palm and spear', 'bull horn crown', 'ship prow', 'lion over waves', 'sun disk', 'sacred mountain', 'bronze horse head'],
  materials: ['bronze, linen, dyed wool', 'painted leather and dark iron', 'ivory cloth with bronze trim', 'red wool and polished bronze', 'sea-blue enamel and silver', 'black leather with gold paint'],
  moods: ['disciplined and ancient', 'weathered but elite', 'sacred and royal', 'frontier-born and practical', 'maritime and wealthy', 'nomadic and fast-moving'],
};

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildBingStylePrompt(form, referenceName = 'uploaded reference') {
  const isSymbol = form.mode === 'symbol';
  const faction = form.faction || 'new faction';
  const culture = form.culture || 'ancient Mediterranean';
  const colors = form.colors || 'historically plausible faction colors';
  const subject = isSymbol ? (form.subject || 'faction symbol') : (form.subject || 'unit texture');
  const style = form.style || (isSymbol ? 'RTW faction medallion' : 'RTW unit texture repaint');
  const details = form.details || 'high quality, game-ready, historically plausible';

  return [
    `Image-to-image edit using "${referenceName}" as the strict reference.`,
    isSymbol
      ? `Create a faction symbol/icon for ${faction}, ${culture}. Subject: ${subject}.`
      : `Create a unit image/texture for ${faction}, ${culture}. Unit: ${subject}.`,
    `Style: ${style}. Palette/materials: ${colors}. Details: ${details}.`,
    isSymbol
      ? 'Preserve the uploaded icon composition, transparent background, centered silhouette, circular symbol framing if present, exact readable shape, and strong contrast at 256, 128, 48, and 24 pixel sizes.'
      : 'Preserve the uploaded UV layout, canvas size, alpha, seams, body part placement, folds, baked shadows, silhouettes, and every small texture island. Keep the exact same pose/card framing if the reference is a unit card.',
    'Do not crop, rotate, change UV island positions, add text, invent unrelated objects, alter skin/face pixels unless asked, or repaint metal/white armor unless it is part of the requested faction color change.',
    form.negative ? `Avoid: ${form.negative}.` : 'Avoid modern fantasy, glowing effects, blurry edges, new backgrounds, and layout drift.',
    'Output should look like the same game asset after a careful AI-assisted art pass, not a new unrelated illustration.'
  ].join('\n');
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
    'Do not alter skin, faces, hair, leather, metal armor, white/linen armor, weapons, transparent pixels, UV placement, or the texture layout. Avoid adding new objects or changing the design.',
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
  const draftColor = normalizeColorInput(draft);
  const draftIsValid = !!draftColor;
  useEffect(() => {
    setDraft(value || normalized);
  }, [value, normalized]);

  const commit = () => {
    const next = normalizeColorInput(draft);
    if (next) onChange(next);
    else setDraft(value || normalized);
  };
  const commitPicker = (next) => {
    const normalizedNext = normalizeColorInput(next) || normalized;
    setDraft(normalizedNext);
    onChange(normalizedNext);
  };

  return (
    <div className="block space-y-1">
      <span className="flex items-center justify-between gap-2 text-[10px] uppercase text-slate-500">
        <span className="truncate">{label}</span>
        <span className="font-mono text-[9px] text-slate-600">{normalized.toUpperCase()}</span>
      </span>
      <div className="grid grid-cols-[2.25rem_1fr] items-center gap-1.5">
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
          onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder="#808000 or olive"
          spellCheck={false}
          className={`h-7 min-w-0 px-2 text-[11px] font-mono bg-slate-900 border rounded cursor-text focus:outline-none focus:ring-1 ${draftIsValid ? 'border-slate-700 focus:border-amber-400 focus:ring-amber-400/40' : 'border-red-700/70 text-red-300 focus:border-red-500 focus:ring-red-500/40'}`}
        />
      </div>
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
            onMouseMove={sampleAt}
            onClick={event => sampleAt(event, true)}
            className="w-full max-h-56 object-contain image-render-pixelated cursor-crosshair"
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
  const [status, setStatus] = useState('');

  const update = (key, value) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'mode') {
        next.style = AI_IMAGE_STYLE_PRESETS[value][0];
        next.subject = value === 'symbol' ? 'crescent, palm, and spear faction emblem' : 'elite desert spearman unit texture';
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
      setReference({ name: file.name, width: imageData.width, height: imageData.height, src: imageDataUrl(imageData) });
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

  const downloadKit = () => {
    const kit = {
      mode: form.mode,
      reference: reference ? { name: reference.name, width: reference.width, height: reference.height } : null,
      prompt: prompt || buildBingStylePrompt(form, reference?.name || 'uploaded reference'),
      ideas,
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
          </select>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900/60 p-3 cursor-pointer hover:border-amber-600/60">
          <input type="file" accept=".tga,.dds,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleReference} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load reference image</span>
        </label>
        <TextField label="Faction" value={form.faction} onChange={value => update('faction', value)} />
        <TextField label="Culture combo" value={form.culture} onChange={value => update('culture', value)} />
        <TextField label={form.mode === 'symbol' ? 'Symbol subject' : 'Unit subject'} value={form.subject} onChange={value => update('subject', value)} />
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
              <span className="font-mono text-slate-300 truncate">{reference.name}</span>
              <span>{reference.width}x{reference.height}</span>
            </div>
            <div className="rounded border border-slate-700 bg-black/40 overflow-hidden">
              <img src={reference.src} alt={reference.name} className="w-full h-auto image-render-pixelated" />
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
    ['recolor', 'Texture Recolorizer', Wand2],
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
        {tab === 'recolor' && <TextureRecolorTab />}
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
