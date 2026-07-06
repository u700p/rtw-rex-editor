import React, { useRef, useState } from 'react';
import { useEDB } from '../components/edb/EDBContext';
import { useRefData } from '../components/edb/RefDataContext';
import { parseEventsFromCampaign } from '../components/edb/EDBParser';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';
import { setTextLocalizationStore, getTextLocalizationStore, clearTextLocalizationStore } from '@/lib/textLocalizationStore';
import { parseTextLocFile, textLocMapToEntries } from '@/lib/textLocParser';
import { getEduRawText, setEduRawText } from '@/lib/eduStorage';
import { saveLargeText } from '@/lib/largeTextStore';
import DataFolderPicker from '../components/home/DataFolderPicker';
import { BANNERS_GLOBAL_KEY } from '@/components/factions/BannersTab';
import {
  FACTION_SYMBOL_PREVIEW_KEY,
  resolveFactionSymbolOwners,
  storeFactionSymbolAliasesFromText,
  storeFactionSymbolsBulk,
} from '@/components/factions/FactionSymbolsTab';
import { decodeTgaToDataUrl as decodeSharedTgaToDataUrl } from '@/components/shared/tgaDecoder';
import romeHero from '../assets/rome/rome-hero.jpg';
import romeLogo from '../assets/rome/rome-logo.png';
import romeUi from '../assets/rome/rome-ui.jpg';
import {
  CheckCircle2, AlertCircle, Clock,
  Package, Info, Castle } from
'lucide-react';

function decodeTgaToDataUrl(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) return null;
  const idLength = data[0],colorMapType = data[1],imageType = data[2];
  const width = data[12] | data[13] << 8,height = data[14] | data[15] << 8;
  const bpp = data[16],imageDescriptor = data[17];
  const topOrigin = !!(imageDescriptor & 0x20);
  if (colorMapType !== 0 || imageType !== 2 && imageType !== 10) return null;
  if (bpp !== 24 && bpp !== 32) return null;
  if (width === 0 || height === 0) return null;
  const headerSize = 18 + idLength;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let srcIdx = headerSize,pixIdx = 0;
  if (imageType === 2) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const b = data[srcIdx++],g = data[srcIdx++],r = data[srcIdx++];
      const a = bpp === 32 ? data[srcIdx++] : 255;
      pixels[pixIdx++] = r;pixels[pixIdx++] = g;pixels[pixIdx++] = b;pixels[pixIdx++] = a;
    }
  } else {
    let pixel = 0;
    while (pixel < width * height) {
      const rc = data[srcIdx++],count = (rc & 0x7f) + 1;
      if (rc & 0x80) {
        const b = data[srcIdx++],g = data[srcIdx++],r = data[srcIdx++];
        const a = bpp === 32 ? data[srcIdx++] : 255;
        for (let i = 0; i < count; i++, pixel++) {pixels[pixIdx++] = r;pixels[pixIdx++] = g;pixels[pixIdx++] = b;pixels[pixIdx++] = a;}
      } else {
        for (let i = 0; i < count; i++, pixel++) {
          const b = data[srcIdx++],g = data[srcIdx++],r = data[srcIdx++];
          const a = bpp === 32 ? data[srcIdx++] : 255;
          pixels[pixIdx++] = r;pixels[pixIdx++] = g;pixels[pixIdx++] = b;pixels[pixIdx++] = a;
        }
      }
    }
  }
  if (!topOrigin) {
    const rowSize = width * 4;
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const top = y * rowSize,bot = (height - 1 - y) * rowSize;
      for (let i = 0; i < rowSize; i++) {const tmp = pixels[top + i];pixels[top + i] = pixels[bot + i];pixels[bot + i] = tmp;}
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

// Parse descr_aerial_map_ground_types.txt → { [groundTypeName]: { summer: 'file.tga', winter: 'file.tga' | null } }
// Format: biome_name { \n  ground_type_name  summer.tga  winter.tga \n }
function parseDescrAerialGroundTypes(text) {
  const result = {};
  const lines = text.split('\n');
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line === '{') {inBlock = true;continue;}
    if (line === '}') {inBlock = false;continue;}
    if (inBlock) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const typeName = parts[0].toLowerCase();
        const summer = parts[1]?.toLowerCase().endsWith('.tga') ? parts[1] : null;
        const winter = parts[2]?.toLowerCase().endsWith('.tga') ? parts[2] : null;
        // First occurrence wins (most common biome texture)
        if (!result[typeName] && summer) {
          result[typeName] = { summer, winter };
        }
      }
    }
  }
  return result;
}

// Files we look for in the data\ folder (matched by filename only, regardless of subfolder)
const DATA_FILE_MAP = {
  'descr_aerial_map_ground_types.txt': 'aerial_ground_types',
  'export_descr_buildings.txt': 'edb',
  'descr_sm_factions.txt': 'fac',
  'descr_sm_resources.txt': 'res',
  'export_descr_unit.txt': 'unit',
  'descr_banners.txt': 'banners',
  'descr_building_battle.txt': 'building_battle',
  'descr_character.txt': 'descr_character',
  'descr_formations_ai.txt': 'formations_ai',
  'descr_lbc_db.txt': 'lbc_db',
  'descr_model_strat.txt': 'model_strat',
  'descr_offmap_models.txt': 'offmap_models',
  'descr_standards.txt': 'standards',
  'descr_settlement_plan.txt': 'settlement_plan',
  'descr_ui_buildings.txt': 'ui_buildings',
  'descr_events.txt': 'ev',
  'export_buildings.txt': 'txt',
  'export_descr_character_traits.txt': 'traits',
  'export_descr_ancillaries.txt': 'anc',
  'export_units.txt': 'expunits',
  'descr_cultures.txt': 'cultures',
  'descr_names.txt': 'names',
  'descr_rebel_factions.txt': 'rebel_fac',
  'descr_religions.txt': 'religions',
  'battle_models.modeldb': 'modeldb',
  'descr_model_battle.txt': 'modeldb',
  'descr_skeleton.txt': 'skeleton',
  'descr_mount.txt': 'mount',
  'export_descr_guilds.txt': 'guilds'
};

const TEXT_LOCALIZATION_FILENAMES = new Set([
  'export_buildings.txt',
  'export_units.txt',
  'export_units_wip.txt',
  'export_vnvs.txt',
  'export_ancillaries.txt',
  'campaign_descriptions.txt',
  'names.txt',
  'expanded_bi.txt',
  'expanded_bi_wip.txt',
  'expanded.txt',
  'menu_english.txt',
  'menu.txt',
  'rebel_faction_descr.txt',
  'strat.txt',
  'tooltips.txt',
]);

function statusFromTextLocalizationStore(store) {
  const out = {};
  const names = new Set(Object.keys(store || {}).map((name) => String(name).toLowerCase()));
  if (names.has('export_buildings.txt')) out.txt = 'ok';
  if (names.has('export_units.txt')) out.expunits = 'ok';
  if (names.has('export_vnvs.txt')) out.vnvs = 'ok';
  if (names.has('export_ancillaries.txt')) out.anctxt = 'ok';
  return out;
}

function countStoredFactionSymbols() {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = sessionStorage.getItem(FACTION_SYMBOL_PREVIEW_KEY) || localStorage.getItem(FACTION_SYMBOL_PREVIEW_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Object.values(parsed || {}).reduce((sum, images) => sum + Object.keys(images || {}).length, 0);
  } catch {
    return 0;
  }
}

function inferFactionSymbolSlot(file) {
  const path = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
  const stem = file.name.replace(/\.(tga|png|jpe?g|bmp)$/i, '').toLowerCase();
  const readVariant = (base, prefix) => {
    const suffixes = [
      ['_select', `${prefix}_select`],
      ['_grey', `${prefix}_grey`],
      ['_roll', `${prefix}_roll`],
    ];
    for (const [suffix, key] of suffixes) {
      if (base.endsWith(suffix)) return { faction: base.slice(0, -suffix.length), key };
    }
    return { faction: base, key: prefix };
  };
  if (path.includes('/menu/symbols/fe_buttons_24/') && stem.startsWith('symbol24_')) {
    return readVariant(stem.slice('symbol24_'.length), 'symbol24');
  }
  if (path.includes('/menu/symbols/fe_buttons_48/') && stem.startsWith('symbol48_')) {
    return readVariant(stem.slice('symbol48_'.length), 'symbol48');
  }
  if (path.includes('/loading_screen/symbols/') && stem.startsWith('symbol128_')) {
    return { faction: stem.slice('symbol128_'.length), key: 'loading_symbol128' };
  }
  return null;
}

