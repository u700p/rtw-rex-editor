import React, { useState, useRef, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { Upload, Download, Plus, Trash2, AlertTriangle, Shield, X, Copy, GripVertical, Palette, FileText, Settings, ScrollText, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import BannersTab, { BANNERS_GLOBAL_KEY } from '@/components/factions/BannersTab';
import DescriptionsTab from '@/components/factions/DescriptionsTab';
import MiscTab, { hasFactionNavyEntry, insertFactionNavyEntry } from '@/components/factions/MiscTab';
import FactionSymbolsTab from '@/components/factions/FactionSymbolsTab';
import { textBlob, toCRLF } from '@/lib/lineEndings';
import { parseTextLocFile, serializeTextLocFile, textLocMapToEntries } from '@/lib/textLocParser';
import { ensureRtwFactionLocEntries } from '@/lib/factionLoc';
import { getEduRawText, loadEduRawText, setEduRawText } from '@/lib/eduStorage';
import { parseEDU, serializeEDU } from '@/components/units/EDUParser';
import { getTextLocalizationStore, hydrateTextLocalizationStore, updateTextLocalizationFile } from '@/lib/textLocalizationStore';
import { loadLargeText, saveLargeText } from '@/lib/largeTextStore';

const LS_OFFMAP = 'm2tw_offmap_models';
const LS_GLOBAL_STRINGS = 'rtw_expanded_text_global';
const LS_MENU_STRINGS = 'rtw_menu_text_global';
const LS_UNIT_ASSIGNMENTS = 'm2tw_faction_unit_assignments';
const EXPANDED_BI_FILE = 'expanded_bi.txt';

function normalizeLocKey(key) {
  return String(key || '').trim().replace(/^\{/, '').replace(/\}$/, '');
}

function entriesToText(entries) {
  const map = {};
  for (const entry of entries || []) {
    const key = normalizeLocKey(entry.key);
    if (key) map[key] = entry.value ?? '';
  }
  return serializeTextLocFile(map);
}

function getExpandedStringsData() {
  const store = getTextLocalizationStore();
  const expanded = store[EXPANDED_BI_FILE] || store['expanded.txt'];
  if (expanded?.entries?.length) {
    return {
      entries: expanded.entries.map((entry) => ({
        key: normalizeLocKey(entry.key),
        value: entry.value ?? '',
      })),
      rawText: expanded.rawText || '',
    };
  }

  try {
    const raw = localStorage.getItem(LS_GLOBAL_STRINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        entries: (parsed.entries || parsed || []).map((entry) => ({
          key: normalizeLocKey(entry.key),
          value: entry.value ?? '',
        })),
        rawText: parsed.rawText || '',
      };
    }
  } catch {}

  return { entries: [], rawText: '' };
}

function persistExpandedStrings(entries, rawText = '') {
  const normalizedEntries = (entries || [])
    .map((entry) => ({ key: normalizeLocKey(entry.key), value: entry.value ?? '' }))
    .filter((entry) => entry.key);
  updateTextLocalizationFile(EXPANDED_BI_FILE, {
    entries: normalizedEntries,
    rawText,
    sourceFormat: 'txt',
  });
  try { localStorage.setItem(LS_GLOBAL_STRINGS, JSON.stringify({ entries: normalizedEntries, rawText })); } catch {}
}

/** Inject {UI_FACTION_X} and {UI_FACTION_X_DESCRIPTION} into menu strings if missing */
function injectMenuStringsForFaction(factionName, displayName) {
  try {
    const raw = localStorage.getItem(LS_MENU_STRINGS);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const entries = parsed.entries || [];
    const nameUpper = factionName.toUpperCase();
    const uiKey = `UI_FACTION_${nameUpper}`;
    const descKey = `UI_FACTION_${nameUpper}_DESCRIPTION`;
    let changed = false;
    if (!entries.some(e => e.key === uiKey)) {
      entries.push({ key: uiKey, value: displayName || nameUpper });
      changed = true;
    }
    if (!entries.some(e => e.key === descKey)) {
      entries.push({ key: descKey, value: displayName || factionName });
      changed = true;
    }
    if (changed) {
      localStorage.setItem(LS_MENU_STRINGS, JSON.stringify({ ...parsed, entries }));
      window.dispatchEvent(new CustomEvent('menu-strings-updated'));
    }
  } catch {}
}

function autoInsertNavyEntry(name) {
  try {
    const data = localStorage.getItem(LS_OFFMAP);
    if (!data) return;
    if (hasFactionNavyEntry(data, name)) return;
    const updated = insertFactionNavyEntry(data, name);
    localStorage.setItem(LS_OFFMAP, updated);
    window.dispatchEvent(new CustomEvent('offmap-models-updated'));
  } catch {}
}

function copyEduOwnershipFromFaction(sourceFaction, targetFaction) {
  const src = String(sourceFaction || '').trim();
  const dst = String(targetFaction || '').trim();
  if (!src || !dst || src.toLowerCase() === dst.toLowerCase()) return false;

  const raw = getEduRawText();
  if (!raw) return false;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let changed = false;
  let unitHasSource = false;

  const flushUnit = (block) => {
    if (!unitHasSource) return block;
    unitHasSource = false;
    return block.map((line) => {
      const match = line.match(/^(\s*ownership\s+)([^;]*)(.*)$/i);
      if (!match) return line;
      const owners = match[2].split(',').map(part => part.trim()).filter(Boolean);
      const lowerOwners = owners.map(owner => owner.toLowerCase());
      if (lowerOwners.includes('all') || lowerOwners.includes(dst.toLowerCase())) return line;
      if (!lowerOwners.includes(src.toLowerCase())) return line;
      changed = true;
      return `${match[1]}${[...owners, dst].join(', ')}${match[3] || ''}`;
    });
  };

  const out = [];
  let block = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const startsUnit = /^type\s+/i.test(trimmed) && !/^voice_type\s+/i.test(trimmed);
    if (startsUnit && block.length) {
      out.push(...flushUnit(block));
      block = [];
      unitHasSource = false;
    }
    block.push(line);
    const ownership = line.match(/^\s*ownership\s+([^;]*)/i);
    if (ownership) {
      const owners = ownership[1].split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
      if (owners.includes(src.toLowerCase())) unitHasSource = true;
    }
  }
  if (block.length) out.push(...flushUnit(block));

  if (!changed) return false;
  setEduRawText(out.join('\n'), 'export_descr_unit.txt');
  window.dispatchEvent(new CustomEvent('edu-file-loaded'));
  return true;
}

function appendFactionToRequirementBlocks(rawText, sourceIdentifiers, targetFaction) {
  const dst = String(targetFaction || '').trim();
  if (!rawText || !dst) return { text: rawText || '', changed: false };
  const sourceSet = new Set((sourceIdentifiers || [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter(Boolean));
  if (!sourceSet.size) return { text: rawText, changed: false };

  let changed = false;
  const replaceRequirements = (line) => line.replace(/factions\s*\{([^}]*)\}/gi, (match, body) => {
    const owners = body.split(',').map((part) => part.trim()).filter(Boolean);
    const lowerOwners = owners.map((owner) => owner.toLowerCase());
    if (lowerOwners.includes('all') || lowerOwners.includes(dst.toLowerCase())) return match;
    if (!lowerOwners.some((owner) => sourceSet.has(owner))) return match;
    changed = true;
    const updated = [...owners, dst];
    return `factions { ${updated.join(', ')}, }`;
  });

  const text = String(rawText)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimStart().startsWith(';') ? line : replaceRequirements(line))
    .join('\n');

  return { text, changed };
}

function copyEdbFactionRequirements(sourceFaction, targetFaction, sourceCulture = '') {
  const raw = getStoredText(['m2tw_edb_file', 'm2tw_edb_file_raw']);
  if (!raw) return false;
  const { text, changed } = appendFactionToRequirementBlocks(raw, [sourceFaction, sourceCulture], targetFaction);
  if (!changed) return false;
  try {
    localStorage.setItem('m2tw_edb_file', text);
    localStorage.setItem('m2tw_edb_file_name', 'export_descr_buildings.txt');
    sessionStorage.setItem('m2tw_edb_file_raw', text);
  } catch {}
  saveLargeText('m2tw_edb_file', text, { filename: 'export_descr_buildings.txt' }).catch(() => {});
  window.dispatchEvent(new CustomEvent('edb-file-updated', { detail: { filename: 'export_descr_buildings.txt' } }));
  return true;
}