async function decodeFactionSymbolFile(file) {
  if (/\.tga$/i.test(file.name)) {
    return decodeSharedTgaToDataUrl(await file.arrayBuffer());
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

async function loadFactionSymbolFiles(files) {
  const byFaction = {};
  let loaded = 0;
  for (let i = 0; i < files.length; i++) {
    if (i % 8 === 0) await yieldToBrowser();
    const slot = inferFactionSymbolSlot(files[i]);
    if (!slot?.faction || !slot.key) continue;
    try {
      const url = await decodeFactionSymbolFile(files[i]);
      if (!url) continue;
      const targetFactions = resolveFactionSymbolOwners(slot.faction);
      const owners = targetFactions.length ? targetFactions : [slot.faction];
      for (const factionName of owners) {
        if (!byFaction[factionName]) byFaction[factionName] = {};
        byFaction[factionName][slot.key] = url;
      }
      loaded++;
    } catch {}
  }
  storeFactionSymbolsBulk(byFaction);
  return { loaded, factions: Object.keys(byFaction).length };
}



function FileStatus({ label, hint, status }) {
  const colors = {
    idle: 'border-border bg-card text-muted-foreground',
    ok: 'border-green-500/40 bg-green-500/10 text-green-400',
    error: 'border-destructive/40 bg-destructive/5 text-destructive',
    loading: 'border-primary/30 bg-primary/5 text-primary'
  };
  const icons = {
    idle: <Clock className="w-3.5 h-3.5 shrink-0 opacity-40" />,
    ok: <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-400" />,
    error: <AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />,
    loading: <div className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  };
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${colors[status] || colors.idle}`}>
      {icons[status] || icons.idle}
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        {hint && <div className="text-[10px] opacity-60 truncate font-normal">{hint}</div>}
      </div>
    </div>
  );








}

function fileIdentity(file) {
  return (file?.webkitRelativePath || file?.name || '').toLowerCase().replace(/\\/g, '/');
}

function mergeFilesByPath(existing = [], incoming = []) {
  const byPath = new Map();
  for (const file of existing) byPath.set(fileIdentity(file), file);
  for (const file of incoming) byPath.set(fileIdentity(file), file);
  return Array.from(byPath.values());
}

function registerUnitImageFiles(files) {
  const fileMap = { ...(window._m2tw_unit_image_file_map || {}) };
  const variantIndex = { ...(window._m2tw_unit_image_variant_index || {}) };
  const addVariant = (unitKey, folder) => {
    if (!unitKey || !folder) return;
    const key = unitKey.replace(/^#/, '').replace(/_info$/i, '').toLowerCase();
    const current = new Set(variantIndex[key] || []);
    current.add(folder);
    variantIndex[key] = [...current].sort();
  };
  for (const file of files || []) {
    const bareName = file.name.replace(/\.tga$/i, '').toLowerCase();
    const relPath = (file.webkitRelativePath || file.name)
      .replace(/\\/g, '/')
      .replace(/\.tga$/i, '')
      .toLowerCase();
    fileMap[bareName] = file;
    fileMap[relPath] = file;
    const uiIndex = relPath.indexOf('/ui/');
    if (uiIndex >= 0) fileMap[relPath.slice(uiIndex + 4)] = file;

    const parts = relPath.split('/').filter(Boolean);
    const filename = parts[parts.length - 1] || bareName;
    const unitsIndex = parts.lastIndexOf('units');
    const infoIndex = parts.lastIndexOf('unit_info');
    if (unitsIndex >= 0 && parts[unitsIndex + 1]) addVariant(filename, parts[unitsIndex + 1]);
    if (infoIndex >= 0 && parts[infoIndex + 1]) addVariant(filename, parts[infoIndex + 1]);
  }
  window._m2tw_unit_image_file_map = fileMap;
  window._m2tw_unit_image_variant_index = variantIndex;
  window._m2tw_unit_image_files = mergeFilesByPath(window._m2tw_unit_image_files || [], files || []);
  return fileMap;
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
      if (current % 8 === 7) await yieldToBrowser();
    }
  });
  await Promise.all(workers);
  return results;
}

async function decodeTgaFiles(files) {
  const cpuCount = typeof window !== 'undefined' ? window.navigator?.hardwareConcurrency || 8 : 8;
  const limit = Math.max(2, Math.min(4, Math.floor(cpuCount / 2) || 2));
  return mapWithLimit(files, limit, async (file) => {
    const buf = await file.arrayBuffer();
    const dataUrl = decodeTgaToDataUrl(buf);
    return dataUrl ? { file, dataUrl } : null;
  });
}

function runInBackground(task) {
  const runner = () => {
    Promise.resolve()
      .then(task)
      .catch((err) => console.error('[Home] background load failed:', err));
  };
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(runner, { timeout: 250 });
  } else {
    setTimeout(runner, 0);
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function detectCampaignFolderName(files) {
  const samplePath = fileIdentity(files[0] || {});
  const framed = `/${samplePath}`;
  const customMatch = framed.match(/\/maps\/campaign\/custom\/([^/]+)\//);
  if (customMatch) return customMatch[1];
  const directMatch = framed.match(/\/maps\/campaign\/([^/]+)\//);
  if (directMatch) return directMatch[1];
  const parts = samplePath.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'imperial_campaign';
}

export default function Home() {
  const { loadEDB, edbData, fileName, loadTextFile, loadBuildingTgaImages } = useEDB();
  const { loadFactionsFile, loadResourcesFile, loadEventsFile, loadUnitsFile, loadSkeletonFile, loadMountFile, loadCampaignScript, loadGuildsFile } = useRefData();

  const [fileStatus, setFileStatus] = useState(() => {
    // Show 'ok' for files already cached in localStorage from a previous session
    const ls = (k) => {try {return !!localStorage.getItem(k);} catch {return false;}};
    const stringsStore = getTextLocalizationStore();
    const stringsCount = Object.keys(stringsStore).length;
    const locStatus = statusFromTextLocalizationStore(stringsStore);
    const factionSymbolCount = countStoredFactionSymbols();
    return {
      edb: ls('m2tw_edb_file') ? 'ok' : 'idle',
      fac: ls('m2tw_factions_file') ? 'ok' : 'idle',
      res: ls('m2tw_resources_file') ? 'ok' : 'idle',
      ev: ls('m2tw_events_file') ? 'ok' : 'idle',
      unit: getEduRawText() ? 'ok' : 'idle',
      txt: ls('m2tw_edb_txt_file') || locStatus.txt === 'ok' ? 'ok' : 'idle',
      traits: ls('m2tw_traits_file') ? 'ok' : 'idle',
      anc: ls('m2tw_anc_file') ? 'ok' : 'idle',
      guilds: ls('m2tw_guilds_file') ? 'ok' : 'idle',
      vnvs: ls('m2tw_vnvs_file') || locStatus.vnvs === 'ok' ? 'ok' : 'idle',
      anctxt: ls('m2tw_anctxt_file') || locStatus.anctxt === 'ok' ? 'ok' : 'idle',
      expunits: ls('m2tw_export_units_file') || locStatus.expunits === 'ok' ? 'ok' : 'idle',
      aerial_ground_types: ls('m2tw_aerial_ground_types') ? 'ok' : 'idle',
      text_loc: stringsCount > 0 ? 'ok' : 'idle',
      anc_images: 'idle',
      unit_images: 'idle',
      faction_logos: factionSymbolCount > 0 ? 'ok' : 'idle',
      cultures: ls('m2tw_cultures_file') ? 'ok' : 'idle',
      names: ls('m2tw_names_file') ? 'ok' : 'idle',
      rebel_fac: ls('m2tw_rebel_factions_file') ? 'ok' : 'idle',
      religions: ls('m2tw_religions_file') ? 'ok' : 'idle',
      modeldb: ls('m2tw_modeldb_file') ? 'ok' : 'idle',
      banners: ls(BANNERS_GLOBAL_KEY) || ls('m2tw_descr_banners_file') ? 'ok' : 'idle',
      building_battle: ls('m2tw_descr_building_battle_file') ? 'ok' : 'idle',
      descr_character: ls('m2tw_descr_character') ? 'ok' : 'idle',
      formations_ai: ls('m2tw_descr_formations_ai_file') ? 'ok' : 'idle',
      lbc_db: ls('m2tw_descr_lbc_db_file') ? 'ok' : 'idle',
      model_strat: ls('m2tw_descr_model_strat') ? 'ok' : 'idle',
      offmap_models: ls('m2tw_offmap_models') ? 'ok' : 'idle',
      standards: ls('m2tw_descr_standards_file') ? 'ok' : 'idle',
      settlement_plan: ls('m2tw_descr_settlement_plan_file') ? 'ok' : 'idle',
      ui_buildings: ls('m2tw_descr_ui_buildings_file') ? 'ok' : 'idle',
      campaign_world: ls('m2tw_campaign_strat') || ls('m2tw_campaign_regions') || ls('m2tw_campaign_win_conditions') ? 'ok' : 'idle'
    };
  });

  const [modName, setModName] = useState(() => {
    try {return localStorage.getItem('m2tw_mod_name') || 'my_mod';} catch {return 'my_mod';}
  });
  const [textLocCount, setTextLocCount] = useState(() => Object.keys(getTextLocalizationStore()).length);
  const [ancImgCount, setAncImgCount] = useState(0);
  const [mapFileCount, setMapFileCount] = useState(0);
  const [unitImgCount, setUnitImgCount] = useState(0);
  const [bldImgCount, setBldImgCount] = useState(0);
  const [groundTexCount, setGroundTexCount] = useState(0);
  const [factionLogoCount, setFactionLogoCount] = useState(() => countStoredFactionSymbols());
  const [campaignName, setCampaignName] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const dataFolderRef = useRef();
  const ancImagesFolderRef = useRef();
  const campaignFolderRef = useRef();
  const unitUiFolderRef = useRef();
  const bldImagesFolderRef = useRef();

  const readText = (file) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = (e) => {
      const bytes = new Uint8Array(e.target.result || new ArrayBuffer(0));
      const decode = (encoding) => {
        try { return new TextDecoder(encoding).decode(bytes); }
        catch { return new TextDecoder().decode(bytes); }
      };
      if (bytes[0] === 0xff && bytes[1] === 0xfe) resolve(decode('utf-16le'));
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) resolve(decode('utf-16be'));
      else resolve(decode('utf-8'));
    };
    r.readAsArrayBuffer(file);
  });

  const handleDataFolderFromPicker = async (files, campaignFolders, selectedCampaigns) => {
    setLoadingData(true);
    await processDataFiles(files);
    setLoadingData(false);
  };

  const processDataFiles = async (files) => {
    // Only clear keys for the file types we are actually re-loading in this batch.
    // Wiping everything upfront causes data loss if the browser crashes or the user
    // only loads a partial set of files.
    const fileNames = new Set(files.map(f => f.name.toLowerCase()));
    const conditionalRemove = (key, condition) => { try { if (condition) localStorage.removeItem(key); } catch {} };
    conditionalRemove('m2tw_edb_file',          fileNames.has('export_descr_buildings.txt'));
    conditionalRemove('m2tw_edb_file_name',      fileNames.has('export_descr_buildings.txt'));
    conditionalRemove('m2tw_edb_txt_file',       fileNames.has('export_buildings.txt'));
    conditionalRemove('m2tw_resources_file',     fileNames.has('descr_sm_resources.txt'));
    conditionalRemove('m2tw_events_file',        fileNames.has('descr_events.txt'));
    conditionalRemove('m2tw_traits_file',        fileNames.has('export_descr_character_traits.txt'));
    conditionalRemove('m2tw_anc_file',           fileNames.has('export_descr_ancillaries.txt'));
    conditionalRemove('m2tw_export_units_file',  fileNames.has('export_units.txt'));
    conditionalRemove('m2tw_modeldb_file',       fileNames.has('battle_models.modeldb') || fileNames.has('descr_model_battle.txt'));
    conditionalRemove('m2tw_modeldb_file_name',  fileNames.has('battle_models.modeldb') || fileNames.has('descr_model_battle.txt'));
    conditionalRemove('m2tw_descr_building_battle_file', fileNames.has('descr_building_battle.txt'));
    conditionalRemove('m2tw_descr_formations_ai_file', fileNames.has('descr_formations_ai.txt'));
    conditionalRemove('m2tw_descr_lbc_db_file', fileNames.has('descr_lbc_db.txt'));
    conditionalRemove('m2tw_descr_standards_file', fileNames.has('descr_standards.txt'));
    conditionalRemove('m2tw_descr_settlement_plan_file', fileNames.has('descr_settlement_plan.txt'));
    conditionalRemove('m2tw_descr_ui_buildings_file', fileNames.has('descr_ui_buildings.txt'));


    const loaderMap = {
      fac: loadFactionsFile,
      res: loadResourcesFile,
      ev: loadEventsFile,
      unit: loadUnitsFile,
      skeleton: loadSkeletonFile,
      mount: loadMountFile,
      guilds: loadGuildsFile,
      txt: loadTextFile,
      cultures: null,
      names: null,
      rebel_fac: null,
      religions: null
    };

    // Storage keys for files loaded by their own editors
    const storeKeys = {
      modeldb: 'm2tw_modeldb_file',
      traits: 'm2tw_traits_file',
      anc: 'm2tw_anc_file',
      vnvs: 'm2tw_vnvs_file',
      anctxt: 'm2tw_anctxt_file',
      expunits: 'm2tw_export_units_file',
      // files stored for campaign map editor
      cultures: 'm2tw_cultures_file',
      names: 'm2tw_names_file',
      rebel_fac: 'm2tw_rebel_factions_file',
      religions: 'm2tw_religions_file'
    };

    const rawStoreKeys = {
      banners: 'm2tw_descr_banners_file',
      building_battle: 'm2tw_descr_building_battle_file',
      descr_character: 'm2tw_descr_character',
      formations_ai: 'm2tw_descr_formations_ai_file',
      lbc_db: 'm2tw_descr_lbc_db_file',
      model_strat: 'm2tw_descr_model_strat',
      offmap_models: 'm2tw_offmap_models',
      standards: 'm2tw_descr_standards_file',
      settlement_plan: 'm2tw_descr_settlement_plan_file',
      ui_buildings: 'm2tw_descr_ui_buildings_file',
    };

    // Filename storage keys (for context auto-load)
    const nameKeys = {
      traits: 'm2tw_traits_file_name',
      anc: 'm2tw_anc_file_name',
      vnvs: 'm2tw_vnvs_file_name',
      anctxt: 'm2tw_anctxt_file_name',
      expunits: 'm2tw_export_units_file_name'
    };

    // Separate TGA files for auto image loading
    const ancTgaFiles = [];
    const unitTgaFiles = [];
    const bldTgaFiles = [];
    const portraitTgaFiles = [];
    const baseMapFiles = [];
    const groundTypeTgaFiles = [];
    const resourceTgaFiles = [];
    const factionSymbolFiles = [];
    const religionPipFiles = [];
    const eventPicFiles = [];
    const textLocFiles = {};

    let scannedCount = 0;
    for (const file of files) {
      if (++scannedCount % 40 === 0) await yieldToBrowser();
      const name = file.name.toLowerCase();
      const pathLower = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
      const pathFramed = `/${pathLower}`;

      let textOverride = null;
      const isTextLocalizationFile = name.endsWith('.txt') && (pathFramed.includes('/text/') || TEXT_LOCALIZATION_FILENAMES.has(name));
      if (isTextLocalizationFile) {
        await yieldToBrowser();
        textOverride = await readText(file);
        const locMap = parseTextLocFile(textOverride);
        const entries = textLocMapToEntries(locMap);
        await yieldToBrowser();
        if (entries.length > 0) {
          const storeName = name === 'expanded.txt' ? 'expanded_bi.txt' : file.name;
          textLocFiles[storeName] = { entries, rawText: textOverride, sourceFormat: 'txt' };
          const normalizedEntries = entries.map((entry) => ({
            key: String(entry.key || '').trim().replace(/^\{/, '').replace(/\}$/, ''),
            value: entry.value ?? ''
          }));
          if (/^expanded(?:_bi|_bi_wip)?\.txt$/i.test(name)) {
            try { localStorage.setItem('rtw_expanded_text_global', JSON.stringify({ entries: normalizedEntries, rawText: textOverride })); } catch {}
          } else if (name === 'menu_english.txt' || name === 'menu.txt') {
            try { localStorage.setItem('rtw_menu_text_global', JSON.stringify({ entries: normalizedEntries })); } catch {}
            window.dispatchEvent(new CustomEvent('menu-strings-updated'));
          } else if (name === 'export_buildings.txt') {
            try { localStorage.setItem('m2tw_edb_txt_file', textOverride); } catch {}
            loadTextFile(textOverride);
            setFileStatus((prev) => ({ ...prev, txt: 'ok' }));
          }
          if (name === 'export_vnvs.txt') {
            try {
              localStorage.setItem('m2tw_vnvs_file', textOverride);
              localStorage.setItem('m2tw_vnvs_file_name', file.name);
            } catch {}
            window.dispatchEvent(new CustomEvent('load-vnvs', { detail: { content: locMap, filename: file.name } }));
            setFileStatus((prev) => ({ ...prev, vnvs: 'ok' }));
          } else if (name === 'export_ancillaries.txt') {
            try {
              localStorage.setItem('m2tw_anctxt_file', textOverride);
              localStorage.setItem('m2tw_anctxt_file_name', file.name);
            } catch {}
            window.dispatchEvent(new CustomEvent('load-anctxt', { detail: { content: locMap, filename: file.name } }));
            setFileStatus((prev) => ({ ...prev, anctxt: 'ok' }));
          } else if (name === 'export_units.txt') {
            try {
              localStorage.setItem('m2tw_export_units_file', textOverride);
              localStorage.setItem('m2tw_export_units_file_name', file.name);
            } catch {}
            window.dispatchEvent(new CustomEvent('load-export-units'));
            setFileStatus((prev) => ({ ...prev, expunits: 'ok' }));
          } else if (name.endsWith('_regions_and_settlement_names.txt')) {
            try {
              sessionStorage.setItem('m2tw_names_raw', textOverride);
              localStorage.setItem('m2tw_campaign_names_raw', textOverride);
            } catch {}
          } else if (name === 'campaign_descriptions.txt') {
            try {
              sessionStorage.setItem('m2tw_campaign_desc_strings', JSON.stringify(locMap));
              localStorage.setItem('m2tw_campaign_descriptions_raw', textOverride);
            } catch {}
          } else if (name === 'names.txt') {
            try { sessionStorage.setItem('m2tw_char_names_display', JSON.stringify(locMap)); } catch {}
          }
        }
        if (!DATA_FILE_MAP[name]) continue;
      }

      // Route TGA files by folder path
      const inBaseWorldPath = pathFramed.includes('/maps/base/') || pathFramed.includes('/world/base/');

      if (name.endsWith('.tga')) {
        if (
          pathFramed.includes('/menu/symbols/fe_buttons_24/') ||
          pathFramed.includes('/menu/symbols/fe_buttons_48/') ||
          pathFramed.includes('/loading_screen/symbols/')
        ) {
          factionSymbolFiles.push(file);
        } else if (pathFramed.includes('/ui/ancillaries/')) {
          ancTgaFiles.push(file);
        } else if (pathFramed.includes('/ui/units/') || pathFramed.includes('/ui/unit_info/')) {
          unitTgaFiles.push(file);
        } else if (pathFramed.includes('/ui/') && pathFramed.includes('/buildings/')) {
          bldTgaFiles.push(file);
        } else if (pathFramed.includes('/ui/') && pathFramed.includes('/eventpics/')) {
          eventPicFiles.push(file);
        } else if (pathFramed.includes('/ui/') && (pathFramed.includes('/portraits/') || pathFramed.includes('/portrait/') || pathFramed.includes('/custom_portraits/'))) {
          portraitTgaFiles.push(file);
        } else if (pathFramed.includes('/ui/resources/') || pathFramed.includes('/ui/resource/')) {
          resourceTgaFiles.push(file);
        } else if (pathFramed.includes('/pips/') || pathFramed.includes('/religion/')) {
          religionPipFiles.push(file);
        } else if (inBaseWorldPath) {
          baseMapFiles.push(file);
        } else if (pathFramed.includes('/terrain/aerial_map/ground_types/')) {
          groundTypeTgaFiles.push(file);
        }
        continue;
      }

      // Base map text files (forward to campaign map editor)
      const BASE_MAP_TXTS = ['descr_strat.txt', 'descr_regions.txt', 'descr_sounds_music_types.txt', 'descr_terrain.txt'];
      if (BASE_MAP_TXTS.includes(name) && inBaseWorldPath) {
        baseMapFiles.push(file);
        if (name === 'descr_strat.txt' || name === 'descr_regions.txt') {
          const mapTxt = await readText(file);
          try {
            localStorage.setItem(name === 'descr_strat.txt' ? 'm2tw_campaign_strat' : 'm2tw_campaign_regions', mapTxt);
            sessionStorage.setItem(name === 'descr_strat.txt' ? 'm2tw_strat_raw' : 'm2tw_regions_raw', mapTxt);
          } catch {}
          setFileStatus((prev) => ({ ...prev, campaign_world: 'ok' }));
        }
        continue;
      }
      // descr_disasters.txt lives in maps/base/
      if (name === 'descr_disasters.txt' && inBaseWorldPath) {
        const txt = await readText(file);
        try { localStorage.setItem('m2tw_campaign_disasters', txt); sessionStorage.setItem('m2tw_disasters_raw', txt); } catch {}
        continue;
      }

      // Campaign map text + TGA files (base, imperial, or custom/* subfolders)
      const CAMPAIGN_MAP_TXTS = ['descr_strat.txt', 'descr_regions.txt', 'descr_mercenaries.txt', 'descr_win_conditions.txt', 'campaign_script.txt', 'descr_event.txt', 'descr_events.txt', 'description.txt', 'descr_faction_movies.xml', 'descr_disasters.txt'];
      const inCampaignPath = pathFramed.includes('/maps/campaign/') || inBaseWorldPath;
      const isStandaloneCampaignText = CAMPAIGN_MAP_TXTS.includes(name) && !DATA_FILE_MAP[name];
      if ((name.endsWith('.tga') && inCampaignPath) || (CAMPAIGN_MAP_TXTS.includes(name) && (inCampaignPath || isStandaloneCampaignText))) {
        baseMapFiles.push(file);
        // Store campaign text files in localStorage/sessionStorage for map editor
        const CAMPAIGN_STORE_MAP = {
          'descr_strat.txt': 'm2tw_campaign_strat',
          'campaign_script.txt': 'm2tw_campaign_script',
          'descr_mercenaries.txt': 'm2tw_campaign_mercenaries',
          'descr_win_conditions.txt': 'm2tw_campaign_win_conditions',
          'descr_faction_movies.xml': 'm2tw_campaign_faction_movies',
          'descr_events.txt': 'm2tw_campaign_events',
          'descr_event.txt': 'm2tw_campaign_events',
          'description.txt': 'm2tw_campaign_description',
          'descr_disasters.txt': 'm2tw_campaign_disasters',
        };
        const csKey = CAMPAIGN_STORE_MAP[name];
        if (csKey && !name.endsWith('.tga')) {
          const csTxt = await readText(file);
          try { localStorage.setItem(csKey, csTxt); } catch {}
          if (name === 'campaign_script.txt') loadCampaignScript(csTxt);
          if (name === 'descr_win_conditions.txt') {
            try { sessionStorage.setItem('m2tw_win_conditions_raw', csTxt); } catch {}
          }
          if (name === 'descr_faction_movies.xml') {
            try { sessionStorage.setItem('m2tw_faction_movies_raw', csTxt); } catch {}
          }
          if (name === 'descr_events.txt' || name === 'descr_event.txt') {
            try { sessionStorage.setItem('m2tw_campaign_events_raw', csTxt); } catch {}
          }
          if (name === 'description.txt') {
            try { sessionStorage.setItem('m2tw_campaign_description', csTxt); localStorage.setItem('m2tw_campaign_description', csTxt); } catch {}
          }
          if (name === 'descr_disasters.txt') {
            try { sessionStorage.setItem('m2tw_disasters_raw', csTxt); } catch {}
          }
          if (name === 'descr_mercenaries.txt') {
            try { sessionStorage.setItem('m2tw_mercenaries_raw', csTxt); } catch {}
          }
          if (name === 'descr_strat.txt' || name === 'descr_regions.txt' || name === 'descr_win_conditions.txt') {
            setFileStatus((prev) => ({ ...prev, campaign_world: 'ok' }));
          }
        }
        if (name.endsWith('.tga') || !DATA_FILE_MAP[name]) continue;
      }

      const key = DATA_FILE_MAP[name];
      if (!key) continue;

      setFileStatus((prev) => ({ ...prev, [key]: 'loading' }));

      const text = textOverride ?? await readText(file);
      if (key === 'aerial_ground_types') {
        const parsed = parseDescrAerialGroundTypes(text);
        try {localStorage.setItem('m2tw_aerial_ground_types', JSON.stringify(parsed));} catch {}
        window._m2tw_aerial_ground_types = parsed;
        setFileStatus((prev) => ({ ...prev, aerial_ground_types: 'ok' }));
        continue;
      } else if (key === 'edb') {
        loadEDB(text, file.name);
      } else if (rawStoreKeys[key]) {
        try {
          localStorage.setItem(rawStoreKeys[key], text);
          localStorage.setItem(`${rawStoreKeys[key]}_name`, file.name);
          sessionStorage.setItem(`${rawStoreKeys[key]}_raw`, text);
        } catch {}
        if (key === 'banners') {
          try { localStorage.setItem(BANNERS_GLOBAL_KEY, text); } catch {}
          window.dispatchEvent(new CustomEvent('banners-text-loaded'));
        }
        if (key === 'offmap_models') {
          window.dispatchEvent(new CustomEvent('offmap-models-updated'));
        }
        if (key === 'descr_character' || key === 'model_strat') {
          window.dispatchEvent(new CustomEvent('strat-model-files-loaded', { detail: { key, text, filename: file.name } }));
        }
      } else if (storeKeys[key]) {
        try {
          localStorage.setItem(storeKeys[key], text);
          if (nameKeys[key]) localStorage.setItem(nameKeys[key], file.name);
          // Also store in sessionStorage for editors that need it
          if (key === 'religions') sessionStorage.setItem('m2tw_religions_raw', text);
          if (key === 'rebel_fac') sessionStorage.setItem('m2tw_rebel_factions_raw', text);
          if (key === 'cultures') {
            sessionStorage.setItem('m2tw_cultures_raw', text);
            const cultures = [...new Set(text.split('\n').map(line => line.replace(/;.*$/, '').trim().match(/^culture\s+(\S+)/i)?.[1]).filter(Boolean))].sort();
            if (cultures.length) localStorage.setItem('m2tw_cultures_list', JSON.stringify(cultures));
          }
          if (key === 'religions') {
            const religions = [...new Set(text.split('\n').map(line => line.replace(/;.*$/, '').trim().match(/^religion\s+(\S+)/i)?.[1]).filter(Boolean))].sort();
            if (religions.length) localStorage.setItem('m2tw_religions_list', JSON.stringify(religions));
          }
          if (key === 'names') {
            sessionStorage.setItem('m2tw_descr_names_raw', text);
            window.dispatchEvent(new CustomEvent('load-character-names', { detail: { raw: text } }));
          }
          if (key === 'traits') sessionStorage.setItem('m2tw_traits_raw', text);
          if (key === 'anc') sessionStorage.setItem('m2tw_ancillaries_raw', text);
          if (key === 'expunits') {
            window.dispatchEvent(new CustomEvent('load-export-units'));
          }
          if (key === 'traits') {
            window.dispatchEvent(new CustomEvent('load-traits', { detail: { content: text, filename: file.name } }));
          }
          if (key === 'vnvs') {
            window.dispatchEvent(new CustomEvent('load-vnvs', { detail: { content: text, filename: file.name } }));
          }
          if (key === 'anc') {
            window.dispatchEvent(new CustomEvent('load-ancillaries', { detail: { content: text, filename: file.name } }));
          }
          if (key === 'anctxt') {
            window.dispatchEvent(new CustomEvent('load-anctxt', { detail: { content: text, filename: file.name } }));
          }
          if (key === 'modeldb') {
            if (name === 'descr_model_battle.txt') {
              try { localStorage.setItem('m2tw_descr_model_battle_file', text); } catch {}
              try { localStorage.setItem('m2tw_descr_model_battle_name', file.name); } catch {}
              saveLargeText('m2tw_descr_model_battle_file', text, { filename: file.name }).catch(() => {});
            }
            try { localStorage.setItem('m2tw_modeldb_file_name', file.name); } catch {}
            window.dispatchEvent(new CustomEvent('modeldb-file-loaded', { detail: { text, filename: file.name } }));
          }
          if (key === 'cultures') window.dispatchEvent(new CustomEvent('cultures-file-loaded', { detail: { text, filename: file.name } }));
          if (key === 'religions') window.dispatchEvent(new CustomEvent('religions-file-loaded', { detail: { text, filename: file.name } }));
        } catch {}
      } else {
        loaderMap[key]?.(text, file.name);
        // Store factions in sessionStorage for campaign map editor
        if (key === 'fac') {
          try {
            sessionStorage.setItem('m2tw_factions_raw', text);
            localStorage.setItem('m2tw_sm_factions_raw', text);
            localStorage.setItem('m2tw_factions_file', text);
            localStorage.setItem('m2tw_factions_file_name', file.name);
          } catch {}
          storeFactionSymbolAliasesFromText(text);
          window.dispatchEvent(new CustomEvent('factions-file-loaded'));
        }
        // Store resources in sessionStorage + localStorage
        if (key === 'res') {
          try {
            sessionStorage.setItem('m2tw_sm_resources_raw', text);
            localStorage.setItem('m2tw_resources_file', text);
          } catch {}
        }
        // Store EDU in localStorage for campaign map editor
        if (key === 'unit') {
          setEduRawText(text, file.name);
          window.dispatchEvent(new CustomEvent('edu-file-loaded'));
        }
      }
      setFileStatus((prev) => ({ ...prev, [key]: 'ok' }));
    }

    // Flush Rome text localization files into the shared store.
    const localizationFiles = { ...textLocFiles };
    if (Object.keys(localizationFiles).length > 0) {
      setFileStatus((prev) => ({ ...prev, text_loc: 'loading' }));
      const existing = getTextLocalizationStore();
      const merged = { ...existing, ...localizationFiles };
      setTextLocalizationStore(merged);
      // Dispatch specific events for vnvs/ancillaries text files so contexts pick them up directly
      for (const [filename, binData] of Object.entries(localizationFiles)) {
        const lname = filename.toLowerCase();
        const map = {};
        for (const e of binData.entries) map[e.key] = e.value;
        if (lname.includes('vnv')) {
          window.dispatchEvent(new CustomEvent('load-vnvs', { detail: { content: map, filename } }));
        } else if (lname.includes('ancillar')) {
          window.dispatchEvent(new CustomEvent('load-anctxt', { detail: { content: map, filename } }));
        }
        // Load export_buildings.txt into the EDB text context
        if (lname.includes('export_buildings')) {
          const textContent = binData.entries.map((e) => `{${e.key}}${e.value}`).join('\n');
          loadTextFile(textContent);
          setFileStatus((prev) => ({ ...prev, txt: 'ok' }));
        }
      }
      window.dispatchEvent(new CustomEvent('text-localization-updated', { detail: { bulk: true } }));
      setTextLocCount(Object.keys(merged).length);
      setFileStatus((prev) => ({ ...prev, ...statusFromTextLocalizationStore(merged), text_loc: 'ok' }));
    }

    // Auto-load ancillary images
    if (ancTgaFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, anc_images: 'loading' }));
      runInBackground(async () => {
        const images = {};
        for (const item of await decodeTgaFiles(ancTgaFiles)) {
          if (item) images[item.file.name.replace(/\.tga$/i, '').toLowerCase()] = item.dataUrl;
        }
        window.dispatchEvent(new CustomEvent('load-anc-tga-batch', { detail: images }));
        setAncImgCount(Object.keys(images).length);
        setFileStatus((prev) => ({ ...prev, anc_images: 'ok' }));
      });
    }

    // Auto-load unit images (icon: #dict.tga in ui/units/[faction|merc]/, info: dict_info.tga in ui/unit_info/[faction|merc]/)
    if (unitTgaFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, unit_images: 'loading' }));
      registerUnitImageFiles(unitTgaFiles);
      window._m2tw_unit_images = { ...(window._m2tw_unit_images || {}) };
      window.dispatchEvent(new CustomEvent('unit-image-files-loaded'));
      window.dispatchEvent(new CustomEvent('load-unit-images', { detail: { images: window._m2tw_unit_images } }));
      setUnitImgCount(Object.keys(window._m2tw_unit_image_file_map || {}).length);
      setFileStatus((prev) => ({ ...prev, unit_images: 'ok' }));
    }

    // Auto-load faction logos from data\menu\symbols\FE_buttons_* and data\loading_screen\symbols.
    if (factionSymbolFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, faction_logos: 'loading' }));
      runInBackground(async () => {
        const result = await loadFactionSymbolFiles(factionSymbolFiles);
        const total = countStoredFactionSymbols();
        setFactionLogoCount(total || result.loaded);
        setFileStatus((prev) => ({ ...prev, faction_logos: result.loaded > 0 ? 'ok' : 'idle' }));
      });
    }

    // Auto-load religion pip images
    if (religionPipFiles.length > 0) {
      runInBackground(async () => {
        const pips = {};
        for (const item of await decodeTgaFiles(religionPipFiles)) {
          if (item) pips[item.file.name.replace(/\.tga$/i, '').toLowerCase()] = item.dataUrl;
        }
        window._m2tw_religion_pips = { ...(window._m2tw_religion_pips || {}), ...pips };
      });
    }

    // Auto-load resource icons (ui/resources/*.tga)
    if (resourceTgaFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, resource_icons: 'loading' }));
      runInBackground(async () => {
        const icons = {};
        for (const item of await decodeTgaFiles(resourceTgaFiles)) {
          if (item) icons[item.file.name.replace(/\.tga$/i, '').toLowerCase()] = item.dataUrl;
        }
        window._m2tw_resource_icons = { ...(window._m2tw_resource_icons || {}), ...icons };
        window.dispatchEvent(new CustomEvent('load-resource-icons', { detail: icons }));
        setFileStatus((prev) => ({ ...prev, resource_icons: 'ok' }));
      });
    }

    // Auto-load ground type textures
    if (groundTypeTgaFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, ground_textures: 'loading' }));
      runInBackground(async () => {
        const textures = {};
        for (const item of await decodeTgaFiles(groundTypeTgaFiles)) {
          if (item) textures[item.file.name.replace(/\.tga$/i, '').toLowerCase()] = item.dataUrl;
        }
        window._m2tw_ground_textures = textures;
        window.dispatchEvent(new CustomEvent('load-ground-textures', { detail: textures }));
        setGroundTexCount(Object.keys(textures).length);
        setFileStatus((prev) => ({ ...prev, ground_textures: 'ok' }));
      });
    }

    // Auto-load base map files
    if (baseMapFiles.length > 0) {
      const mergedFiles = mergeFilesByPath(window._m2tw_map_files || [], baseMapFiles);
      window._m2tw_map_files = mergedFiles;
      window.dispatchEvent(new CustomEvent('m2tw-map-folder-loaded', { detail: { files: mergedFiles, source: 'base' } }));
      setMapFileCount(mergedFiles.length);
      setFileStatus((prev) => ({ ...prev, base_map: 'ok' }));
    }

    // Auto-load portrait images from data\ui\custom_portraits\[portrait_name]\portrait_*.tga
    if (portraitTgaFiles.length > 0) {
      runInBackground(async () => {
        const portraits = { ...(window._m2tw_portraits || {}) };
        for (const item of await decodeTgaFiles(portraitTgaFiles)) {
          if (item) {
            const { file, dataUrl } = item;
            const pathLower2 = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
            const baseName = file.name.replace(/\.tga$/i, '').toLowerCase();
            // Extract portrait folder name from path: custom_portraits/[folder]/portrait_*.tga
            const match = pathLower2.match(/custom_portraits\/([^/]+)\//);
            if (match) {
              // Key: "folderName/portrait_young" etc.
              portraits[`${match[1]}/${baseName}`] = dataUrl;
            } else {
              portraits[baseName] = dataUrl;
            }
          }
        }
        window._m2tw_portraits = portraits;
        window.dispatchEvent(new CustomEvent('load-portraits', { detail: portraits }));
      });
    }

    // Auto-load event pics from data\ui\[culture]\eventpics\
    if (eventPicFiles.length > 0) {
      runInBackground(async () => {
        const pics = { ...(window._m2tw_event_pics || {}) };
        for (const item of await decodeTgaFiles(eventPicFiles)) {
          if (item) {
            const { file, dataUrl } = item;
            const pathLower = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
            // Extract culture name from path: ui/[culture]/eventpics/name.tga
            const match = pathLower.match(/\/ui\/([^/]+)\/eventpics\//);
            const culture = match ? match[1] : 'unknown';
            const baseName = file.name.replace(/\.tga$/i, '').toLowerCase();
            pics[`${culture}/${baseName}`] = dataUrl;
            // Also store without culture prefix (last-write wins) for fallback
            pics[baseName] = dataUrl;
          }
        }
        window._m2tw_event_pics = pics;
        window.dispatchEvent(new CustomEvent('load-event-pics', { detail: pics }));
      });
    }

    // Auto-load building images from data\ui\[culture]\buildings\
    if (bldTgaFiles.length > 0) {
      setFileStatus((prev) => ({ ...prev, bld_images: 'loading' }));
      runInBackground(async () => {
        const parsed = [];
        for (const item of await decodeTgaFiles(bldTgaFiles)) {
          if (item) {
            parsed.push({ path: item.file.webkitRelativePath || item.file.name, name: item.file.name, url: item.dataUrl });
          }
        }
        loadBuildingTgaImages(parsed, true); // replace=true clears stale images
        setBldImgCount(parsed.length);
        setFileStatus((prev) => ({ ...prev, bld_images: 'ok' }));
      });
    }
  };

  const handleDataFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    await processDataFiles(files);
  };

  const handleAncImagesFolder = async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.name.toLowerCase().endsWith('.tga'));
    e.target.value = '';
    if (files.length === 0) return;
    setFileStatus((prev) => ({ ...prev, anc_images: 'loading' }));
    const images = {};
    for (const item of await decodeTgaFiles(files)) {
      if (item) {
        const key = item.file.name.replace(/\.tga$/i, '').toLowerCase();
        images[key] = item.dataUrl;
      }
    }
    window.dispatchEvent(new CustomEvent('load-anc-tga-batch', { detail: images }));
    setAncImgCount(Object.keys(images).length);
    setFileStatus((prev) => ({ ...prev, anc_images: 'ok' }));
  };

  const handleUnitUiFolder = async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.name.toLowerCase().endsWith('.tga'));
    e.target.value = '';
    if (files.length === 0) return;
    setFileStatus((prev) => ({ ...prev, unit_images: 'loading' }));
    registerUnitImageFiles(files);
    window._m2tw_unit_images = { ...(window._m2tw_unit_images || {}) };
    window.dispatchEvent(new CustomEvent('unit-image-files-loaded'));
    window.dispatchEvent(new CustomEvent('load-unit-images', { detail: { images: window._m2tw_unit_images } }));
    setUnitImgCount(Object.keys(window._m2tw_unit_image_file_map || {}).length);
    setFileStatus((prev) => ({ ...prev, unit_images: 'ok' }));
  };

  const handleBldImagesFolder = async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.name.toLowerCase().endsWith('.tga'));
    e.target.value = '';
    if (files.length === 0) return;
    setFileStatus((prev) => ({ ...prev, bld_images: 'loading' }));
    const parsed = [];
    for (const item of await decodeTgaFiles(files)) {
      if (item) {
        parsed.push({ path: item.file.webkitRelativePath || item.file.name, name: item.file.name, url: item.dataUrl });
      }
    }
    loadBuildingTgaImages(parsed);
    setBldImgCount(parsed.length);
    setFileStatus((prev) => ({ ...prev, bld_images: 'ok' }));
  };

  const handleCampaignFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setFileStatus((prev) => ({ ...prev, campaign_folder: 'loading' }));
    setCampaignError('');

    // Accept both descr_event.txt (singular, in campaign folder) and descr_events.txt (plural)
    const eventFile = files.find((f) => {
      const n = f.name.toLowerCase();
      return n === 'descr_event.txt' || n === 'descr_events.txt';
    });
    // Load event counters from the campaign descr_event.txt (if present)
    if (eventFile) {
      const evText = await readText(eventFile);
      const evs = parseEventsFromCampaign(evText);
      if (evs.length > 0) loadEventsFile(evText);
    }

    // Campaign-specific text files stored in localStorage for campaign map editor
    const CAMPAIGN_STORE = {
      'descr_strat.txt': 'm2tw_campaign_strat',
      'campaign_script.txt': 'm2tw_campaign_script',
      'descr_mercenaries.txt': 'm2tw_campaign_mercenaries',
      'descr_win_conditions.txt': 'm2tw_campaign_win_conditions',
      'descr_faction_movies.xml': 'm2tw_campaign_faction_movies',
      'descr_events.txt': 'm2tw_campaign_events',
      'descr_event.txt': 'm2tw_campaign_events',
      'description.txt': 'm2tw_campaign_description',
      'descr_disasters.txt': 'm2tw_campaign_disasters',
    };

    // Also store rebel factions + EDB from this folder if present
    const CAMPAIGN_EXTRA_STORE = {
      'descr_rebel_factions.txt': 'm2tw_rebel_factions_file',
      'export_descr_buildings.txt': 'm2tw_edb_file'
    };

    const textLocFiles = {};

    for (const file of files) {
      const name = file.name.toLowerCase();
      const pathLower = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
      const pathFramed = `/${pathLower}`;

      const isTextLocalizationFile = name.endsWith('.txt') && (pathFramed.includes('/text/') || TEXT_LOCALIZATION_FILENAMES.has(name));
      if (isTextLocalizationFile) {
        await yieldToBrowser();
        const text = await readText(file);
        const locMap = parseTextLocFile(text);
        const entries = textLocMapToEntries(locMap);
        await yieldToBrowser();
        if (entries.length > 0) {
          const storeName = name === 'expanded.txt' ? 'expanded_bi.txt' : file.name;
          textLocFiles[storeName] = { entries, rawText: text, sourceFormat: 'txt' };
          const normalizedEntries = entries.map((entry) => ({
            key: String(entry.key || '').trim().replace(/^\{/, '').replace(/\}$/, ''),
            value: entry.value ?? ''
          }));
          if (/^expanded(?:_bi|_bi_wip)?\.txt$/i.test(name)) {
            try { localStorage.setItem('rtw_expanded_text_global', JSON.stringify({ entries: normalizedEntries, rawText: text })); } catch {}
          } else if (name === 'menu_english.txt' || name === 'menu.txt') {
            try { localStorage.setItem('rtw_menu_text_global', JSON.stringify({ entries: normalizedEntries })); } catch {}
            window.dispatchEvent(new CustomEvent('menu-strings-updated'));
          }
          if (name.endsWith('_regions_and_settlement_names.txt')) {
            try { sessionStorage.setItem('m2tw_names_raw', text); } catch {}
          }
          if (name === 'campaign_descriptions.txt') {
            try { sessionStorage.setItem('m2tw_campaign_desc_strings', JSON.stringify(locMap)); } catch {}
            try { localStorage.setItem('m2tw_campaign_descriptions_raw', text); } catch {}
          }
          if (name === 'names.txt') {
            try { sessionStorage.setItem('m2tw_char_names_display', JSON.stringify(locMap)); } catch {}
          }
        }
        continue;
      }

      const csKey = CAMPAIGN_STORE[name];
      if (csKey) {
        const txt = await readText(file);
        try {localStorage.setItem(csKey, txt);} catch {}
        if (name === 'descr_mercenaries.txt') {
          try { sessionStorage.setItem('m2tw_mercenaries_raw', txt); } catch {}
        }
        if (name === 'campaign_script.txt') loadCampaignScript(txt);
        if (name === 'descr_win_conditions.txt') {
          try { sessionStorage.setItem('m2tw_win_conditions_raw', txt); } catch {}
        }
        if (name === 'descr_faction_movies.xml') {
          try { sessionStorage.setItem('m2tw_faction_movies_raw', txt); } catch {}
        }
        if (name === 'descr_events.txt' || name === 'descr_event.txt') {
          try { sessionStorage.setItem('m2tw_campaign_events_raw', txt); } catch {}
        }
        if (name === 'description.txt') {
          try { sessionStorage.setItem('m2tw_campaign_description', txt); localStorage.setItem('m2tw_campaign_description', txt); } catch {}
        }
        if (name === 'descr_disasters.txt') {
          try { sessionStorage.setItem('m2tw_disasters_raw', txt); } catch {}
        }
      }

      const extraKey = CAMPAIGN_EXTRA_STORE[name];
      if (extraKey) {
        const txt = await readText(file);
        try {localStorage.setItem(extraKey, txt);} catch {}
        if (name === 'descr_rebel_factions.txt') {
          try {sessionStorage.setItem('m2tw_rebel_factions_raw', txt);} catch {}
          setFileStatus((prev) => ({ ...prev, rebel_fac: 'ok' }));
        }
        if (name === 'export_descr_buildings.txt') {
          loadEDB(txt, file.name);
          setFileStatus((prev) => ({ ...prev, edb: 'ok' }));
        }
      }
    }

    // Flush text localization files into shared store
    const localizationFiles = { ...textLocFiles };
    if (Object.keys(localizationFiles).length > 0) {
      const { getTextLocalizationStore, setTextLocalizationStore } = await import('@/lib/textLocalizationStore');
      const existing = getTextLocalizationStore();
      const merged = { ...existing, ...localizationFiles };
      setTextLocalizationStore(merged);
      window.dispatchEvent(new CustomEvent('text-localization-updated', { detail: { bulk: true } }));
      setTextLocCount(Object.keys(merged).length);
      setFileStatus((prev) => ({ ...prev, ...statusFromTextLocalizationStore(merged), text_loc: 'ok' }));
    }

    const relevant = files.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.tga') || n.endsWith('.txt');
    });
    // Merge with existing base map files so campaign overrides base
    const existing = window._m2tw_map_files || [];
    const existingNames = new Set(relevant.map(fileIdentity));
    const mergedFiles = existing.filter((f) => !existingNames.has(fileIdentity(f))).concat(relevant);
    window._m2tw_map_files = mergedFiles;
    window.dispatchEvent(new CustomEvent('m2tw-map-folder-loaded', { detail: { files: mergedFiles, source: 'campaign' } }));
    setMapFileCount(mergedFiles.length);
    // Detect campaign name from path
    setCampaignName(detectCampaignFolderName(files));
    setFileStatus((prev) => ({ ...prev, campaign_folder: 'ok' }));
  };

  const edbLoaded = fileStatus.edb === 'ok' || !!edbData?.buildings?.length;

  const handleClearMemory = () => {
    try {
      // Nuke everything — localStorage, sessionStorage, and window globals
      localStorage.clear();
      sessionStorage.clear();
      clearTextLocalizationStore();
      window._m2tw_resource_icons = {};
      window._m2tw_map_files = [];
      window._m2tw_unit_images = {};
      window._m2tw_unit_image_file_map = {};
      window._m2tw_unit_image_files = [];
      window._m2tw_ground_textures = {};
      window._m2tw_aerial_ground_types = {};
      window._m2tw_faction_symbol_previews = {};
      window._m2tw_faction_symbol_aliases = {};
      window.location.reload();
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-start gap-6 pt-8">

      {/* Header */}
      <div
        className="w-full max-w-4xl min-h-[170px] rounded-lg border border-border overflow-hidden bg-cover bg-center shadow-xl shadow-black/20"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(18, 17, 13, 0.94), rgba(18, 17, 13, 0.70), rgba(18, 17, 13, 0.20)), url(${romeHero})` }}>
        <div className="min-h-[170px] p-5 sm:p-6 flex flex-col justify-end gap-3">
          <img src={romeLogo} alt="Rome: Total War" className="w-56 max-w-[78vw] h-auto drop-shadow-[0_3px_10px_rgba(0,0,0,0.75)]" />
          <div className="max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Rome: Total War Mod Editor</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read, edit, and export Rome: Total War data files from a loaded data folder. Use the Export page when done to download a complete [mod name]\data\ folder.
            </p>
          </div>
        </div>
      </div>

      {/* Mod Name */}
      <div className="w-full max-w-4xl bg-card border border-border rounded-lg p-4 flex items-center gap-3">
        <Package className="w-4 h-4 text-primary shrink-0" />
        <label className="text-xs font-semibold text-foreground whitespace-nowrap">Mod Name</label>
        <input
          type="text"
          value={modName}
          onChange={(e) => {
            const v = e.target.value.replace(/[^a-zA-Z0-9_\-]/g, '_');
            setModName(v);
            try {localStorage.setItem('m2tw_mod_name', v);} catch {}
          }}
          placeholder="my_mod"
          className="flex-1 h-8 px-3 text-xs bg-background border border-border rounded-md text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary" />

        <span className="text-[10px] text-muted-foreground whitespace-nowrap">Used in the exported zip path</span>
      </div>

      {/* Step 1 — data folder + UI images */}
      <div className="w-full max-w-4xl bg-card border border-border rounded-lg overflow-hidden">
        <div
          className="p-4 border-b border-border bg-cover bg-center"
          style={{ backgroundImage: `linear-gradient(90deg, rgba(35, 24, 13, 0.96), rgba(60, 16, 13, 0.82), rgba(60, 16, 13, 0.60)), url(${romeUi})` }}>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Castle className="w-4 h-4 text-primary" />
            Step 1 — Load Rome: Total War Files &amp; Images
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">Browse a full data\ folder to load game files, campaign map files, text localization, and UI images.</p>
        </div>
        <div className="p-4 space-y-4">
          {/* Text files */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Game Data Files</p>
            <DataFolderPicker onLoad={handleDataFolderFromPicker} loading={loadingData} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <FileStatus label="Buildings (EDB)" hint="export_descr_buildings.txt" status={fileStatus.edb} />
              <FileStatus label="Building Text" hint="text\export_buildings.txt" status={fileStatus.txt} />
              <FileStatus label="Factions" hint="descr_sm_factions.txt" status={fileStatus.fac} />
              <FileStatus label="Resources" hint="descr_sm_resources.txt" status={fileStatus.res} />
              <FileStatus label="Units" hint="export_descr_unit.txt" status={fileStatus.unit} />
              <FileStatus label="Banners" hint="descr_banners.txt" status={fileStatus.banners} />
              <FileStatus label="Building Battle" hint="descr_building_battle.txt" status={fileStatus.building_battle} />
              <FileStatus label="Strat Characters" hint="descr_character.txt" status={fileStatus.descr_character} />
              <FileStatus label="Formations AI" hint="descr_formations_ai.txt" status={fileStatus.formations_ai} />
              <FileStatus label="LBC DB" hint="descr_lbc_db.txt" status={fileStatus.lbc_db} />
              <FileStatus label="Strat Models" hint="descr_model_strat.txt" status={fileStatus.model_strat} />
              <FileStatus label="Offmap Models" hint="descr_offmap_models.txt" status={fileStatus.offmap_models} />
              <FileStatus label="Standards" hint="descr_standards.txt" status={fileStatus.standards} />
              <FileStatus label="Settlement Plan" hint="descr_settlement_plan.txt" status={fileStatus.settlement_plan} />
              <FileStatus label="UI Buildings" hint="descr_ui_buildings.txt" status={fileStatus.ui_buildings} />
              {/* Events loaded in Step 2 (campaign descr_event.txt) — not shown here */}
              <FileStatus label="Traits" hint="export_descr_character_traits.txt" status={fileStatus.traits} />

              <FileStatus label="Ancillaries" hint="export_descr_ancillaries.txt" status={fileStatus.anc} />

              <FileStatus label="Unit Descriptions" hint="text\export_units.txt" status={fileStatus.expunits} />
              <FileStatus label="Cultures" hint="descr_cultures.txt" status={fileStatus.cultures} />
              <FileStatus label="Names" hint="descr_names.txt" status={fileStatus.names} />
              <FileStatus label="Rebel Factions" hint="descr_rebel_factions.txt" status={fileStatus.rebel_fac} />
              <FileStatus label="Religions" hint="descr_religions.txt" status={fileStatus.religions} />
              <FileStatus label="Guilds" hint="export_descr_guilds.txt" status={fileStatus.guilds} />
              <FileStatus label="Battle Models" hint="battle_models.modeldb / descr_model_battle.txt" status={fileStatus.modeldb} />
              <FileStatus label="Text Localization" hint={fileStatus.text_loc === 'ok' ? `${textLocCount} text files loaded` : 'text\\*.txt'} status={fileStatus.text_loc} />
              <FileStatus label="World/Base Campaign" hint="descr_strat / regions / win_conditions" status={fileStatus.campaign_world} />
            </div>
          </div>

          

          {/* UI images */}
          <div className="space-y-2">
            























            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <FileStatus
                label="Ancillary Images"
                hint={fileStatus.anc_images === 'ok' ? `${ancImgCount} images loaded` : 'data\\ui\\ancillaries\\'}
                status={fileStatus.anc_images} />

              <FileStatus
                label="Unit UI Images"
                hint={fileStatus.unit_images === 'ok' ? `${unitImgCount} images loaded` : 'data\\ui\\units\\ + unit_info\\'}
                status={fileStatus.unit_images} />

              <FileStatus
                label="Faction Logos"
                hint={fileStatus.faction_logos === 'ok' ? `${factionLogoCount} symbol previews loaded` : 'data\\menu\\symbols\\ + loading_screen\\symbols\\'}
                status={fileStatus.faction_logos || 'idle'} />

              <FileStatus
                label="Building Images"
                hint={fileStatus.bld_images === 'ok' ? `${bldImgCount} images loaded` : 'data\\ui\\[culture]\\buildings\\'}
                status={fileStatus.bld_images || 'idle'} />

              <FileStatus
                label="Ground Textures"
                hint={fileStatus.ground_textures === 'ok' ? `${groundTexCount} textures loaded` : 'data\\terrain\\aerial_map\\ground_types\\'}
                status={fileStatus.ground_textures || 'idle'} />

              <FileStatus
                label="Resource Icons"
                hint="data\\ui\\resources\\ (auto from Step 1)"
                status={fileStatus.resource_icons || 'idle'} />

            </div>
          </div>
        </div>
      </div>

      {/* Step 2 — Campaign Map */}
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl overflow-hidden hidden">
        








        
        









































        
      </div>

      {/* Info */}
      <div className="w-full max-w-2xl flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
        <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Browsers can read but not write to disk. When you're done editing, go to <strong className="text-foreground">Export</strong> to download a zip of your
          complete <code className="text-[10px] font-mono bg-accent px-1 rounded">{modName || 'my_mod'}\data\</code> folder.
        </p>
      </div>

      {/* Actions */}
      <div className="w-full max-w-2xl flex flex-col gap-2">
        {edbLoaded &&
        <Link to={createPageUrl('EDBEditor')}>
            





          </Link>
        }
        {edbLoaded && edbData &&
        <div className="flex gap-2 flex-wrap justify-center pt-1">
            <Badge variant="outline" className="text-[10px]">{edbData.buildings.length} buildings</Badge>
            <Badge variant="outline" className="text-[10px]">{edbData.buildings.reduce((s, b) => s + b.levels.length, 0)} levels</Badge>
            <Badge variant="outline" className="text-[10px]">{edbData.hiddenResources.length} hidden resources</Badge>
          </div>
        }
        <Button variant="ghost" className="bg-slate-100 text-gray-900 px-4 py-2 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-9 hover:text-foreground" onClick={handleClearMemory}>
          Clear All Cached Data & Reload
        </Button>
      </div>
    </div>);

}