function replaceWholeWordInsensitive(text, source, target) {
  const src = String(source || '').trim();
  if (!src) return text;
  return String(text || '').replace(new RegExp(`\\b${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), target);
}

function copyRtwBannersText(sourceFaction, targetFaction) {
  const src = String(sourceFaction || '').trim();
  const dst = String(targetFaction || '').trim();
  if (!src || !dst) return false;
  const raw = getStoredText([BANNERS_GLOBAL_KEY, 'm2tw_descr_banners_file', 'm2tw_descr_banners_file_raw']);
  if (!raw || /^\s*</.test(raw)) return false;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const factionLine = (line) => line.match(/^\s*faction\s+(\S+)/i)?.[1] || '';
  if (lines.some((line) => factionLine(line).toLowerCase() === dst.toLowerCase())) return false;

  const start = lines.findIndex((line) => factionLine(line).toLowerCase() === src.toLowerCase());
  if (start < 0) return false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(banner|faction)\s+\S+/i.test(lines[i])) {
      end = i;
      break;
    }
  }

  const block = lines.slice(start, end).map((line, idx) => {
    if (idx === 0) return line.replace(/(\bfaction\s+)\S+/i, `$1${dst}`);
    return replaceWholeWordInsensitive(line, src, dst);
  });
  const comment = `;; ${dst}`;
  const out = [...lines.slice(0, end), '', comment, ...block, ...lines.slice(end)];
  const text = out.join('\n').replace(/\n{4,}/g, '\n\n\n');
  try {
    localStorage.setItem(BANNERS_GLOBAL_KEY, text);
    localStorage.setItem('m2tw_descr_banners_file', text);
  } catch {}
  window.dispatchEvent(new CustomEvent('banners-text-loaded'));
  return true;
}

function copyDescrCharacterEntries(sourceFaction, targetFaction, sourceCulture = '') {
  const raw = getStoredText(['m2tw_descr_character', 'm2tw_descr_character_raw']);
  const dst = String(targetFaction || '').trim();
  if (!raw || !dst) return false;

  const sourcePriority = [sourceFaction, sourceCulture, 'slave']
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const typeStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*type\s+\S+/i.test(lines[i])) typeStarts.push(i);
  }
  if (!typeStarts.length) return false;

  const insertions = [];
  const factionNameAt = (line) => line.match(/^\s*faction\s+(\S+)/i)?.[1]?.replace(/,+$/, '') || '';
  for (let t = 0; t < typeStarts.length; t++) {
    const start = typeStarts[t];
    const end = typeStarts[t + 1] ?? lines.length;
    let targetExists = false;
    const factionBlocks = [];
    for (let i = start + 1; i < end; i++) {
      const faction = factionNameAt(lines[i]);
      if (!faction) continue;
      if (faction.toLowerCase() === dst.toLowerCase()) targetExists = true;
      let blockEnd = end;
      for (let j = i + 1; j < end; j++) {
        if (/^\s*(faction|type)\s+\S+/i.test(lines[j])) {
          blockEnd = j;
          break;
        }
      }
      factionBlocks.push({ faction, start: i, end: blockEnd });
      i = blockEnd - 1;
    }
    if (targetExists) continue;
    const sourceBlock = sourcePriority
      .map((source) => factionBlocks.find((block) => block.faction.toLowerCase() === source))
      .find(Boolean);
    if (!sourceBlock) continue;
    const block = lines.slice(sourceBlock.start, sourceBlock.end).map((line, idx) =>
      idx === 0 ? line.replace(/(\bfaction\s+)\S+/i, `$1${dst}`) : line
    );
    insertions.push({ at: sourceBlock.end, block: ['', `;; ${dst}`, ...block] });
  }

  if (!insertions.length) return false;
  const out = [...lines];
  for (const insertion of insertions.reverse()) {
    out.splice(insertion.at, 0, ...insertion.block);
  }
  const text = out.join('\n');
  try {
    localStorage.setItem('m2tw_descr_character', text);
    sessionStorage.setItem('m2tw_descr_character_raw', text);
  } catch {}
  window.dispatchEvent(new CustomEvent('strat-model-files-loaded', { detail: { key: 'descr_character', text, filename: 'descr_character.txt' } }));
  return true;
}

function tokenizeProfile(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9_]+/g) || [])];
}

function unitSearchText(unit) {
  return [
    unit.type, unit.dictionary, unit.dictionaryComment, unit.category, unit.class,
    unit.voice_type, unit.soldier_model, unit.attributes?.join(' '),
  ].join(' ').toLowerCase();
}

function isGeneralUnit(unit) {
  const haystack = unitSearchText(unit);
  const attrs = new Set(unit.attributes || []);
  return attrs.has('general_unit') || /\b(general|bodyguard|named character|family member)\b/i.test(haystack);
}

function scoreSlaveUnit(unit, tokens) {
  const haystack = unitSearchText(unit);
  let score = 0;
  for (const token of tokens) {
    if (token.length > 2 && haystack.includes(token)) score += token.length >= 6 ? 5 : 3;
  }
  const profile = new Set(tokens);
  const attrs = new Set(unit.attributes || []);
  const isCav = /cavalry|horse|mounted|chariot|camel/.test(haystack) || !!unit.mount;
  const isMissile = /archer|slinger|peltast|javelin|bow|missile/.test(haystack) || /missile|arrow|javelin|pilum/.test(unit.stat_pri || '');
  const isSpear = /spear|hoplite|phalanx|pike/.test(haystack) || attrs.has('spear') || attrs.has('pike');
  const isLight = unit.class === 'light' || /light|skirmish|peltast/.test(haystack);
  const isHeavy = unit.class === 'heavy' || /heavy|elite|guard|noble/.test(haystack);
  if ((profile.has('cavalry') || profile.has('horse') || profile.has('mounted')) && isCav) score += 18;
  if ((profile.has('archer') || profile.has('missile') || profile.has('ranged')) && isMissile) score += 16;
  if ((profile.has('spear') || profile.has('hoplite') || profile.has('phalanx')) && isSpear) score += 14;
  if ((profile.has('light') || profile.has('skirmish')) && isLight) score += 8;
  if ((profile.has('heavy') || profile.has('elite')) && isHeavy) score += 8;
  if ((profile.has('desert') || profile.has('arabian') || profile.has('eastern')) && /east|desert|arab|camel/.test(haystack)) score += 12;
  if ((profile.has('greek') || profile.has('hellenic')) && /greek|hoplite|peltast|phalanx/.test(haystack)) score += 12;
  if ((profile.has('roman') || profile.has('italian')) && /roman|italian|legion/.test(haystack)) score += 12;
  if ((profile.has('barbarian') || profile.has('tribal')) && /barb|warband|celt|german/.test(haystack)) score += 12;
  if (unit.category === 'ship' || unit.category === 'siege') score -= 12;
  return score;
}

function getAssignmentStore() {
  try { return JSON.parse(localStorage.getItem(LS_UNIT_ASSIGNMENTS) || '{}'); } catch { return {}; }
}

function saveAssignmentStore(store) {
  try { localStorage.setItem(LS_UNIT_ASSIGNMENTS, JSON.stringify(store || {})); } catch {}
}

function buildUnitAssignmentReport() {
  const assignments = getAssignmentStore();
  const lines = ['RTW unit assignment report', ''];
  const values = Object.values(assignments);
  if (!values.length) return '';
  for (const assignment of values) {
    const units = assignment.units || [];
    lines.push(`${assignment.faction}: ${units.length} units`);
    lines.push(`profile: ${assignment.profile || assignment.faction}`);
    lines.push(`ui cards: ${assignment.packUi ? 'pack when source files are loaded' : 'skip'}`);
    for (const unit of units) {
      const general = unit.isGeneral ? ' general_unit' : '';
      lines.push(`- ${unit.type}${general} (${unit.dictionary || unit.type}) score ${unit.score ?? 0}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function assignSlaveUnitsToFaction(targetFaction, profileText, options = {}) {
  const dst = String(targetFaction || '').trim();
  const raw = getEduRawText();
  if (!dst || !raw) return { changed: false, count: 0, units: [] };
  const units = parseEDU(raw);
  const tokens = tokenizeProfile(`${profileText || ''} ${dst}`);
  const targetCount = Math.max(1, Number(options.count) || 13);
  const candidates = units
    .map((unit, index) => ({ unit, index, owners: (unit.ownership || []).map((owner) => owner.toLowerCase()) }))
    .filter(({ owners }) => owners.includes('slave') && !owners.includes(dst.toLowerCase()) && !owners.includes('all'))
    .map((entry) => ({ ...entry, score: scoreSlaveUnit(entry.unit, tokens) }))
    .sort((a, b) => b.score - a.score || String(a.unit.type).localeCompare(String(b.unit.type)));
  const positive = candidates.filter((entry) => entry.score > 0);
  const pool = positive.length >= targetCount ? positive : candidates;
  const general = pool.find((entry) => isGeneralUnit(entry.unit)) || candidates.find((entry) => isGeneralUnit(entry.unit));
  const selected = [];
  if (general) selected.push(general);
  for (const entry of pool) {
    if (selected.length >= targetCount) break;
    if (general && entry.index === general.index) continue;
    selected.push(entry);
  }
  if (selected.length < targetCount) {
    for (const entry of candidates) {
      if (selected.length >= targetCount) break;
      if (selected.some((selectedEntry) => selectedEntry.index === entry.index)) continue;
      selected.push(entry);
    }
  }
  if (!selected.length) return { changed: false, count: 0, units: [] };

  for (const { unit } of selected) {
    unit.ownership = [...(unit.ownership || []), dst];
  }
  setEduRawText(serializeEDU(units), 'export_descr_unit.txt');
  window.dispatchEvent(new CustomEvent('edu-file-loaded'));

  const assignedUnits = selected.map(({ unit, score }) => ({
    type: unit.type,
    dictionary: unit.dictionary || unit.type,
    score,
    source: 'slave',
    isGeneral: isGeneralUnit(unit),
  }));
  const store = getAssignmentStore();
  store[dst] = {
    faction: dst,
    source: 'slave',
    profile: String(profileText || dst),
    packUi: options.packUi !== false,
    units: assignedUnits,
    updatedAt: Date.now(),
  };
  saveAssignmentStore(store);
  const generalAssigned = assignedUnits.some((unit) => unit.isGeneral);
  return { changed: true, count: assignedUnits.length, units: assignedUnits, generalAssigned };
}

function getUnitImageFileFor(dictionary, sourceFaction, kind) {
  const dict = String(dictionary || '').toLowerCase().replace(/^#/, '');
  const source = String(sourceFaction || 'slave').toLowerCase();
  if (!dict || typeof window === 'undefined') return null;
  const fileMap = window._m2tw_unit_image_file_map || {};
  const suffixes = kind === 'info'
    ? [`/unit_info/${source}/${dict}_info`, `/unit_info/${source}/#${dict}_info`]
    : [`/units/${source}/#${dict}`, `/units/${source}/${dict}`];
  for (const [key, file] of Object.entries(fileMap)) {
    const normalized = String(key || '').toLowerCase().replace(/\\/g, '/').replace(/\.tga$/i, '');
    if (suffixes.some((suffix) => normalized.endsWith(suffix))) return file;
  }
  return null;
}

async function addAssignedUnitUiFilesToZip(zip, included) {
  const assignments = getAssignmentStore();
  const used = new Set();
  for (const assignment of Object.values(assignments)) {
    if (!assignment?.packUi) continue;
    const faction = String(assignment.faction || '').trim();
    if (!faction) continue;
    for (const unit of assignment.units || []) {
      const dict = String(unit.dictionary || unit.type || '').toLowerCase().replace(/^#/, '');
      if (!dict) continue;
      const sourceFaction = unit.source || assignment.source || 'slave';
      const cardFile = getUnitImageFileFor(dict, sourceFaction, 'card');
      if (cardFile) {
        const path = `data/ui/units/${faction}/#${dict}.tga`;
        if (!used.has(path)) {
          zip.file(path, cardFile);
          included.push(path);
          used.add(path);
        }
      }
      const infoFile = getUnitImageFileFor(dict, sourceFaction, 'info');
      if (infoFile) {
        const path = `data/ui/unit_info/${faction}/${dict}_info.tga`;
        if (!used.has(path)) {
          zip.file(path, infoFile);
          included.push(path);
          used.add(path);
        }
      }
    }
  }
}

const VANILLA_FACTION_LIMIT = 31;
const LS_KEY = 'm2tw_sm_factions_raw';
const LS_CULT = 'm2tw_cultures_list';
const LS_REL = 'm2tw_religions_list';
const LS_UNITS = 'm2tw_edu_units_list';

function saveFactionsRaw(text, filename = '') {
  try { localStorage.setItem(LS_KEY, text); } catch {}
  try { localStorage.setItem('m2tw_factions_file', text); } catch {}
  try { localStorage.setItem('m2tw_factions_raw', text); } catch {}
  try { sessionStorage.setItem('m2tw_factions_raw', text); } catch {}
  if (filename) {
    try { localStorage.setItem('m2tw_factions_file_name', filename); } catch {}
  }
}

function saveFactionAutomationReport(lines) {
  const report = (lines || []).filter(Boolean).join('\n');
  try { localStorage.setItem('m2tw_faction_automation_report', report); } catch {}
  return report;
}

function saveEduRaw(text, filename = '') {
  const list = parseEduUnits(text);
  try { localStorage.setItem(LS_UNITS, JSON.stringify(list)); } catch {}
  setEduRawText(text, filename);
}

const FACTION_SETUP_DATA_FILES = [
  { path: 'data/descr_building_battle.txt', sources: ['m2tw_descr_building_battle_file', 'm2tw_descr_building_battle_file_raw'] },
  { path: 'data/descr_character.txt', sources: ['m2tw_descr_character', 'm2tw_descr_character_raw'] },
  { path: 'data/descr_formations_ai.txt', sources: ['m2tw_descr_formations_ai_file', 'm2tw_descr_formations_ai_file_raw'] },
  { path: 'data/descr_lbc_db.txt', sources: ['m2tw_descr_lbc_db_file', 'm2tw_descr_lbc_db_file_raw'] },
  { path: 'data/descr_model_battle.txt', sources: ['m2tw_descr_model_battle_file', 'm2tw_modeldb_file'] },
  { path: 'data/descr_model_strat.txt', sources: ['m2tw_descr_model_strat', 'm2tw_descr_model_strat_raw'] },
  { path: 'data/descr_names.txt', sources: ['m2tw_descr_names_raw', 'm2tw_names_file'] },
  { path: 'data/descr_offmap_models.txt', sources: [LS_OFFMAP, 'm2tw_offmap_models_raw'] },
  { path: 'data/descr_standards.txt', sources: ['m2tw_descr_standards_file', 'm2tw_descr_standards_file_raw'] },
  { path: 'data/descr_ui_buildings.txt', sources: ['m2tw_descr_ui_buildings_file', 'm2tw_descr_ui_buildings_file_raw'] },
  { path: 'data/export_descr_buildings.txt', sources: ['m2tw_edb_file'] },
];

const FACTION_SETUP_WORLD_FILES = [
  { path: 'data/world/maps/base/descr_strat.txt', sources: ['m2tw_strat_raw'] },
  { path: 'data/world/maps/base/descr_regions.txt', sources: ['m2tw_regions_raw'] },
  { path: 'data/world/maps/base/descr_win_conditions.txt', sources: ['m2tw_win_conditions_raw', 'm2tw_campaign_win_conditions'] },
];

function getStoredText(sources) {
  for (const key of sources || []) {
    try {
      const sessionValue = sessionStorage.getItem(key);
      if (sessionValue) return sessionValue;
    } catch {}
    try {
      const localValue = localStorage.getItem(key);
      if (localValue) return localValue;
    } catch {}
  }
  return '';
}

function addCRLFText(zip, path, text, included) {
  if (!text) return false;
  zip.file(path, toCRLF(text));
  included.push(path);
  return true;
}

function addStoredText(zip, path, sources, included) {
  return addCRLFText(zip, path, getStoredText(sources), included);
}

function getStoredLocEntries(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.entries || parsed || [];
  } catch {
    return [];
  }
}

function getTextFileFromStore(name) {
  const store = getTextLocalizationStore();
  const data = store[name];
  if (!data?.entries?.length && !data?.rawText) return '';
  return data.rawText || entriesToText(data.entries);
}

function buildFactionSetupManifest(included) {
  const includedSet = new Set(included);
  const expected = [
    'data/descr_sm_factions.txt',
    'data/descr_banners.txt',
    ...FACTION_SETUP_DATA_FILES.map((f) => f.path),
    'data/export_descr_unit.txt',
    'data/text/campaign_descriptions.txt',
    'data/text/expanded_bi.txt',
    'data/text/names.txt',
    ...FACTION_SETUP_WORLD_FILES.map((f) => f.path),
  ];
  const missing = expected.filter((path) => !includedSet.has(path));
  return [
    'RTW faction setup export',
    '',
    'Included:',
    ...(included.length ? included.map((path) => `+ ${path}`) : ['- Nothing was loaded yet.']),
    '',
    'Not included because it was not loaded/cached:',
    ...(missing.length ? missing.map((path) => `- ${path}`) : ['- All checklist files that the editor can export were included.']),
    '',
    'Still manual:',
    '- Graphical assets: faction symbols, loading screens, UI cards, models, banners, standards, and any new CAS/TGA/DDS files.',
    '- descr_strat.txt playability/placement and descr_regions.txt ownership still need a human check after faction duplication.',
    '- If adding new names, verify data/descr_names.txt and data/text/names.txt entries in game.',
  ].join('\n');
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
};
const parseColour = (v) => {
  const m = v.match(/red\s+(\d+)[,\s]+green\s+(\d+)[,\s]+blue\s+(\d+)/i);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 0, g: 0, b: 0 };
};

// ── Reference file parsers ────────────────────────────────────────────────────
function parseCultures(text) {
  const cultures = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^culture\s+(\S+)/i);
    if (m) cultures.push(m[1]);
  }
  return [...new Set(cultures)].sort();
}

function parseReligions(text) {
  const religions = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^religion\s+(\S+)/i);
    if (m) religions.push(m[1]);
  }
  return [...new Set(religions)].sort();
}

function parseEduUnits(text) {
  const units = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^type\s+(.+)/i);
    if (m) units.push(m[1].trim());
  }
  return [...new Set(units)].sort();
}

// ── Main faction parser ───────────────────────────────────────────────────────
function parseDescrSmFactions(text) {
  const factions = [];
  const lines = text.split('\n');
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;

    const factionMatch = line.match(/^faction\s+([^,\s]+)(?:\s*,\s*(spawned_on_event|shadowing|shadowed_by)(?:\s+(\S+))?)?/i);
    if (factionMatch) {
      if (current) factions.push(current);
      current = {
        name: factionMatch[1].trim(),
        spawn_type: factionMatch[2] || 'default',
        shadow_faction: factionMatch[3] || '',
        culture: '',
        religion: '',
        symbol: '',
        rebel_symbol: '',
        primary_colour: { r: 0, g: 0, b: 0 },
        secondary_colour: { r: 0, g: 0, b: 0 },
        tertiary_colour: undefined,
        loading_logo: '',
        standard_index: 0,
        logo_index: '',
        small_logo_index: '',
        triumph_value: '5',
        custom_battle_availability: 'yes',
        can_sap: 'no',
        prefers_naval_invasions: 'no',
        can_horde: false,
        horde_min_units: 0,
        horde_max_units: 0,
        horde_max_units_reduction_every_horde: 0,
        horde_unit_per_settlement_population: 0,
        horde_min_named_characters: 0,
        horde_max_percent_army_stack: 0,
        horde_disband_percent_on_settlement_capture: 0,
        horde_units: []
      };
      continue;
    }

    if (!current) continue;

    const m = line.match(/^(\S+)\s*(.*)/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();

    switch (key) {
      case 'culture':current.culture = val;break;
      case 'religion':current.religion = val;break;
      case 'symbol':current.symbol = val;break;
      case 'rebel_symbol':current.rebel_symbol = val;break;
      case 'primary_colour':
      case 'primary_color':current.primary_colour = parseColour(val);break;
      case 'secondary_colour':
      case 'secondary_color':current.secondary_colour = parseColour(val);break;
      case 'tertiary_colour':
      case 'tertiary_color':current.tertiary_colour = parseColour(val);break;
      case 'loading_logo':current.loading_logo = val;break;
      case 'standard_index':current.standard_index = parseInt(val) || 0;break;
      case 'logo_index':current.logo_index = val;break;
      case 'small_logo_index':current.small_logo_index = val;break;
      case 'triumph_value':current.triumph_value = val;break;
      case 'custom_battle_availability':current.custom_battle_availability = val;break;
      case 'can_sap':current.can_sap = val;break;
      case 'prefers_naval_invasions':current.prefers_naval_invasions = val;break;
      case 'can_have_princess':
      case 'has_princess':
      case 'has_family_tree':
      case 'can_have_family_tree':break;
      case 'horde_min_units':current.can_horde = true;current.horde_min_units = +val || 0;break;
      case 'horde_max_units':current.horde_max_units = +val || 0;break;
      case 'horde_max_units_reduction_every_horde':current.horde_max_units_reduction_every_horde = +val || 0;break;
      case 'horde_unit_per_settlement_population':current.horde_unit_per_settlement_population = +val || 0;break;
      case 'horde_min_named_characters':current.horde_min_named_characters = +val || 0;break;
      case 'horde_max_percent_army_stack':current.horde_max_percent_army_stack = +val || 0;break;
      case 'horde_disband_percent_on_settlement_capture':current.horde_disband_percent_on_settlement_capture = +val || 0;break;
      case 'horde_unit':current.horde_units.push(val);break;
      default:
        break;
    }
  }
  if (current) factions.push(current);
  return factions;
}

// ── Serialiser ────────────────────────────────────────────────────────────────
function serialiseDescrSmFactions(factions) {
  const HEADER = `;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; faction description
;;  logo_index          gets resolved from STRATEGY_SPRITE_PAGE
;;  small_logo_index    gets resolved from SHARED_SPRITE_PAGE
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

`;
  const SEP = '\n;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;\n\n';
  const T = '\t\t\t\t\t\t';
  const T5 = '\t\t\t\t\t';
  const T4 = '\t\t\t\t';
  const T3 = '\t\t\t';
  const fmtC = (c) => `red ${c.r}, green ${c.g}, blue ${c.b}`;

  const lines = (f) => {
    const nameUpper = f.name.toUpperCase();
    const symbolVal = f.symbol || `models_strat/symbol_${f.name}.CAS`;
    const loadingLogoVal = f.loading_logo || `loading_screen/symbols/symbol128_${f.name}.tga`;
    const logoIndexVal = f.logo_index || `FACTION_LOGO_${nameUpper}`;
    const smallLogoIndexVal = f.small_logo_index || `SMALL_FACTION_LOGO_${nameUpper}`;

    let factionLine = `faction${T}${f.name}`;
    if (f.spawn_type === 'spawned_on_event') {
      factionLine += ', spawned_on_event';
    } else if (f.spawn_type === 'shadowing' && f.shadow_faction) {
      factionLine += `, shadowing ${f.shadow_faction}`;
    } else if (f.spawn_type === 'shadowed_by' && f.shadow_faction) {
      factionLine += `, shadowed_by ${f.shadow_faction}`;
    }

    const rows = [
    factionLine,
    `culture${T}${f.culture}`,
    f.religion?.trim() ? `religion${T5}${f.religion.trim()}` : null,
    `symbol${T}${symbolVal}`,
    f.rebel_symbol ? `rebel_symbol${T4}${f.rebel_symbol}` : null,
    `primary_colour${T4}${fmtC(f.primary_colour)}`,
    `secondary_colour${T3}${fmtC(f.secondary_colour)}`,
    f.tertiary_colour ? `tertiary_colour${T3}${fmtC(f.tertiary_colour)}` : null,
    `loading_logo${T4}${loadingLogoVal}`,
    f.standard_index !== 0 ? `standard_index${T4}${f.standard_index}` : null,
    `logo_index${T5}${logoIndexVal}`,
    `small_logo_index${T3}${smallLogoIndexVal}`,
    f.triumph_value ? `triumph_value${T4}${f.triumph_value}` : null,
    `custom_battle_availability\t${f.custom_battle_availability}`,
    ...(f.can_horde ? [
    `horde_min_units${T3}${f.horde_min_units}`,
    `horde_max_units${T3}${f.horde_max_units}`,
    `horde_max_units_reduction_every_horde\t${f.horde_max_units_reduction_every_horde}`,
    `horde_unit_per_settlement_population\t${f.horde_unit_per_settlement_population}`,
    `horde_min_named_characters${T3}${f.horde_min_named_characters}`,
    `horde_max_percent_army_stack${T}${f.horde_max_percent_army_stack}`,
    `horde_disband_percent_on_settlement_capture\t${f.horde_disband_percent_on_settlement_capture}`,
    ...(f.horde_units || []).map((u, idx) => `horde_unit${T4}${u}${idx === 0 && f.can_horde ? ' ; general_unit required' : ''}`)] :
    []),
    `can_sap${T}${f.can_sap}`,
    `prefers_naval_invasions\t\t${f.prefers_naval_invasions}`].
    filter((r) => r !== null);
    return rows.join('\n');
  };

  return HEADER + factions.map(lines).join(SEP) + '\n';
}

// ── Colour Picker with modal ──────────────────────────────────────────────────
function ColourPickerField({ label, colour, onChange }) {
  const c = colour || { r: 0, g: 0, b: 0 };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(c);
  const hex = rgbToHex(c);

  const openPicker = () => {setDraft({ ...c });setOpen(true);};
  const confirm = () => {onChange(draft);setOpen(false);};

  return (
    <>
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-[10px] text-slate-300 w-40 shrink-0">{label}</span>
        <button onClick={openPicker} className="flex items-center gap-2 group">
          <div className="w-7 h-5 rounded border border-slate-600 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
          style={{ background: hex }} />
          <span className="text-[10px] font-mono text-slate-200 group-hover:text-white">{hex.toUpperCase()} &nbsp; rgb({c.r},{c.g},{c.b})</span>
        </button>
      </div>
      {open &&
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-5 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-200">{label}</span>
              <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="w-full h-16 rounded-lg border border-slate-700 mb-4" style={{ background: rgbToHex(draft) }} />
            <div className="flex items-center gap-3 mb-3">
              <input type="color" value={rgbToHex(draft)}
            onChange={(e) => setDraft(hexToRgb(e.target.value))}
            className="w-12 h-8 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-[10px] font-mono text-slate-200">{rgbToHex(draft).toUpperCase()}</span>
            </div>
            {[['r', 'R', '#ef4444'], ['g', 'G', '#22c55e'], ['b', 'B', '#3b82f6']].map(([ch, lbl, col]) =>
          <div key={ch} className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold w-4 shrink-0" style={{ color: col }}>{lbl}</span>
                <input type="range" min={0} max={255} value={draft[ch]}
            onChange={(e) => setDraft((d) => ({ ...d, [ch]: +e.target.value }))}
            className="flex-1 h-2 accent-current cursor-pointer" style={{ accentColor: col }} />
                <input type="number" min={0} max={255} value={draft[ch]}
            onChange={(e) => setDraft((d) => ({ ...d, [ch]: Math.max(0, Math.min(255, +e.target.value || 0)) }))}
            className="w-12 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-center text-slate-200" />
              </div>
          )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="flex-1 py-1.5 text-[11px] rounded border border-slate-500 text-slate-200 hover:text-white hover:border-slate-300">Cancel</button>
              <button onClick={confirm} className="flex-1 py-1.5 text-[11px] rounded bg-blue-700 hover:bg-blue-600 text-white font-semibold">OK</button>
            </div>
          </div>
        </div>
      }
    </>);

}

// ── Yes/No toggle ─────────────────────────────────────────────────────────────
function YesNo({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-slate-300">{label}</span>
      <div className="flex rounded overflow-hidden border border-slate-600">
        {['yes', 'no'].map((opt) =>
        <button key={opt} onClick={() => onChange(opt)}
        className={`px-2 py-0.5 text-[10px] transition-colors ${value === opt ? 'bg-primary text-primary-foreground' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
            {opt}
          </button>
        )}
      </div>
    </div>);

}

// ── Dropdown or text input ────────────────────────────────────────────────────
function SelectOrInput({ label, value, onChange, options, placeholder, allowBlank = false }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <label className="text-[10px] text-slate-300 w-40 shrink-0">{label}</label>
      {options && options.length > 0 ?
      <select value={value} onChange={(e) => onChange(e.target.value)}
      className="flex-1 h-6 text-[11px] px-2 rounded border border-slate-600 bg-slate-700 text-slate-100 font-mono">
          {allowBlank && <option value="">— none —</option>}
          {!options.includes(value) && value && <option value={value}>{value} (custom)</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select> :

      <Input className="h-6 text-[11px] px-2 flex-1 font-mono bg-slate-700 border-slate-600 text-slate-100" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      }
    </div>);

}

// ── Horde Units list editor ───────────────────────────────────────────────────
function HordeUnitsEditor({ units, onChange, eduUnits }) {
  const [custom, setCustom] = useState('');
  const add = (u) => {if (u && !units.includes(u)) onChange([...units, u]);setCustom('');};
  const remove = (i) => onChange(units.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 min-h-6">
        {units.map((u, i) =>
        <span key={i} className="inline-flex items-center gap-1 bg-amber-900/40 border border-amber-700 rounded px-1.5 py-0.5 text-[9px] font-mono text-amber-300">
            {u}
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-300 leading-none ml-0.5">×</button>
          </span>
        )}
        {units.length === 0 && <span className="text-[10px] text-red-400 italic">At least 1 unit required</span>}
      </div>
      <div className="flex gap-1">
        {eduUnits && eduUnits.length > 0 ?
        <select className="flex-1 h-6 text-[10px] px-1 rounded border border-slate-700 bg-slate-800 text-slate-100 font-mono"
        value="" onChange={(e) => add(e.target.value)}>
            <option value="">— add unit from EDU —</option>
            {eduUnits.filter((u) => !units.includes(u)).map((u) => <option key={u} value={u}>{u}</option>)}
          </select> :

        <>
            <Input className="flex-1 h-6 text-[10px] px-1 font-mono bg-slate-800 border-slate-700 text-slate-100" value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="unit type name…" onKeyDown={(e) => e.key === 'Enter' && add(custom.trim())} />
            <button onClick={() => add(custom.trim())}
          className="text-[10px] px-2 rounded border border-green-800 text-green-400 hover:bg-green-900/30">Add</button>
          </>
        }
      </div>
    </div>);

}

// ── Faction detail panel ──────────────────────────────────────────────────────
function FactionDetail({ faction, onChange, cultures, religions, eduUnits, onAssignUnits, onSave, onCancel }) {
  const [draft, setDraft] = useState({ ...faction });
  const [activeTab, setActiveTab] = useState('stratmap');
  const [tertiaryEnabled, setTertiaryEnabled] = useState(!!faction.tertiary_colour);
  const [unitAssignDescription, setUnitAssignDescription] = useState(`${faction.culture || ''} ${faction.name || ''}`.trim());
  const [unitAssignResult, setUnitAssignResult] = useState(null);
  const set = (key, val) => setDraft({ ...draft, [key]: val });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft({ ...faction });
    setTertiaryEnabled(!!faction.tertiary_colour);
    setUnitAssignDescription(`${faction.culture || ''} ${faction.name || ''}`.trim());
    setUnitAssignResult(null);
  }, [faction]);
  const handleSave = () => {
    onChange(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const handleCancel = () => { setDraft({ ...faction }); onCancel?.(); };
  const nameUpper = (draft.name || '').toUpperCase();
  const defaultLogo = `FACTION_LOGO_${nameUpper}`;
  const defaultSmallLogo = `SMALL_FACTION_LOGO_${nameUpper}`;
  const runUnitAssignment = () => {
    const result = onAssignUnits?.(draft.name, `${unitAssignDescription} ${draft.culture || ''} ${draft.name || ''}`.trim());
    setUnitAssignResult(result || { count: 0, generalAssigned: false });
  };

  const hordeIntField = (key, label) =>
  <div key={key} className="flex items-center gap-3">
      <label className="text-[10px] text-slate-300 w-60 shrink-0">{label}</label>
      <input type="number" min={0}
    value={faction[key] ?? 0}
    onChange={(e) => set(key, +e.target.value || 0)}
    className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-slate-100" />
    </div>;


  return (
    <ScrollArea className="h-full">
      <div className="p-4 max-w-xl">
        <div className="flex items-center justify-between border-b border-slate-600 pb-2 mb-4">
          <h2 className="text-sm font-semibold text-slate-200">Edit Faction: {draft.name}</h2>
          <div className="flex gap-2">
            <button onClick={handleCancel} className="px-3 py-1 text-[10px] rounded border border-slate-600 text-slate-300 hover:bg-slate-700">Reset</button>
            <button onClick={handleSave} className={`px-3 py-1 text-[10px] rounded font-semibold transition-colors ${saved ? 'bg-emerald-600 text-white' : 'bg-green-700 hover:bg-green-600 text-white'}`}>
              {saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-4">
            <TabsTrigger value="stratmap" className="text-[10px]"><Palette className="w-3 h-3 mr-1" />Stratmap</TabsTrigger>
            <TabsTrigger value="banners" className="text-[10px]"><FileText className="w-3 h-3 mr-1" />Banners</TabsTrigger>
            <TabsTrigger value="descriptions" className="text-[10px]"><ScrollText className="w-3 h-3 mr-1" />Descriptions</TabsTrigger>
            <TabsTrigger value="misc" className="text-[10px]"><Settings className="w-3 h-3 mr-1" />Misc</TabsTrigger>
            <TabsTrigger value="symbols" className="text-[10px]"><Image className="w-3 h-3 mr-1" />Symbols</TabsTrigger>
          </TabsList>

          <TabsContent value="stratmap" className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Identity</h3>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-slate-300 w-40 shrink-0">Internal Name</label>
            <Input className="h-6 text-[11px] px-2 flex-1 font-mono bg-slate-700 border-slate-600 text-slate-100" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-slate-300 w-40 shrink-0">Type</label>
            <select value={draft.spawn_type || 'default'} onChange={(e) => set('spawn_type', e.target.value)}
            className="flex-1 h-6 text-[11px] px-2 rounded border border-slate-600 bg-slate-700 text-slate-100 font-mono">
              <option value="default">default</option>
              <option value="spawned_on_event">spawned_on_event</option>
              <option value="shadowing">shadowing</option>
              <option value="shadowed_by">shadowed_by</option>
            </select>
          </div>
          {(draft.spawn_type === 'shadowing' || draft.spawn_type === 'shadowed_by') &&
          <div className="flex items-center gap-3">
              <label className="text-[10px] text-slate-300 w-40 shrink-0">Shadow Faction</label>
              <Input className="h-6 text-[11px] px-2 flex-1 font-mono bg-slate-700 border-slate-600 text-slate-100" value={draft.shadow_faction ?? ''} onChange={(e) => set('shadow_faction', e.target.value)} placeholder="e.g. england" />
            </div>
          }
          <SelectOrInput label="Culture" value={draft.culture} onChange={(v) => set('culture', v)} options={cultures} placeholder="e.g. roman" />
          <SelectOrInput label="Religion" value={draft.religion} onChange={(v) => set('religion', v)} options={religions} placeholder="optional" allowBlank />
        </section>

        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Unit Assigner</h3>
          <textarea
            value={unitAssignDescription}
            onChange={(e) => setUnitAssignDescription(e.target.value)}
            placeholder="e.g. Egyptian/Greek infantry, archers, light cavalry"
            className="w-full h-16 bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] text-slate-500">Adds exactly 13 slave-owned EDU units when possible and prioritizes a general_unit.</p>
            <button
              type="button"
              onClick={runUnitAssignment}
              className="px-3 py-1 text-[10px] rounded border border-amber-700 text-amber-200 hover:bg-amber-900/30 shrink-0"
            >
              Assign 13 Units
            </button>
          </div>
          {unitAssignResult && (
            <p className={`text-[10px] ${unitAssignResult.count ? 'text-green-300' : 'text-red-300'}`}>
              {unitAssignResult.count ? `Assigned ${unitAssignResult.count} units${unitAssignResult.generalAssigned ? ' including a general.' : '.'}` : 'No slave-owned EDU units were available to assign.'}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Colours</h3>
          <ColourPickerField label="Primary Colour" colour={draft.primary_colour} onChange={(v) => set('primary_colour', v)} />
          <ColourPickerField label="Secondary Colour" colour={draft.secondary_colour} onChange={(v) => set('secondary_colour', v)} />
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-[10px] text-slate-300 w-40 shrink-0">Tertiary Colour (M2EX only)</span>
            <button
              onClick={() => {
                if (tertiaryEnabled) {
                  const { tertiary_colour, ...rest } = draft;
                  setDraft(rest);
                  setTertiaryEnabled(false);
                } else {
                  setDraft({ ...draft, tertiary_colour: draft.tertiary_colour || { r: 0, g: 0, b: 0 } });
                  setTertiaryEnabled(true);
                }
              }}
              className={`px-2 py-0.5 text-[9px] rounded border ${tertiaryEnabled ? 'bg-green-700 border-green-600 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}
            >
              {tertiaryEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          {tertiaryEnabled && (
            <ColourPickerField label="Tertiary Colour" colour={draft.tertiary_colour || { r: 0, g: 0, b: 0 }} onChange={(v) => set('tertiary_colour', v)} />
          )}
          <p className="text-[9px] text-amber-300 mt-1">⚠ Tertiary colour only works with M2EX</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Files & Indices</h3>
          {[
          ['symbol', 'Symbol (.CAS)', `models_strat/symbol_${draft.name}.CAS`],
          ['rebel_symbol', 'Rebel Symbol (.CAS)', ''],
          ['loading_logo', 'Loading Logo (.tga)', `loading_screen/symbols/symbol128_${draft.name}.tga`],
          ['standard_index', 'Standard Index', ''],
          ['triumph_value', 'Triumph Value', ''],
          ['logo_index', 'Logo Index', defaultLogo],
          ['small_logo_index', 'Small Logo Index', defaultSmallLogo]].
          map(([k, l, def]) =>
          <div key={k} className="flex items-center gap-3">
              <label className="text-[10px] text-slate-300 w-40 shrink-0">{l}</label>
              <Input className="h-6 text-[11px] px-2 flex-1 font-mono bg-slate-700 border-slate-600 text-slate-100" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={def || undefined} />
            </div>
          )}
        </section>

        <section className="space-y-1">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Flags</h3>
          <YesNo label="Custom battle availability" value={draft.custom_battle_availability} onChange={(v) => set('custom_battle_availability', v)} />
          <YesNo label="Can sap" value={draft.can_sap} onChange={(v) => set('can_sap', v)} />
          <YesNo label="Prefers naval invasions" value={draft.prefers_naval_invasions} onChange={(v) => set('prefers_naval_invasions', v)} />
        </section>

        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-600 pb-1">Horde</h3>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-[10px] text-slate-300">Can horde</span>
            <div className="flex rounded overflow-hidden border border-slate-600">
              {[true, false].map((opt) =>
              <button key={String(opt)} onClick={() => set('can_horde', opt)}
              className={`px-2 py-0.5 text-[10px] transition-colors ${draft.can_horde === opt ? 'bg-primary text-primary-foreground' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
                  {opt ? 'yes' : 'no'}
                </button>
              )}
            </div>
          </div>
          {draft.can_horde &&
          <div className="space-y-2 pl-2 border-l-2 border-amber-700">
              {hordeIntField('horde_min_units', 'horde_min_units')}
              {hordeIntField('horde_max_units', 'horde_max_units')}
              {hordeIntField('horde_max_units_reduction_every_horde', 'horde_max_units_reduction_every_horde')}
              {hordeIntField('horde_unit_per_settlement_population', 'horde_unit_per_settlement_population')}
              {hordeIntField('horde_min_named_characters', 'horde_min_named_characters')}
              {hordeIntField('horde_max_percent_army_stack', 'horde_max_percent_army_stack')}
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-slate-300 w-60 shrink-0">horde_disband_percent <span className="text-slate-400">(0-100)</span></label>
                <input type="number" min={0} max={100}
              value={draft.horde_disband_percent_on_settlement_capture ?? 0}
              onChange={(e) => set('horde_disband_percent_on_settlement_capture', Math.max(0, Math.min(100, +e.target.value || 0)))}
              className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-slate-100" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-300">horde_unit entries <span className="text-red-300">*</span></label>
                <HordeUnitsEditor units={draft.horde_units || []} onChange={(v) => set('horde_units', v)} eduUnits={eduUnits} />
                <p className="text-[9px] text-amber-300 mt-1">⚠ First unit must have general_unit attribute in export_descr_unit.txt</p>
              </div>
            </div>
          }
        </section>

          </TabsContent>

          <TabsContent value="banners" className="space-y-4">
            <BannersTab factionName={draft.name} />
          </TabsContent>

          <TabsContent value="descriptions" className="space-y-4">
            <DescriptionsTab factionName={draft.name} />
          </TabsContent>

          <TabsContent value="misc" className="space-y-4">
            <MiscTab factionName={draft.name} />
          </TabsContent>

          <TabsContent value="symbols" className="space-y-4">
            <FactionSymbolsTab factionName={draft.name} />
          </TabsContent>
        </Tabs>

      </div>
    </ScrollArea>);

}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FactionsEditor() {
  const [factions, setFactions] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [search, setSearch] = useState('');
  const [cultures, setCultures] = useState([]);
  const [religions, setReligions] = useState([]);
  const [eduUnits, setEduUnits] = useState([]);

  const fileRef = useRef();
  const cultRef = useRef();
  const relRef = useRef();
  const eduRef = useRef();
  const bannersRef = useRef();
  const stringsRef = useRef();
  const menuStringsRef = useRef();
  const [bannersLoaded, setBannersLoaded] = useState(false);
  const [stringsLoaded, setStringsLoaded] = useState(false);
  const [menuStringsLoaded, setMenuStringsLoaded] = useState(false);
  const [automationReport, setAutomationReport] = useState(() => {
    try { return localStorage.getItem('m2tw_faction_automation_report') || ''; } catch { return ''; }
  });

  useEffect(() => {
    const loadCached = () => {
      try {
        const r = localStorage.getItem(LS_KEY) || localStorage.getItem('m2tw_factions_file') || sessionStorage.getItem('m2tw_factions_raw');
        if (r) {
          setFactions(parseDescrSmFactions(r));
          saveFactionsRaw(r);
        }
      } catch {}
      try {
        const raw = localStorage.getItem(LS_CULT);
        const fallback = localStorage.getItem('m2tw_cultures_file') || sessionStorage.getItem('m2tw_cultures_raw');
        if (raw) setCultures(JSON.parse(raw));
        else if (fallback) {
          const list = parseCultures(fallback);
          setCultures(list);
          localStorage.setItem(LS_CULT, JSON.stringify(list));
        }
      } catch {}
      try {
        const raw = localStorage.getItem(LS_REL);
        const fallback = localStorage.getItem('m2tw_religions_file') || sessionStorage.getItem('m2tw_religions_raw');
        if (raw) setReligions(JSON.parse(raw));
        else if (fallback) {
          const list = parseReligions(fallback);
          setReligions(list);
          localStorage.setItem(LS_REL, JSON.stringify(list));
        }
      } catch {}
      try {
        const raw = localStorage.getItem(LS_UNITS);
        const fallback = getEduRawText();
        if (raw) setEduUnits(JSON.parse(raw));
        else if (fallback) {
          const list = parseEduUnits(fallback);
          setEduUnits(list);
          localStorage.setItem(LS_UNITS, JSON.stringify(list));
        }
      } catch {}
      try {if (localStorage.getItem(BANNERS_GLOBAL_KEY)) setBannersLoaded(true);} catch {}
      setStringsLoaded(getExpandedStringsData().entries.length > 0);
      try {if (localStorage.getItem(LS_MENU_STRINGS)) setMenuStringsLoaded(true);} catch {}
    };
    loadCached();
    hydrateTextLocalizationStore().then(loadCached);
    const events = ['factions-file-loaded', 'edu-file-loaded', 'cultures-file-loaded', 'religions-file-loaded', 'text-localization-updated', 'storage'];
    events.forEach(event => window.addEventListener(event, loadCached));
    return () => events.forEach(event => window.removeEventListener(event, loadCached));
  }, []);

  const loadFactions = useCallback(async (e) => {
    const file = e.target.files?.[0];if (!file) return;
    const text = await file.text();
    saveFactionsRaw(text, file.name);
    const parsed = parseDescrSmFactions(text);
    setFactions(parsed);
    setSelectedIdx(parsed.length > 0 ? 0 : null);
    window.dispatchEvent(new CustomEvent('factions-file-loaded'));
    e.target.value = '';
  }, []);

  const loadCultures = useCallback(async (e) => {
    const file = e.target.files?.[0];if (!file) return;
    const text = await file.text();
    const list = parseCultures(text);
    setCultures(list);
    try {localStorage.setItem(LS_CULT, JSON.stringify(list));} catch {}
    window.dispatchEvent(new CustomEvent('cultures-file-loaded'));
    e.target.value = '';
  }, []);

  const loadReligions = useCallback(async (e) => {
    const file = e.target.files?.[0];if (!file) return;
    const text = await file.text();
    const list = parseReligions(text);
    setReligions(list);
    try {localStorage.setItem(LS_REL, JSON.stringify(list));} catch {}
    window.dispatchEvent(new CustomEvent('religions-file-loaded'));
    e.target.value = '';
  }, []);

  const loadEdu = useCallback(async (e) => {
    const file = e.target.files?.[0];if (!file) return;
    const text = await file.text();
    const list = parseEduUnits(text);
    setEduUnits(list);
    saveEduRaw(text, file.name);
    window.dispatchEvent(new CustomEvent('edu-file-loaded'));
    e.target.value = '';
  }, []);

  const loadBannersFile = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    localStorage.setItem(BANNERS_GLOBAL_KEY, text);
    localStorage.setItem('m2tw_descr_banners_file', text);
    localStorage.setItem('m2tw_descr_banners_file_name', file.name);
    setBannersLoaded(true);
    window.dispatchEvent(new CustomEvent('banners-text-loaded'));
    e.target.value = '';
  }, []);

  const loadExpandedText = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const entries = textLocMapToEntries(parseTextLocFile(text))
      .map((entry) => ({ key: normalizeLocKey(entry.key), value: entry.value }));
    if (entries.length) {
      persistExpandedStrings(entries, text);
      setStringsLoaded(true);
    }
    e.target.value = '';
  }, []);

  const loadMenuStrings = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const entries = textLocMapToEntries(parseTextLocFile(text))
      .map((entry) => ({ key: normalizeLocKey(entry.key), value: entry.value }));
    if (entries.length) {
      localStorage.setItem(LS_MENU_STRINGS, JSON.stringify({ entries }));
      setMenuStringsLoaded(true);
      window.dispatchEvent(new CustomEvent('menu-strings-updated'));
    }
    e.target.value = '';
  }, []);

  const handleExport = () => {
    if (!factions) return;
    const text = serialiseDescrSmFactions(factions);
    const blob = textBlob(text);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'descr_sm_factions.txt';
    a.click();
  };

  const handleExportFactionSetup = async () => {
    const zip = new JSZip();
    const included = [];

    try { await hydrateTextLocalizationStore(); } catch {}

    const factionsText = factions
      ? serialiseDescrSmFactions(factions)
      : getStoredText(['m2tw_factions_raw', 'm2tw_sm_factions_raw', 'm2tw_factions_file']);
    addCRLFText(zip, 'data/descr_sm_factions.txt', factionsText, included);

    const bannersText = getStoredText([BANNERS_GLOBAL_KEY, 'm2tw_descr_banners_file', 'm2tw_descr_banners_file_raw']);
    if (bannersText && !/^\s*</.test(bannersText)) addCRLFText(zip, 'data/descr_banners.txt', bannersText, included);

    for (const file of FACTION_SETUP_DATA_FILES) {
      addStoredText(zip, file.path, file.sources, included);
    }
    if (!included.includes('data/export_descr_buildings.txt')) {
      try {
        const record = await loadLargeText('m2tw_edb_file');
        addCRLFText(zip, 'data/export_descr_buildings.txt', record?.text || '', included);
      } catch {}
    }

    const { text: eduText } = await loadEduRawText();
    addCRLFText(zip, 'data/export_descr_unit.txt', eduText || getEduRawText(), included);

    const expanded = getExpandedStringsData();
    addCRLFText(
      zip,
      'data/text/expanded_bi.txt',
      expanded.rawText || (expanded.entries.length ? entriesToText(expanded.entries) : ''),
      included
    );

    const menuEntries = getStoredLocEntries(LS_MENU_STRINGS);
    if (menuEntries.length) {
      addCRLFText(zip, 'data/text/menu_english.txt', entriesToText(menuEntries), included);
    }

    let campaignDescriptionsText = getTextFileFromStore('campaign_descriptions.txt')
      || getStoredText(['m2tw_campaign_descriptions_raw']);
    if (!campaignDescriptionsText) {
      try {
        const descMap = JSON.parse(sessionStorage.getItem('m2tw_campaign_desc_strings') || '{}');
        const entries = Object.entries(descMap).map(([key, value]) => ({ key, value }));
        if (entries.length) campaignDescriptionsText = entriesToText(entries);
      } catch {}
    }
    addCRLFText(zip, 'data/text/campaign_descriptions.txt', campaignDescriptionsText, included);

    const namesText = getTextFileFromStore('names.txt') || getStoredText(['m2tw_campaign_names_raw']);
    addCRLFText(zip, 'data/text/names.txt', namesText, included);

    for (const file of FACTION_SETUP_WORLD_FILES) {
      addStoredText(zip, file.path, file.sources, included);
    }
    await addAssignedUnitUiFilesToZip(zip, included);
    const unitAssignmentReport = buildUnitAssignmentReport();
    if (unitAssignmentReport) addCRLFText(zip, 'unit_assignment_report.txt', unitAssignmentReport, included);

    const report = getStoredText(['m2tw_faction_automation_report']);
    if (report) addCRLFText(zip, 'faction_automation_report.txt', report, included);
    zip.file('faction_setup_export_checklist.txt', toCRLF(buildFactionSetupManifest(included)));

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'rtw_faction_setup_export.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const updateFaction = (i, f) => {
    const updated = factions.map((x, idx) => idx === i ? f : x);
    setFactions(updated);
    saveFactionsRaw(serialiseDescrSmFactions(updated), 'descr_sm_factions.txt');
  };

  const applyFactionAutomation = (factionName, options = {}) => {
    const { entries, rawText } = getExpandedStringsData();
    const updatedEntries = ensureRtwFactionLocEntries(entries, factionName, {
      displayName: options.displayName || factionName,
      adjective: options.adjective || options.displayName || factionName,
      leaderTitle: options.leaderTitle,
      heirTitle: options.heirTitle,
    });
    persistExpandedStrings(updatedEntries, rawText);
    setStringsLoaded(true);
    autoInsertNavyEntry(factionName);
    injectMenuStringsForFaction(factionName, options.displayName || factionName);
    const report = saveFactionAutomationReport([
      `Automated faction setup for ${factionName}`,
      '+ descr_sm_factions.txt updated',
      '+ expanded_bi.txt RTW faction loc keys ensured',
      '+ menu faction labels ensured when menu text is loaded',
      '+ descr_offmap_models.txt navy entry ensured when loaded',
      options.characterCopied ? '+ descr_character.txt faction entries created' : '+ descr_character.txt unchanged unless a source/slave entry was loaded',
      options.eduCopied ? '+ export_descr_unit.txt ownership copied from source faction' : '+ export_descr_unit.txt ownership unchanged unless copied from a source faction',
      options.unitAssigned ? `+ export_descr_unit.txt assigned ${options.unitAssigned} slave roster units${options.generalAssigned ? ' including a general_unit' : ''}` : '+ export_descr_unit.txt auto roster unchanged unless enabled and slave units were loaded',
      options.edbCopied ? '+ export_descr_buildings.txt faction requirements copied from source faction/culture' : '+ export_descr_buildings.txt unchanged unless matching source faction/culture requirements were loaded',
      options.bannersCopied ? '+ descr_banners entries copied from source faction' : '+ descr_banners unchanged unless duplicating a source faction',
      'Manual: descr_strat.txt placement/playability, descr_regions.txt ownership/regions, descr_win_conditions.txt, and graphical assets.',
      'Manual if adding new character names: descr_names.txt and data/text/names.txt.',
    ]);
    setAutomationReport(report);
  };

  const addFaction = () => {
    const newF = {
      name: 'new_faction',
      culture: cultures[0] || '',
      religion: '',
      spawn_type: 'default',
      shadow_faction: '',
      symbol: '',
      rebel_symbol: 'models_strat/symbol_rebels.CAS',
      primary_colour: { r: 128, g: 128, b: 128 },
      secondary_colour: { r: 200, g: 200, b: 200 },
      loading_logo: '',
      standard_index: 0,
      logo_index: '',
      small_logo_index: '',
      triumph_value: '5',
      custom_battle_availability: 'yes',
      can_sap: 'no',
      prefers_naval_invasions: 'no',
      can_horde: false,
      horde_min_units: 0,
      horde_max_units: 0,
      horde_max_units_reduction_every_horde: 0,
      horde_unit_per_settlement_population: 0,
      horde_min_named_characters: 0,
      horde_max_percent_army_stack: 0,
      horde_disband_percent_on_settlement_capture: 0,
      horde_units: []
    };
    const updated = [...(factions || []), newF];
    setFactions(updated);
    setSelectedIdx(updated.length - 1);
    saveFactionsRaw(serialiseDescrSmFactions(updated), 'descr_sm_factions.txt');
    const characterCopied = copyDescrCharacterEntries('slave', newF.name);
    const unitAssign = assignSlaveUnitsToFaction(newF.name, newF.name, { count: 13, packUi: true });
    applyFactionAutomation(newF.name, {
      displayName: newF.name,
      characterCopied,
      unitAssigned: unitAssign.count,
      generalAssigned: unitAssign.generalAssigned,
    });
  };

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateSourceIdx, setDuplicateSourceIdx] = useState(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateStrings, setDuplicateStrings] = useState({
    displayName: '',
    adjective: '',
    sourceAdjective: '',
    leaderTitle: '',
    heirTitle: '',
    strengths: '',
    weaknesses: '',
    customUnit: '',
    unitDescription: ''
  });
  const [duplicateOptions, setDuplicateOptions] = useState({
    createCharacters: true,
    assignSlaveUnits: true,
    packUnitCards: true,
  });

  const openDuplicateModal = (i) => {
    const src = factions[i];
    const baseName = src.name.replace(/_\d+$/, '');
    let newName = `${baseName}_copy`;
    let counter = 1;
    while (factions.some((f) => f.name === newName)) {
      newName = `${baseName}_copy${++counter}`;
    }
    setDuplicateName(newName);
    setDuplicateSourceIdx(i);
    setDuplicateStrings({
      displayName: '',
      adjective: '',
      sourceAdjective: '',
      leaderTitle: '',
      heirTitle: '',
      strengths: '',
      weaknesses: '',
      customUnit: '',
      unitDescription: ''
    });
    setDuplicateOptions({
      createCharacters: true,
      assignSlaveUnits: true,
      packUnitCards: true,
    });
    setDuplicateModalOpen(true);
  };

  const confirmDuplicate = () => {
    if (!duplicateName.trim() || duplicateSourceIdx === null) return;
    const src = factions[duplicateSourceIdx];
    const newFactionName = duplicateName.trim();
    const nameUpper = newFactionName.toUpperCase();
    const { displayName, adjective, sourceAdjective, leaderTitle, heirTitle, strengths, weaknesses, customUnit, unitDescription } = duplicateStrings;
    
    const dup = {
      ...src,
      name: newFactionName,
      spawn_type: 'default',
      shadow_faction: '',
      symbol: `models_strat/symbol_${newFactionName}.CAS`,
      loading_logo: `loading_screen/symbols/symbol128_${newFactionName}.tga`,
      logo_index: `FACTION_LOGO_${nameUpper}`,
      small_logo_index: `SMALL_FACTION_LOGO_${nameUpper}`,
      standard_index: 0,
      horde_units: []
    };
    const updated = [...factions, dup];
    setFactions(updated);
    setSelectedIdx(updated.length - 1);
    saveFactionsRaw(serialiseDescrSmFactions(updated), 'descr_sm_factions.txt');
    let bannersCopied = false;
    
    // Copy banner texture entries from source faction to new faction
    try {
      const srcBannersData = localStorage.getItem(BANNERS_GLOBAL_KEY);
      if (srcBannersData) {
        bannersCopied = copyRtwBannersText(src.name, newFactionName);
      }
    } catch (err) {
      console.error('Failed to copy banners:', err);
    }
    
    // Duplicate localization entries from source faction
    try {
      const { entries: storedEntries, rawText } = getExpandedStringsData();
      
      const srcNameUpper = src.name.toUpperCase();
      const srcNameLower = src.name.toLowerCase();
      const srcAdj = (sourceAdjective || '').trim();
      const newAdj = (adjective || '').trim();
      
      // Find all source faction's string entries
      const srcEntries = storedEntries.filter(entry => {
        const keyUpper = entry.key.toUpperCase();
        return keyUpper.includes(srcNameUpper);
      });
      
      // Create new entries by replacing source faction name with new faction name in keys
      const copiedEntries = srcEntries.map(entry => {
        // Replace faction name in the KEY (e.g., {MILAN} -> {MANTUA})
        const newKey = entry.key.replace(new RegExp(srcNameUpper, 'g'), nameUpper);
        
        // Start with the original value
        let newValue = entry.value;
        
        // Replace source adjective with new adjective EXACTLY as entered (case-sensitive)
        if (srcAdj && newAdj) {
          // Exact case-sensitive replacement
          newValue = newValue.replace(new RegExp(srcAdj, 'g'), newAdj);
        }
        
        // Replace faction name references in the VALUE using displayName
        if (displayName) {
          newValue = newValue
            .replace(new RegExp(src.name, 'gi'), displayName)
            .replace(new RegExp(srcNameLower, 'gi'), displayName.toLowerCase());
        }
        
        // Apply user's custom edits for specific fields - these override any previous replacements
        if (newKey === nameUpper && displayName.trim()) {
          newValue = displayName.trim();
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_LEADER` && leaderTitle.trim()) {
          newValue = leaderTitle.trim();
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_HEIR` && heirTitle.trim()) {
          newValue = heirTitle.trim();
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_LEADER_TITLE` && leaderTitle.trim()) {
          newValue = leaderTitle.trim();
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_HEIR_TITLE` && heirTitle.trim()) {
          newValue = heirTitle.trim();
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_LEADER_NAME` && leaderTitle.trim()) {
          newValue = `${leaderTitle.trim()} %S`;
        }
        else if (newKey === `EMT_${nameUpper}_FACTION_HEIR_NAME` && heirTitle.trim()) {
          newValue = `${heirTitle.trim()} %S`;
        }
        else if (newKey === `${nameUpper}_STRENGTH`) {
          // Use custom strengths text if provided, otherwise keep the replaced value
          newValue = strengths.trim() || newValue;
        }
        else if (newKey === `${nameUpper}_WEAKNESS`) {
          // Use custom weaknesses text if provided, otherwise keep the replaced value
          newValue = weaknesses.trim() || newValue;
        }
        else if (newKey === `${nameUpper}_UNIT`) {
          // Use custom unit text if provided, otherwise keep the replaced value
          newValue = customUnit.trim() || newValue;
        }
        
        return { key: newKey, value: newValue };
      });
      const newEntries = ensureRtwFactionLocEntries(copiedEntries, newFactionName, {
        displayName,
        adjective: newAdj,
        leaderTitle,
        heirTitle,
      });
      
      // Remove any existing entries for this new faction name
      const filtered = storedEntries.filter(entry => {
        const keyUpper = entry.key.toUpperCase();
        return !keyUpper.includes(nameUpper);
      });
      
      // Add the duplicated entries and save with proper structure
      const updated = [...filtered, ...newEntries];
      persistExpandedStrings(updated, rawText);
      setStringsLoaded(true);
    } catch (err) {
      console.error('Failed to duplicate strings:', err);
    }
    
    const unitProfileText = [
      displayName,
      adjective,
      strengths,
      weaknesses,
      customUnit,
      unitDescription,
      src.culture,
      src.name,
    ].filter(Boolean).join(' ');
    const characterCopied = duplicateOptions.createCharacters
      ? copyDescrCharacterEntries(src.name, newFactionName, src.culture)
      : false;
    const unitAssign = duplicateOptions.assignSlaveUnits
      ? assignSlaveUnitsToFaction(newFactionName, unitProfileText, { count: 13, packUi: duplicateOptions.packUnitCards })
      : { count: 0 };
    const eduCopied = copyEduOwnershipFromFaction(src.name, newFactionName);
    const edbCopied = copyEdbFactionRequirements(src.name, newFactionName, src.culture);
    applyFactionAutomation(newFactionName, {
      displayName: duplicateStrings.displayName || newFactionName,
      adjective: duplicateStrings.adjective || duplicateStrings.displayName || newFactionName,
      leaderTitle: duplicateStrings.leaderTitle,
      heirTitle: duplicateStrings.heirTitle,
      characterCopied,
      unitAssigned: unitAssign.count,
      generalAssigned: unitAssign.generalAssigned,
      eduCopied,
      edbCopied,
      bannersCopied,
    });
    setDuplicateModalOpen(false);
    setDuplicateSourceIdx(null);
    setDuplicateName('');
    setDuplicateStrings({
      displayName: '',
      adjective: '',
      sourceAdjective: '',
      leaderTitle: '',
      heirTitle: '',
      strengths: '',
      weaknesses: '',
      customUnit: '',
      unitDescription: ''
    });
    setDuplicateOptions({
      createCharacters: true,
      assignSlaveUnits: true,
      packUnitCards: true,
    });
  };

  const handleAssignUnitsForFaction = (factionName, description) => {
    const result = assignSlaveUnitsToFaction(factionName, description || factionName, { count: 13, packUi: true });
    if (result.changed) {
      try { setEduUnits(parseEduUnits(getEduRawText())); } catch {}
      applyFactionAutomation(factionName, {
        displayName: factionName,
        unitAssigned: result.count,
        generalAssigned: result.generalAssigned,
      });
    }
    return result;
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(factions);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setFactions(items);
    saveFactionsRaw(serialiseDescrSmFactions(items), 'descr_sm_factions.txt');
    if (selectedIdx !== null) {
      const newIdx = items.findIndex(f => f.name === factions[selectedIdx].name);
      setSelectedIdx(newIdx >= 0 ? newIdx : null);
    }
  };

  const deleteFaction = (i) => {
    const updated = factions.filter((_, idx) => idx !== i);
    setFactions(updated);
    setSelectedIdx(updated.length > 0 ? Math.min(i, updated.length - 1) : null);
    saveFactionsRaw(serialiseDescrSmFactions(updated), 'descr_sm_factions.txt');
  };

  const filtered = factions ?
  factions.map((f, i) => ({ f, i })).filter(({ f }) => !search || f.name.toLowerCase().includes(search.toLowerCase())) :
  [];

  const overLimit = factions && factions.length > VANILLA_FACTION_LIMIT;

  return (
    <div className="h-screen flex flex-col">
      <div className="border-b border-border flex flex-wrap items-center px-4 gap-2 py-1.5 shrink-0 bg-card/50">
        <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-[hsl(var(--foreground))]">Factions Editor</span>
        {factions && <span className="text-[10px] text-slate-500 font-mono">({factions.length} factions)</span>}
        {overLimit &&
        <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700 rounded px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" />
            {factions.length} — vanilla limit {VANILLA_FACTION_LIMIT}. Extras require M2EX.
          </span>
        }
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <input ref={cultRef} type="file" accept=".txt" className="hidden" onChange={loadCultures} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 text-[hsl(var(--foreground))] ${cultures.length ? 'text-green-300 border-green-700' : ''}`} onClick={() => cultRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {cultures.length ? `${cultures.length} cultures` : 'descr_cultures.txt'}
          </Button>

          <input ref={relRef} type="file" accept=".txt" className="hidden" onChange={loadReligions} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] ${religions.length ? 'text-green-300 border-green-700' : ''}`} onClick={() => relRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {religions.length ? `${religions.length} religions` : 'descr_religions.txt'}
          </Button>

          <input ref={eduRef} type="file" accept=".txt" className="hidden" onChange={loadEdu} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 text-[hsl(var(--foreground))] ${eduUnits.length ? 'text-green-300 border-green-700' : ''}`} onClick={() => eduRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {eduUnits.length ? `${eduUnits.length} units` : 'export_descr_unit.txt'}
          </Button>

          <input ref={bannersRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadBannersFile} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${bannersLoaded ? 'text-green-300 border-green-700' : ''}`} onClick={() => bannersRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {bannersLoaded ? 'Banners ✓' : 'descr_banners.txt'}
          </Button>

          <input ref={stringsRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadExpandedText} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${stringsLoaded ? 'text-green-300 border-green-700' : ''}`} onClick={() => stringsRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {stringsLoaded ? 'Strings OK' : 'expanded_bi.txt'}
          </Button>

          <input ref={menuStringsRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadMenuStrings} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${menuStringsLoaded ? 'text-green-300 border-green-700' : ''}`} onClick={() => menuStringsRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {menuStringsLoaded ? 'Menu Strings ✓' : 'menu_english.txt'}
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={loadFactions} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${factions ? 'text-amber-300 border-amber-600' : ''}`} onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {factions ? 'Reload factions' : 'Load descr_sm_factions.txt'}
          </Button>
          {factions &&
          <Button variant="outline" size="sm" className="text-[10px] h-7 text-slate-200 border-slate-600 hover:bg-slate-700" onClick={handleExport}>
              <Download className="w-3 h-3 mr-1" /> Export factions
            </Button>
          }
          {factions && (
            <Button variant="outline" size="sm" className="text-[10px] h-7 text-amber-200 border-amber-700/70 hover:bg-amber-900/30" onClick={handleExportFactionSetup}>
              <Download className="w-3 h-3 mr-1" /> Export setup zip
            </Button>
          )}
          {bannersLoaded && (
            <Button variant="outline" size="sm" className="text-[10px] h-7 text-slate-200 border-slate-600 hover:bg-slate-700" onClick={() => {
              const data = localStorage.getItem(BANNERS_GLOBAL_KEY);
              if (!data) return;
              const blob = textBlob(data, 'text/plain');
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'descr_banners.txt'; a.click();
            }}>
              <Download className="w-3 h-3 mr-1" /> Export banners
            </Button>
          )}
          {menuStringsLoaded && (
            <Button variant="outline" size="sm" className="text-[10px] h-7 text-slate-200 border-slate-600 hover:bg-slate-700" onClick={() => {
              try {
                const raw = localStorage.getItem(LS_MENU_STRINGS);
                if (!raw) return;
                const { entries } = JSON.parse(raw);
                const blob = textBlob(entriesToText(entries));
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'menu_english.txt'; a.click();
              } catch {}
            }}>
              <Download className="w-3 h-3 mr-1" /> Export menu strings
            </Button>
          )}
        </div>
      </div>

      {automationReport && (
        <div className="border-b border-amber-700/40 bg-amber-950/20 px-4 py-2 text-[10px] text-amber-100 whitespace-pre-wrap font-mono">
          {automationReport}
        </div>
      )}

      {!factions ?
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-500">
          <Shield className="w-10 h-10 opacity-30" />
          <p className="text-sm">Load <span className="font-mono text-amber-400">descr_sm_factions.txt</span> to begin</p>
          <p className="text-[11px] text-slate-600">Optionally load <span className="font-mono text-slate-400">descr_cultures.txt</span>, <span className="font-mono text-slate-400">descr_religions.txt</span>, <span className="font-mono text-slate-400">export_descr_unit.txt</span> for dropdowns</p>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Choose file…
          </Button>
        </div> :

      <div className="flex flex-1 min-h-0">
          <div className="w-56 border-r border-border flex flex-col shrink-0">
            <div className="p-2 border-b border-border space-y-1">
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-6 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-400" />
              <Button variant="outline" size="sm" className="w-full text-[10px] h-6 text-slate-200 border-slate-600 hover:bg-slate-700" onClick={addFaction}>
                <Plus className="w-3 h-3 mr-1" /> Add Faction
              </Button>
            </div>
            <ScrollArea className="flex-1 max-h-[calc(100vh-120px)]">
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="factions">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef}>
                      {filtered.map(({ f, i }, index) => {
                        const originalIdx = factions.findIndex(faction => faction.name === f.name);
                        return (
                          <Draggable key={f.name} draggableId={f.name} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`w-full flex items-center gap-2 px-3 py-2 border-b border-border/60 ${selectedIdx === originalIdx ? 'bg-accent' : 'hover:bg-accent'} ${snapshot.isDragging ? 'bg-accent shadow-lg' : ''}`}
                                style={{ ...provided.draggableProps.style }}
                              >
                                <div {...provided.dragHandleProps} className="cursor-grab text-slate-500 hover:text-slate-300">
                                  <GripVertical className="w-3 h-3" />
                                </div>
                                <button onClick={() => setSelectedIdx(originalIdx)} className="flex items-center gap-2 flex-1 text-left">
                                  <div className="flex gap-1 shrink-0">
                                    <div className="w-3 h-3 rounded-sm border border-slate-600" style={{ background: rgbToHex(f.primary_colour) }} />
                                    <div className="w-3 h-3 rounded-sm border border-slate-600" style={{ background: rgbToHex(f.secondary_colour) }} />
                                  </div>
                                  <span className="flex-1 text-[11px] font-mono truncate text-slate-100">{f.name}</span>
                                </button>
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={(e) => {e.stopPropagation();openDuplicateModal(originalIdx);}}
                              className="text-blue-300 hover:text-blue-200 p-1" title="Duplicate">
                                    <Copy className="w-3 h-3" />
                                  </button>
                                  <button onClick={(e) => {e.stopPropagation();deleteFaction(originalIdx);}}
                              className="text-red-400 hover:text-red-300 p-1" title="Delete">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </ScrollArea>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedIdx !== null && factions[selectedIdx] ?
          <FactionDetail
            key={selectedIdx}
            faction={factions[selectedIdx]}
            onChange={(f) => updateFaction(selectedIdx, f)}
            onCancel={() => setSelectedIdx(null)}
            cultures={cultures}
            religions={religions}
            eduUnits={eduUnits}
            onAssignUnits={handleAssignUnitsForFaction} /> :


          <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                Select a faction to edit
              </div>
          }
          </div>
        </div>
      }

      {/* Duplicate Modal */}
      <Dialog open={duplicateModalOpen} onOpenChange={setDuplicateModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-600 max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-200">Duplicate Faction</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div>
              <label className="text-[10px] text-slate-300 block mb-2">New Faction Name</label>
              <Input
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder="e.g. mongols_copy"
                className="h-8 text-[11px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                onKeyDown={(e) => e.key === 'Enter' && confirmDuplicate()}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border border-slate-700 rounded p-2 bg-slate-950/40">
              {[
                ['createCharacters', 'descr_character entries'],
                ['assignSlaveUnits', '13 units + general'],
                ['packUnitCards', 'Pack slave UI cards'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[10px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={!!duplicateOptions[key]}
                    disabled={key === 'packUnitCards' && !duplicateOptions.assignSlaveUnits}
                    onChange={(e) => setDuplicateOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            
            <div className="border-t border-slate-700 pt-3">
              <p className="text-[10px] text-slate-400 mb-3">Text Localization Entries</p>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Source Faction Adjective</label>
                  <Input
                    value={duplicateStrings.sourceAdjective || ''}
                    onChange={(e) => setDuplicateStrings(s => ({ ...s, sourceAdjective: e.target.value }))}
                    placeholder="e.g. Milanese"
                    className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Adjective to replace from source</p>
                </div>
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">New Faction Adjective</label>
                  <Input
                    value={duplicateStrings.adjective}
                    onChange={(e) => setDuplicateStrings(s => ({ ...s, adjective: e.target.value }))}
                    placeholder="e.g. Mantuan"
                    className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">New adjective to use</p>
                </div>
              </div>
              
              <div className="mt-3">
                <label className="text-[9px] text-slate-400 block mb-1">Faction Display Name</label>
                <Input
                  value={duplicateStrings.displayName}
                  onChange={(e) => setDuplicateStrings(s => ({ ...s, displayName: e.target.value }))}
                  placeholder="e.g. Marquisate of Mantua"
                  className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                />
                <p className="text-[9px] text-slate-500 mt-1">Used for keys like &#123;MANTUA&#125; and display text</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Leader Title (optional)</label>
                  <Input
                    value={duplicateStrings.leaderTitle}
                    onChange={(e) => setDuplicateStrings(s => ({ ...s, leaderTitle: e.target.value }))}
                    placeholder="e.g. Great Khan"
                    className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Heir Title (optional)</label>
                  <Input
                    value={duplicateStrings.heirTitle}
                    onChange={(e) => setDuplicateStrings(s => ({ ...s, heirTitle: e.target.value }))}
                    placeholder="e.g. Khan"
                    className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                  />
                </div>
              </div>
              
              <div className="mt-3">
                <label className="text-[9px] text-slate-400 block mb-1">Custom Strengths (optional)</label>
                <textarea
                  value={duplicateStrings.strengths}
                  onChange={(e) => setDuplicateStrings(s => ({ ...s, strengths: e.target.value }))}
                  placeholder="e.g. Expert horse archers, fast movement"
                  className="w-full h-16 bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
                />
              </div>
              
              <div className="mt-3">
                <label className="text-[9px] text-slate-400 block mb-1">Custom Weaknesses (optional)</label>
                <textarea
                  value={duplicateStrings.weaknesses}
                  onChange={(e) => setDuplicateStrings(s => ({ ...s, weaknesses: e.target.value }))}
                  placeholder="e.g. Weak in siege defense"
                  className="w-full h-16 bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
                />
              </div>
              
              <div className="mt-3">
                <label className="text-[9px] text-slate-400 block mb-1">Custom Unit Name (optional)</label>
                <Input
                  value={duplicateStrings.customUnit}
                  onChange={(e) => setDuplicateStrings(s => ({ ...s, customUnit: e.target.value }))}
                  placeholder="e.g. Keshik Guard"
                  className="h-7 text-[10px] px-2 bg-slate-700 border-slate-600 text-slate-100"
                />
              </div>

              <div className="mt-3">
                <label className="text-[9px] text-slate-400 block mb-1">Unit Assignment Description</label>
                <textarea
                  value={duplicateStrings.unitDescription}
                  onChange={(e) => setDuplicateStrings(s => ({ ...s, unitDescription: e.target.value }))}
                  placeholder="e.g. Egyptian/Greek infantry with archers and light cavalry"
                  className="w-full h-16 bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
                />
                <p className="text-[9px] text-slate-500 mt-1">Used to pick the 13 slave-owned units for this faction.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setDuplicateModalOpen(false)} className="px-3 py-1.5 text-[10px] rounded border border-slate-600 text-slate-300 hover:bg-slate-700">Cancel</button>
            <button onClick={confirmDuplicate} className="px-3 py-1.5 text-[10px] rounded bg-blue-700 hover:bg-blue-600 text-white font-semibold">Duplicate</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);

}
