import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Map, CheckSquare, Globe, FolderOpen, Box } from 'lucide-react';
import Map3DPreview from '../components/map/Map3DPreview';
import MapCanvas, { floodFillRGB } from '../components/map/MapCanvas';
import MapPaintToolbar from '../components/map/MapPaintToolbar';
import MapValidationPanel from '../components/map/MapValidationPanel';
import StratOverlay from '../components/map/StratOverlay';
import StratPanel from '../components/map/StratPanel';
import NewRegionPaintWizard from '../components/map/NewRegionPaintWizard';
import { loadTGA } from '../components/map/tgaLoader';
import { exportTGA, downloadBlob } from '../components/map/tgaExporter';
import { LAYER_DEFS } from '../components/map/mapLayerConstants';
import { parseDescrStrat, parseDescrRegions, parseSettlementNames, parseDescrSmFactions, computeSettlementPositions, serializeDescrStrat, serializeDescrRegions } from '../components/map/stratParser';
import { parseDescrRebelFactions, parseDescrReligions, parseDescrSmResources, parseDescrMercenaries, parseDescrSoundsMusicTypes, parseDescrCultures, extractHiddenResourcesFromEDB, extractBuildingLevelsFromEDB, parseDescrNames, parseExportDescrTraits, parseExportDescrAncillaries } from '../components/map/additionalParsers';
import { parseFactionMovies } from '../components/map/factionMoviesParser';
import { parseEDU } from '../components/units/EDUParser';
import { parseStringsBin } from '../components/strings/stringsBinCodec';
import { getStringsBinStore } from '../lib/stringsBinStore';
import { importCampaignToDatabase } from '../components/map/campaignImporter';
import { useEDB } from '../components/edb/EDBContext';
import { base44 } from '@/api/base44Client';
import { setLayer, getLayer, getAllLayers, hasAnyLayer } from '../lib/mapLayerStore';

const INITIAL_PAINT = {
  active: false,
  layerId: 'heights',
  paintColor: { r: 128, g: 128, b: 128 },
  tool: 'pencil',
  brushSize: 1,
};

// Files we recognize in a campaign/base folder
const TGA_MAP = {
  'map_heights.tga':     'heights',
  'map_ground_types.tga':'ground',
  'map_climates.tga':    'climates',
  'map_regions.tga':     'regions',
  'map_features.tga':    'features',
  'map_fog.tga':         'fog',
};
const TXT_MAP = {
  'descr_strat.txt':     'strat',
  'descr_regions.txt':   'regions',
  'descr_sm_factions.txt':'factions',
};

export default function CampaignMap() {
  const [layers, setLayers] = useState(() => {
    // Restore pixel data from module-level store (survives navigation, not page close)
    const stored = getAllLayers();
    return Object.fromEntries(LAYER_DEFS.map(d => {
      const base = { visible: d.defaultVisible, opacity: d.defaultOpacity };
      const saved = stored[d.id];
      if (saved?.data) return [d.id, { ...base, ...saved }];
      return [d.id, base];
    }));
  });
  const [dirtyLayers, setDirtyLayers] = useState(new Set());
  const [overlayDirty, setOverlayDirty] = useState(false);
  const [paintState, setPaintState] = useState(INITIAL_PAINT);
  const [activeTab, setActiveTab] = useState('strat');
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [showPixelGrid, setShowPixelGrid] = useState(false);
  const [regionsMode, setRegionsMode] = useState('fill');

  // Strat overlay state — initialize from sessionStorage if available
  const [stratData, setStratDataRaw] = useState(() => {
    try {
      const raw = sessionStorage.getItem('m2tw_strat_raw');
      if (raw && raw.length < 20_000_000) { // guard against absurdly large files
        const p = parseDescrStrat(raw);
        // Merge any persisted overlay items (includes newly added items from previous session)
        const savedOverlay = sessionStorage.getItem('m2tw_overlay_items_json');
        if (savedOverlay) {
          const savedItems = JSON.parse(savedOverlay);
          // Add new items (negative IDs) that aren't in the parsed strat
          const parsedIds = new Set((p.items || []).map(i => i.id));
          const newItems = savedItems.filter(i => i.id < 0 && !parsedIds.has(i.id));
          if (newItems.length > 0) {
            return { ...p, items: [...(p.items || []), ...newItems] };
          }
        }
        return p;
      }
    } catch (e) {
      console.error('[CampaignMap] Failed to restore strat from sessionStorage:', e);
      try { sessionStorage.removeItem('m2tw_strat_raw'); } catch {}
    }
    return null;
  });
  const [regionsData, setRegionsDataRaw] = useState(() => {
    try {
      // Prefer the JSON snapshot which includes any newly added regions
      const savedJson = sessionStorage.getItem('m2tw_regions_data_json');
      if (savedJson) return JSON.parse(savedJson);
      const raw = sessionStorage.getItem('m2tw_regions_raw');
      if (raw && raw.length < 5_000_000) return parseDescrRegions(raw);
    } catch (e) {
      console.error('[CampaignMap] Failed to restore regions from sessionStorage:', e);
      try { sessionStorage.removeItem('m2tw_regions_data_json'); sessionStorage.removeItem('m2tw_regions_raw'); } catch {}
    }
    return null;
  });
  const [settlementNames, setSettlementNamesRaw] = useState(() => {
    try {
      const raw = sessionStorage.getItem('m2tw_names_raw');
      if (raw) return parseSettlementNames(raw);
    } catch {}
    return null;
  });
  const [factionColors, setFactionColorsRaw] = useState(() => {
    try {
      const raw = sessionStorage.getItem('m2tw_factions_raw');
      if (raw) return parseDescrSmFactions(raw);
    } catch {}
    return null;
  });
  const [overlayItems, setOverlayItems] = useState(() => {
    try {
      // First try the persisted overlay (includes any new items added in this session)
      const savedOverlay = sessionStorage.getItem('m2tw_overlay_items_json');
      if (savedOverlay) return JSON.parse(savedOverlay);
      // Fall back to parsing strat raw
      const raw = sessionStorage.getItem('m2tw_strat_raw');
      if (raw && raw.length < 20_000_000) { const p = parseDescrStrat(raw); return p.items || []; }
    } catch (e) {
      console.error('[CampaignMap] Failed to restore overlayItems:', e);
      try { sessionStorage.removeItem('m2tw_overlay_items_json'); } catch {}
    }
    return [];
  });
  const [selectedItem, setSelectedItem] = useState(null);
  const [visibleCategories, setVisibleCategories] = useState(new Set(['settlement', 'resource', 'character', 'fortification']));
  const [editedSettlements, setEditedSettlements] = useState({});
  const [pendingPlace, setPendingPlace] = useState(null); // item waiting to be placed on click
  const [regionWizard, setRegionWizard] = useState(null); // { draft, step: 'paint'|'city'|'port' }
  const [pendingRelocate, setPendingRelocate] = useState(null); // { type: 'city'|'port', regionInfo, settlement }
  const [stratPanelOpenItemId, setStratPanelOpenItemId] = useState(null); // double-click to open char
  const [pendingCoordPick, setPendingCoordPick] = useState(null); // callback(x, y) waiting for map click

  // ── Extra data sources for region editor ──────────────────────────────────
  const [rebelFactions, setRebelFactions] = useState(() => { try { const r = sessionStorage.getItem('m2tw_rebel_factions_raw'); return r ? parseDescrRebelFactions(r) : []; } catch { return []; } });
  const [religions, setReligions] = useState(() => { try { const r = sessionStorage.getItem('m2tw_religions_raw'); return r ? parseDescrReligions(r) : []; } catch { return []; } });
  const [naturalResources, setNaturalRes] = useState(() => { try { const r = sessionStorage.getItem('m2tw_sm_resources_raw'); return r ? parseDescrSmResources(r) : []; } catch { return []; } });
  const [mercenaryPools, setMercenaryPools] = useState(() => { try { const r = sessionStorage.getItem('m2tw_mercenaries_raw'); return r ? parseDescrMercenaries(r) : []; } catch { return []; } });
  const [musicTypes, setMusicTypes] = useState(() => { try { const r = sessionStorage.getItem('m2tw_music_types_raw'); return r ? parseDescrSoundsMusicTypes(r) : []; } catch { return []; } });
  const [cultures, setCultures] = useState(() => { try { const r = sessionStorage.getItem('m2tw_cultures_raw'); return r ? parseDescrCultures(r) : []; } catch { return []; } });

  // ── Character creation data sources ──────────────────────────────────────
  const [descrNames, setDescrNames] = useState(() => { try { const r = sessionStorage.getItem('m2tw_descr_names_raw'); return r ? parseDescrNames(r) : null; } catch { return null; } });
  const [traitsList, setTraitsList] = useState(() => { try { const r = sessionStorage.getItem('m2tw_traits_raw'); return r ? parseExportDescrTraits(r) : []; } catch { return []; } });
  const [ancillariesList, setAncillariesList] = useState(() => { try { const r = sessionStorage.getItem('m2tw_ancillaries_raw'); return r ? parseExportDescrAncillaries(r) : []; } catch { return []; } });
  const [eduUnits, setEduUnits] = useState(() => { try { const r = sessionStorage.getItem('m2tw_edu_raw'); return r ? parseEDU(r) : []; } catch { return []; } });
  // namesDisplayMap: decoded from names.txt.strings.bin (separate from region settlement names)
  const [namesDisplayMap, setNamesDisplayMap] = useState(() => { try { const r = sessionStorage.getItem('m2tw_char_names_display'); return r ? JSON.parse(r) : {}; } catch { return {}; } });

  // ── Selected region (click on map) ────────────────────────────────────────
  const [selectedRegion, setSelectedRegion] = useState(null);

  // Sync TGA pixel data to module-level store so it survives navigation
  useEffect(() => {
    for (const [id, layer] of Object.entries(layers)) {
      if (layer?.data) setLayer(id, { data: layer.data, width: layer.width, height: layer.height, bitmap: layer.bitmap });
    }
  }, [layers]);

  // Persist overlayItems to sessionStorage whenever they change so navigation
  // away and back doesn't lose newly added items (settlements, characters, etc.)
  useEffect(() => {
    try { sessionStorage.setItem('m2tw_overlay_items_json', JSON.stringify(overlayItems)); } catch {}
  }, [overlayItems]);

  // Persist regionsData to sessionStorage whenever it changes
  useEffect(() => {
    if (regionsData?.length) {
      try { sessionStorage.setItem('m2tw_regions_data_json', JSON.stringify(regionsData)); } catch {}
    }
  }, [regionsData]);

  const { edbData } = useEDB();
  const hiddenResourceList = useMemo(() => extractHiddenResourcesFromEDB(edbData || {}), [edbData]);
  const buildingLevelList  = useMemo(() => extractBuildingLevelsFromEDB(edbData || {}), [edbData]);
  const factionList        = useMemo(() => {
    const fromFactions = (stratData?.factions || []).map(f => f.name).filter(Boolean);
    const fromPlayable = [...(stratData?.playable || []), ...(stratData?.unlockable || []), ...(stratData?.nonplayable || [])];
    return [...new Set([...fromFactions, ...fromPlayable])];
  }, [stratData]);
  const rebelFactionList   = useMemo(() => rebelFactions.map(f => f.name || f).filter(Boolean), [rebelFactions]);
  const religionList       = useMemo(() => religions.map(r => r.name || r).filter(Boolean), [religions]);
  const naturalResList     = useMemo(() => naturalResources.map(r => r.name || r).filter(Boolean), [naturalResources]);
  const mercenaryPoolList  = useMemo(() => mercenaryPools.map(p => p.name || p).filter(Boolean), [mercenaryPools]);
  const musicTypeList      = useMemo(() => musicTypes.map(t => t.name || t).filter(Boolean), [musicTypes]);
  const cultureList        = useMemo(() => cultures.map(c => c.name || c).filter(Boolean), [cultures]);

  // Compute settlement positions once we have both strat + regions layer
  const applySettlementPositions = React.useCallback((stratParsed, regData, regLayer) => {
    if (!stratParsed?.items?.length) return stratParsed;
    const settlements = stratParsed.items.filter(i => i.category === 'settlement');
    const withPos = computeSettlementPositions(settlements, regData, regLayer);
    const posMap = Object.fromEntries(withPos.map(s => [s.id, s]));
    const items = stratParsed.items.map(i => posMap[i.id] || i);
    return { ...stratParsed, items };
  }, []);

  // Wrappers that also persist to sessionStorage
  const setStratData = (data) => {
    setStratDataRaw(data);
    try { if (data?.raw) sessionStorage.setItem('m2tw_strat_raw', data.raw); } catch {}
  };
  const setRegionsData = (data) => {
    setRegionsDataRaw(data);
  };
  const setSettlementNames = (data) => {
    setSettlementNamesRaw(data);
  };
  const setFactionColors = (data) => {
    setFactionColorsRaw(data);
  };

  const [importProgress, setImportProgress] = React.useState(null); // null | { step, total }

  const jumpRef = useRef(null);
  const folderInputRef = useRef();

  // ── Save/Revert snapshot ───────────────────────────────────────────────────
  // savedSnapshot holds deep copies of layers pixel data + overlayItems at last save
  const savedSnapshot = useRef(null);

  // Auto-load files pre-staged from Home page (keep them in window for re-navigation)
  React.useEffect(() => {
    const cached = window._m2tw_map_files;
    if (cached && cached.length > 0) {
      handleFolderImport({ files: cached, target: { value: '' } });
    }

    // Auto-restore names display map from sessionStorage only (no localStorage cross-session)
    try {
      if (!sessionStorage.getItem('m2tw_char_names_display')) {
        const store = getStringsBinStore();
        for (const [fname, binData] of Object.entries(store)) {
          if (fname.toLowerCase().includes('names') && !fname.toLowerCase().includes('settlement') && !fname.toLowerCase().includes('region')) {
            const namesMap = {};
            for (const { key, value } of binData.entries) if (key) namesMap[key] = value;
            setNamesDisplayMap(namesMap);
            try { sessionStorage.setItem('m2tw_char_names_display', JSON.stringify(namesMap)); } catch {}
            break;
          }
        }
      }
    } catch {}
    // Auto-restore settlement names from strings bin store if not already loaded
    try {
      if (!sessionStorage.getItem('m2tw_names_raw')) {
        const store = getStringsBinStore();
        for (const [fname, binData] of Object.entries(store)) {
          if (fname.toLowerCase().includes('regions_and_settlement_names')) {
            const namesMap = {};
            for (const { key, value } of binData.entries) if (key) namesMap[key] = value;
            setSettlementNamesRaw(prev => ({ ...(prev || {}), ...namesMap }));
            break;
          }
        }
      }
    } catch {}

    const handler = (e) => {
      if (e.detail?.files) handleFolderImport({ files: e.detail.files, target: { value: '' } });
    };
    window.addEventListener('m2tw-map-folder-loaded', handler);
    return () => window.removeEventListener('m2tw-map-folder-loaded', handler);
  }, []); // eslint-disable-line

  // ── Layer loading ──────────────────────────────────────────────────────────
  const loadLayerFile = useCallback(async (layerId, file, options) => {
    // Handle visibility toggle
    if (options?.toggleVisible) {
      setLayers(prev => ({ ...prev, [layerId]: { ...prev[layerId], visible: !(prev[layerId]?.visible ?? true) } }));
      return;
    }
    // Handle opacity change
    if (options?.setOpacity !== undefined) {
      setLayers(prev => ({ ...prev, [layerId]: { ...prev[layerId], opacity: options.setOpacity } }));
      return;
    }
    // Normal file load
    if (!file) return;
    const buf = await file.arrayBuffer();
    const result = await loadTGA(buf);
    if (!result) return;
    setLayers(prev => {
      const next = { ...prev, [layerId]: { ...prev[layerId], ...result } };
      // Re-compute settlement positions when regions layer loads
      if (layerId === 'regions') {
        setStratDataRaw(prevStrat => {
          if (!prevStrat) return prevStrat;
          setRegionsDataRaw(prevReg => {
            const enriched = applySettlementPositions(prevStrat, prevReg, result);
            setStratDataRaw(enriched);
            setOverlayItems(enriched.items);
            return prevReg;
          });
          return prevStrat;
        });
      }
      return next;
    });
  }, [applySettlementPositions]);

  // ── Bulk folder import ─────────────────────────────────────────────────────
  const handleFolderImport = useCallback(async (e) => {
    const files = Array.from(e.files || e.target?.files || []);
    try { if (e.target) e.target.value = ''; } catch {}

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (TGA_MAP[name]) {
        const buf = await file.arrayBuffer();
        const result = await loadTGA(buf);
        if (result) {
          setLayers(prev => ({ ...prev, [TGA_MAP[name]]: { ...prev[TGA_MAP[name]], ...result } }));
          // Re-compute settlement positions when regions layer loads during bulk import
          if (TGA_MAP[name] === 'regions') {
            setStratDataRaw(prevStrat => {
              if (!prevStrat) return prevStrat;
              setRegionsDataRaw(prevReg => {
                const enriched = applySettlementPositions(prevStrat, prevReg, result);
                setStratDataRaw(enriched);
                setOverlayItems(enriched.items);
                return prevReg;
              });
              return prevStrat;
            });
          }
        }
      }
      if (name === 'descr_strat.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_strat_raw', text); } catch {}
        const parsed = parseDescrStrat(text);
        // Try to apply positions immediately if we already have regions data
        setRegionsDataRaw(prevReg => {
          setLayers(prevLayers => {
            const enriched = applySettlementPositions(parsed, prevReg, prevLayers['regions']);
            setStratDataRaw(enriched);
            setOverlayItems(enriched.items);
            return prevLayers;
          });
          return prevReg;
        });
      }
      if (name === 'descr_regions.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_regions_raw', text); } catch {}
        const regData = parseDescrRegions(text);
        setRegionsDataRaw(regData);
        // Re-enrich settlements if strat already loaded
        setStratDataRaw(prev => {
          if (!prev) return prev;
          setLayers(prevLayers => {
            const enriched = applySettlementPositions(prev, regData, prevLayers['regions']);
            setStratDataRaw(enriched);
            setOverlayItems(enriched.items);
            return prevLayers;
          });
          return prev;
        });
      }
      if (name === 'campaign_script.txt') {
        const text = await file.text();
        try { localStorage.setItem('m2tw_campaign_script', text); sessionStorage.setItem('m2tw_script_raw', text); } catch {}
      }
      if (name === 'descr_sm_factions.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_factions_raw', text); } catch {}
        setFactionColorsRaw(parseDescrSmFactions(text));
      }
      if (name.endsWith('_regions_and_settlement_names.txt')) {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_names_raw', text); } catch {}
        setSettlementNamesRaw(parseSettlementNames(text));
      }
      // Auto-parse .strings.bin files from data/text/ folder
      if (name.endsWith('.strings.bin') || name.endsWith('_names.bin')) {
        const buf = await file.arrayBuffer();
        const decoded = parseStringsBin(buf);
        if (decoded?.entries?.length) {
          const namesMap = {};
          for (const { key, value } of decoded.entries) if (key) namesMap[key] = value;
          // If it's a character names file, store separately for character display names
          if (name.toLowerCase().includes('names') && !name.toLowerCase().includes('settlement') && !name.toLowerCase().includes('region')) {
            setNamesDisplayMap(prev => ({ ...prev, ...namesMap }));
            try { sessionStorage.setItem('m2tw_char_names_display', JSON.stringify({ ...namesMap })); } catch {}
          } else {
            setSettlementNamesRaw(prev => ({ ...(prev || {}), ...namesMap }));
          }
        }
      }
      if (name === 'descr_cultures.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_cultures_raw', text); } catch {}
        setCultures(parseDescrCultures(text));
      }
      if (name === 'descr_rebel_factions.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_rebel_factions_raw', text); } catch {}
        setRebelFactions(parseDescrRebelFactions(text));
      }
      if (name === 'descr_religions.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_religions_raw', text); } catch {}
        setReligions(parseDescrReligions(text));
      }
      if (name === 'descr_sm_resources.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_sm_resources_raw', text); } catch {}
        setNaturalRes(parseDescrSmResources(text));
      }
      if (name === 'descr_mercenaries.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_mercenaries_raw', text); } catch {}
        setMercenaryPools(parseDescrMercenaries(text));
      }
      if (name === 'descr_sounds_music_types.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_music_types_raw', text); } catch {}
        setMusicTypes(parseDescrSoundsMusicTypes(text));
      }
      if (name === 'descr_names.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_descr_names_raw', text); } catch {}
        setDescrNames(parseDescrNames(text));
      }
      if (name === 'export_descr_character_traits.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_traits_raw', text); } catch {}
        setTraitsList(parseExportDescrTraits(text));
      }
      if (name === 'export_descr_ancillaries.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_ancillaries_raw', text); } catch {}
        setAncillariesList(parseExportDescrAncillaries(text));
      }
      if (name === 'export_descr_unit.txt') {
        const text = await file.text();
        try { sessionStorage.setItem('m2tw_edu_raw', text); } catch {}
        setEduUnits(parseEDU(text));
      }
      // Store additional campaign text files for ZIP export
      const extraSessionMap = {
        'descr_events.txt': 'm2tw_events_raw',
        'descr_mercenaries.txt': 'm2tw_mercenaries_raw',
        'descr_sounds_music_types.txt': 'm2tw_music_types_raw',
        'descr_terrain.txt': 'm2tw_terrain_raw',
        'descr_win_conditions.txt': 'm2tw_win_conditions_raw',
      };
      if (extraSessionMap[name]) {
        const text = await file.text();
        try { sessionStorage.setItem(extraSessionMap[name], text); } catch {}
        // Also mirror win conditions to localStorage so StratPanel can read it on fresh navigation
        if (name === 'descr_win_conditions.txt') {
          try { localStorage.setItem('m2tw_campaign_win_conditions', text); } catch {}
        }
      }
      // Parse descr_faction_movies.xml
      if (name === 'descr_faction_movies.xml') {
        const text = await file.text();
        try {
          sessionStorage.setItem('m2tw_faction_movies_raw', text);
          window.dispatchEvent(new Event('m2tw-faction-movies-loaded'));
        } catch {}
      }
    }

    // ── Trigger DB import in background ──────────────────────────────────────
    const stratText = sessionStorage.getItem('m2tw_strat_raw');
    const regionsText = sessionStorage.getItem('m2tw_regions_raw');
    const factionsText = sessionStorage.getItem('m2tw_factions_raw');
    if (stratText || regionsText || factionsText) {
      setImportProgress({ step: 0, total: 5 });
      importCampaignToDatabase({
        stratText,
        regionsText,
        factionsText,
        campaignName: 'imperial_campaign',
        onProgress: (step, total) => setImportProgress({ step, total }),
      }).then(() => {
        setTimeout(() => setImportProgress(null), 2000);
      }).catch(err => {
        console.warn('DB import failed (non-critical):', err);
        setImportProgress(null);
      });
    }
  }, []);

  // ── Painting ───────────────────────────────────────────────────────────────
  const handlePaint = useCallback((type, layerId, color, patches, bucketCoord) => {
    setLayers(prev => {
      const layer = prev[layerId];
      if (!layer?.data) return prev;
      const newData = new Uint8ClampedArray(layer.data);
      if (type === 'pencil') {
        for (const { x, y } of patches) {
          const i = (y * layer.width + x) * 4;
          newData[i] = color.r; newData[i+1] = color.g; newData[i+2] = color.b;
        }
      } else if (type === 'bucket') {
        floodFillRGB(newData, layer.width, layer.height, bucketCoord.x, bucketCoord.y, color.r, color.g, color.b);
      } else if (type === 'pipette') {
        setPaintState(ps => ({ ...ps, paintColor: color }));
        return prev;
      }
      // Rebuild bitmap
      createImageBitmap(new ImageData(newData, layer.width, layer.height)).then(bitmap => {
        setLayers(p => ({ ...p, [layerId]: { ...p[layerId], bitmap, data: newData } }));
      });
      return { ...prev, [layerId]: { ...layer, data: newData } };
    });
    if (type !== 'pipette') {
      setDirtyLayers(prev => new Set([...prev, layerId]));
    }
  }, []);

  // Derive map dimensions from loaded layers
  const mapH = (() => {
    const reg = layers['regions'];
    if (reg?.bitmap) return reg.bitmap.height;
    for (const def of LAYER_DEFS) { const s = layers[def.id]; if (s?.bitmap) return s.bitmap.height; }
    return 0;
  })();
  const mapW2 = (() => {
    const reg = layers['regions'];
    if (reg?.bitmap) return reg.bitmap.width;
    for (const def of LAYER_DEFS) { const s = layers[def.id]; if (s?.bitmap) return s.bitmap.width; }
    return 0;
  })();

  // ── Helper: place a single pixel on the regions layer ────────────────────
  const placePixelOnRegions = useCallback((rx, ry, r, g, b) => {
    setLayers(prev => {
      const regLayer = prev['regions'];
      if (!regLayer?.data) return prev;
      const newData = new Uint8ClampedArray(regLayer.data);
      const idx = (ry * regLayer.width + rx) * 4;
      newData[idx] = r; newData[idx + 1] = g; newData[idx + 2] = b;
      createImageBitmap(new ImageData(newData, regLayer.width, regLayer.height)).then(bitmap => {
        setLayers(p => ({ ...p, regions: { ...p['regions'], bitmap, data: newData } }));
      });
      return { ...prev, regions: { ...regLayer, data: newData } };
    });
    setDirtyLayers(prev => new Set([...prev, 'regions']));
  }, []);

  // ── Finalize new region (must be defined before handlers that reference it) ─
  const finalizeNewRegion = useCallback((draft, cityX, cityY, portX, portY) => {
    // Detect natural resources on the map for this region's color
    // overlayItems is captured in the closure at call time
    const regLayer = layers['regions'];
    const mapResources = [];
    if (regLayer?.data) {
      const { data, width, height } = regLayer;
      const { r: dr, g: dg, b: db } = draft;
      for (const oi of overlayItems) {
        if (oi.category !== 'resource' || oi.x == null || oi.y == null) continue;
        const px = Math.round(oi.x);
        const py = height - 1 - Math.round(oi.y);
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const idx = (py * width + px) * 4;
        if (data[idx] === dr && data[idx + 1] === dg && data[idx + 2] === db) {
          if (oi.type && !mapResources.includes(oi.type)) mapResources.push(oi.type);
        }
      }
    }

    // 1. Add to regionsData — merge manual resources + hidden resources + map-detected resources
    const allResources = [...new Set([
      ...(draft.resources || []),
      ...(draft.hiddenResources || []),
      ...mapResources,
    ])];
    const newRegion = {
      regionName: draft.regionName,
      settlementName: draft.settlementName,
      factionCreator: draft.factionCreator || draft.faction || '',
      rebelFaction: draft.rebelFaction || 'slave',
      r: draft.r, g: draft.g, b: draft.b,
      resources: allResources,
      val1: draft.val1 || 0,
      val2: draft.val2 || 0,
      religions: draft.religions || {},
      musicType: draft.musicType || '',
      mercenaryPool: draft.mercenaryPool || '',
    };
    setRegionsDataRaw(prev => {
      const updated = [...(prev || []), newRegion];
      return updated;
    });

    // 2. Add settlement overlay item with the placed city position
    const stratY = mapH > 0 ? mapH - 1 - cityY : cityY;
    const newItemId = -(Date.now());
    const newItem = {
      id: newItemId,
      category: 'settlement',
      region: draft.regionName,
      faction: draft.faction || 'slave',
      factionCreator: draft.factionCreator || draft.faction || 'slave',
      castle: draft.castle || false,
      level: draft.level || 'village',
      population: draft.population || 400,
      yearFounded: draft.yearFounded || 0,
      planSet: 'default_set',
      buildings: draft.buildings || [],
      x: cityX, y: stratY,
    };

    // Add the new settlement both to overlayItems AND into stratData so the serializer
    // can find it even if stratData was already enriched. Items with negative IDs are
    // treated as NEW by the serializer (not present in origIds from the original file).
    setOverlayItems(prev => [...prev, newItem]);
    setStratDataRaw(prev => {
      if (!prev) return prev;
      const updated = { ...prev, items: [...(prev.items || []), newItem] };
      return updated;
    });
    setOverlayDirty(true);

    // 3. Update settlement names
    if (draft.regionDisplayName || draft.settlementDisplayName) {
      const nameUpdates = {};
      if (draft.regionDisplayName) nameUpdates[draft.regionName] = draft.regionDisplayName;
      if (draft.settlementDisplayName) nameUpdates[draft.settlementName] = draft.settlementDisplayName;
      setSettlementNamesRaw(prev => ({ ...(prev || {}), ...nameUpdates }));
    }

    // 4. Store port coordinates in regionsData if placed
    if (portX != null && portY != null) {
      setRegionsDataRaw(prev => (prev || []).map(r =>
        r.regionName === draft.regionName ? { ...r, portX, portY: mapH > 0 ? mapH - 1 - portY : portY } : r
      ));
    }
  }, [mapH, layers, overlayItems]);

  // ── Region paint wizard step handlers ─────────────────────────────────────
  const handleWizardFinishPaint = useCallback(() => {
    if (!regionWizard) return;
    setPaintState(prev => ({ ...prev, active: false }));
    setRegionWizard(prev => ({ ...prev, step: 'city' }));
  }, [regionWizard]);

  const handleWizardSkipPort = useCallback(() => {
    if (!regionWizard) return;
    finalizeNewRegion(regionWizard.draft, regionWizard.cityX, regionWizard.cityY, null, null);
    setRegionWizard(null);
  }, [regionWizard, finalizeNewRegion]);

  // ── Canvas click — place strat item OR select region ──────────────────────
  const handleCanvasClick = useCallback((rx, ry) => {
    // Coordinate pick mode (from disasters/events position picker)
    if (pendingCoordPick) {
      const stratY = mapH > 0 ? mapH - 1 - ry : ry;
      pendingCoordPick(rx, stratY);
      setPendingCoordPick(null);
      return;
    }

    // Region wizard: place city or port pixel
    if (regionWizard) {
      if (regionWizard.step === 'city') {
        // Place black pixel (0,0,0) for settlement location
        placePixelOnRegions(rx, ry, 0, 0, 0);
        setRegionWizard(prev => ({ ...prev, step: 'port', cityX: rx, cityY: ry }));
        return;
      }
      if (regionWizard.step === 'port') {
        // Place white pixel (255,255,255) for port location
        placePixelOnRegions(rx, ry, 255, 255, 255);
        finalizeNewRegion(regionWizard.draft, regionWizard.cityX, regionWizard.cityY, rx, ry);
        setRegionWizard(null);
        return;
      }
      return; // During 'paint' step, clicks go to the paint handler in MapCanvas
    }

    // Handle pending relocate (city or port pixel)
    if (pendingRelocate) {
      const { type, regionInfo, settlement } = pendingRelocate;
      const regLayer = layers['regions'];
      if (regLayer?.data && regionInfo) {
        // Find and replace old pixel: scan for old city/port adjacent to this region
        const { r: rr, g: rg, b: rb } = regionInfo;
        const { data, width, height } = regLayer;
        const oldColor = type === 'city' ? 0 : 255; // black for city, white for port
        const threshold = type === 'city' ? 5 : 250;
        for (let py = 0; py < height; py++) {
          for (let px = 0; px < width; px++) {
            const idx = (py * width + px) * 4;
            const isTarget = type === 'city'
              ? (data[idx] < threshold && data[idx + 1] < threshold && data[idx + 2] < threshold)
              : (data[idx] > threshold && data[idx + 1] > threshold && data[idx + 2] > threshold);
            if (!isTarget) continue;
            // Check adjacency to region
            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const nx = px + dx, ny = py + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const ni = (ny * width + nx) * 4;
              if (data[ni] === rr && data[ni + 1] === rg && data[ni + 2] === rb) {
                // Replace old pixel with region color
                placePixelOnRegions(px, py, rr, rg, rb);
                break;
              }
            }
          }
        }
      }
      // Place new pixel
      const newR = type === 'city' ? 0 : 255;
      const newG = type === 'city' ? 0 : 255;
      const newB = type === 'city' ? 0 : 255;
      placePixelOnRegions(rx, ry, newR, newG, newB);
      // Update settlement overlay position if it's a city relocation
      if (type === 'city' && settlement) {
        const stratY = mapH > 0 ? mapH - 1 - ry : ry;
        setOverlayItems(prev => prev.map(i => i.id === settlement.id ? { ...i, x: rx, y: stratY } : i));
        setStratDataRaw(prev => prev ? { ...prev, items: (prev.items || []).map(i => i.id === settlement.id ? { ...i, x: rx, y: stratY } : i) } : prev);
        setOverlayDirty(true);
      }
      setPendingRelocate(null);
      return;
    }

    if (pendingPlace) {
      const stratY = mapH > 0 ? mapH - 1 - ry : ry;
      // If the pending item already exists in stratData (has a real id), just update its position
      const existingItem = stratData?.items?.find(i => i.id === pendingPlace.id);
      if (existingItem) {
        const updated = { ...existingItem, x: rx, y: stratY };
        setOverlayItems(prev => prev.map(i => i.id === pendingPlace.id ? updated : i));
        setStratDataRaw(prev => prev ? { ...prev, items: (prev.items || []).map(i => i.id === pendingPlace.id ? updated : i) } : prev);
        setPendingPlace(null);
        setSelectedItem(updated);
      } else {
        const newItem = { ...pendingPlace, id: pendingPlace.id || Date.now(), x: rx, y: stratY };
        setOverlayItems(prev => [...prev, newItem]);
        setStratDataRaw(prev => prev ? { ...prev, items: [...(prev.items || []), newItem] } : prev);
        setPendingPlace(null);
        setSelectedItem(newItem);
      }
      setOverlayDirty(true);
      return;
    }
    // Region click: find which region the clicked pixel belongs to
    if (layers['regions']?.data) {
      const layer = layers['regions'];
      const idx = (ry * layer.width + rx) * 4;
      const r = layer.data[idx], g = layer.data[idx + 1], b = layer.data[idx + 2];
      // Try DB first, fall back to in-memory regionsData
      base44.entities.Region.filter({ color_r: r, color_g: g, color_b: b }).then(results => {
        if (results?.length) {
          // Normalize to same shape as regionsData for RegionEditorPanel
          const dbReg = results[0];
          const region = {
            regionName: dbReg.province_in,
            settlementName: dbReg.city_in,
            factionCreator: dbReg.original_faction,
            rebelFaction: dbReg.rebels,
            r: dbReg.color_r, g: dbReg.color_g, b: dbReg.color_b,
            resources: dbReg.resources || [],
            val1: dbReg.victory_points, val2: dbReg.agriculture,
            religions: {},
            _dbRecord: dbReg,
          };
          setSelectedRegion(region);
          setActiveTab('strat');
          // Auto-select matching settlement overlay item
          const matchSettlement = overlayItems.find(oi => oi.category === 'settlement' && oi.region === region.regionName);
          if (matchSettlement) setSelectedItem(matchSettlement);
        } else if (regionsData) {
          // Fallback to in-memory
          const region = regionsData.find(reg => reg.r === r && reg.g === g && reg.b === b);
          if (region) {
            setSelectedRegion(region); setActiveTab('strat');
            const matchSettlement = overlayItems.find(oi => oi.category === 'settlement' && oi.region === region.regionName);
            if (matchSettlement) setSelectedItem(matchSettlement);
          }
        }
      }).catch(() => {
        // Fallback to in-memory if DB unavailable
        if (regionsData) {
          const region = regionsData.find(reg => reg.r === r && reg.g === g && reg.b === b);
          if (region) { setSelectedRegion(region); setActiveTab('region'); }
        }
      });
    }
  }, [pendingCoordPick, pendingPlace, pendingRelocate, mapH, regionsData, layers, regionWizard, placePixelOnRegions, finalizeNewRegion, overlayItems]);

  // Handle relocate pixel request from SettlementRow
  const handleRelocatePixel = useCallback((settlement, type, regionInfo) => {
    setPendingRelocate({ type, regionInfo, settlement });
  }, []);

  const handleAddItem = (itemTemplate) => {
    setPendingPlace(itemTemplate);
    setSelectedItem(null);
  };

  // Reorder settlements within a faction — updates overlayItems order which drives serializer
  const handleReorderSettlements = useCallback((factionName, orderedIds) => {
    setOverlayItems(prev => {
      const nonFactionItems = prev.filter(i => !(i.category === 'settlement' && i.faction === factionName));
      // Find insertion index: position of first settlement of this faction in current list
      const firstIdx = prev.findIndex(i => i.category === 'settlement' && i.faction === factionName);
      const reordered = orderedIds.map(id => prev.find(i => i.id === id)).filter(Boolean);
      const result = [...nonFactionItems];
      result.splice(firstIdx < 0 ? result.length : Math.min(firstIdx, result.length), 0, ...reordered);
      return result;
    });
    setOverlayDirty(true);
  }, []);

  const handlePinCharacter = (char) => {
    // Set the character as pending place so the user can click the map to place it
    setPendingPlace({ ...char });
    setSelectedItem(null);
  };

  const handleDeleteItem = (id) => {
    setOverlayItems(prev => prev.filter(i => i.id !== id));
    setStratData(prev => prev ? { ...prev, items: (prev.items || []).filter(i => i.id !== id) } : prev);
    setSelectedItem(null);
    setOverlayDirty(true);
  };

  // ── Move item (drag or click-to-reposition) ────────────────────────────────
  const handleMoveItem = useCallback((id, mx, my, commit = false) => {
    const clampedX = Math.max(0, mx);
    const clampedY = Math.max(0, my);
    setOverlayItems(prev => prev.map(i => i.id === id ? { ...i, x: clampedX, y: clampedY } : i));
    setSelectedItem(prev => prev?.id === id ? { ...prev, x: clampedX, y: clampedY } : prev);
    if (commit) {
      setStratDataRaw(prev => prev ? { ...prev, items: (prev.items || []).map(i => i.id === id ? { ...i, x: clampedX, y: clampedY } : i) } : prev);
      setOverlayDirty(true);
    }
  }, []);

  // ── Recolor region TGA pixels (old color → new color) ──────────────────────
  const handleRecolorRegion = useCallback((oldColor, newColor) => {
    setLayers(prev => {
      const regLayer = prev['regions'];
      if (!regLayer?.data) return prev;
      const newData = new Uint8ClampedArray(regLayer.data);
      const { oldR, oldG, oldB } = oldColor;
      const { newR, newG, newB } = newColor;
      let count = 0;
      for (let i = 0; i < newData.length; i += 4) {
        if (newData[i] === oldR && newData[i + 1] === oldG && newData[i + 2] === oldB) {
          newData[i] = newR;
          newData[i + 1] = newG;
          newData[i + 2] = newB;
          count++;
        }
      }
      if (count === 0) return prev;
      // Rebuild bitmap
      createImageBitmap(new ImageData(newData, regLayer.width, regLayer.height)).then(bitmap => {
        setLayers(p => ({ ...p, regions: { ...p['regions'], bitmap, data: newData } }));
      });
      return { ...prev, regions: { ...regLayer, data: newData } };
    });
    setDirtyLayers(prev => new Set([...prev, 'regions']));
  }, []);

  // ── Add brand-new region — start paint wizard ───────────────────────────
  const handleAddNewRegion = useCallback((draft) => {
    // Start the region paint wizard
    setRegionWizard({ draft, step: 'paint' });
    // Auto-activate paint mode on regions layer with the new color
    setPaintState({
      active: true,
      layerId: 'regions',
      paintColor: { r: draft.r, g: draft.g, b: draft.b },
      tool: 'pencil',
      brushSize: 3,
    });
    // Ensure regions layer is visible
    setLayers(prev => ({ ...prev, regions: { ...prev.regions, visible: true } }));
  }, []);

  const handleToggleCategory = (catId) => {
    setVisibleCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  // ── Save / Revert / Export TGA ─────────────────────────────────────────────
  const handleSave = useCallback(() => {
    // Snapshot current layer pixel data + overlay items
    const layerSnap = {};
    for (const [id, layer] of Object.entries(layers)) {
      if (layer?.data) {
        layerSnap[id] = {
          data: new Uint8ClampedArray(layer.data),
          width: layer.width,
          height: layer.height,
        };
      }
    }
    savedSnapshot.current = {
      layers: layerSnap,
      overlayItems: JSON.parse(JSON.stringify(overlayItems)),
      stratRaw: stratData?.raw ?? null,
    };
    setDirtyLayers(new Set());
    setOverlayDirty(false);
  }, [layers, overlayItems, stratData]);

  const handleRevert = useCallback(() => {
    const snap = savedSnapshot.current;
    if (!snap) return;
    // Restore layer pixel data + bitmaps
    const promises = Object.entries(snap.layers).map(([id, { data, width, height }]) =>
      createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height)).then(bitmap => ({ id, data, width, height, bitmap }))
    );
    Promise.all(promises).then(results => {
      setLayers(prev => {
        const next = { ...prev };
        for (const { id, data, width, height, bitmap } of results) {
          next[id] = { ...prev[id], data: new Uint8ClampedArray(data), width, height, bitmap };
        }
        return next;
      });
    });
    // Restore overlay items
    const restoredItems = JSON.parse(JSON.stringify(snap.overlayItems));
    setOverlayItems(restoredItems);
    if (snap.stratRaw) {
      try { sessionStorage.setItem('m2tw_strat_raw', snap.stratRaw); } catch {}
      setStratDataRaw(prev => prev ? { ...prev, items: restoredItems, raw: snap.stratRaw } : prev);
    }
    setSelectedItem(null);
    setDirtyLayers(new Set());
    setOverlayDirty(false);
  }, []);
  const handleExportTGA = () => {
    dirtyLayers.forEach(layerId => {
      const layer = layers[layerId];
      if (!layer?.data) return;
      const def = LAYER_DEFS.find(d => d.id === layerId);
      const blob = exportTGA(layer.data, layer.width, layer.height);
      downloadBlob(blob, def?.filename || `${layerId}.tga`);
    });
    // Also export descr_strat.txt if it has changes
    if (stratData?.raw && overlayDirty) {
      const text = serializeDescrStrat(stratData, overlayItems, editedSettlements);
      downloadBlob(new Blob([text], { type: 'text/plain' }), 'descr_strat.txt');
    }
  };

  const tabs = [
    { id: 'strat',      label: 'Strat',    Icon: Globe },
    { id: 'validation', label: 'Validate', Icon: CheckSquare },
    { id: '3d',         label: '3D',       Icon: Box },
  ];

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      {/* Toolbar */}
      <div className="h-9 border-b border-slate-800 flex items-center px-3 gap-2 shrink-0 bg-slate-900/80">
        <Map className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold">Campaign Map Editor</span>
        <span className="text-[10px] text-slate-500 font-mono hidden lg:block">— Rome / M2TW map_*.tga + descr_strat.txt</span>

        {/* Bulk folder import */}
        <label className="ml-auto cursor-pointer flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <FolderOpen className="w-3 h-3" />
          Import folder
          <input ref={folderInputRef} type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={handleFolderImport} />
        </label>

        {/* Pixel grid toggle */}
        <button
          onClick={() => setShowPixelGrid(v => !v)}
          className={`px-2 py-1 rounded text-[10px] border transition-colors ${showPixelGrid ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-slate-600/40 text-slate-500 hover:text-slate-200'}`}
        >Grid</button>

        {/* Regions mode */}
        <select
          value={regionsMode}
          onChange={e => setRegionsMode(e.target.value)}
          className="h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-300"
        >
          <option value="fill">Regions: fill</option>
          <option value="citiesports">Regions: cities+ports</option>
        </select>

        {/* DB import progress */}
        {importProgress && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/20 border border-blue-500/40 text-blue-400 text-[10px] font-semibold">
            Saving to DB… {importProgress.step}/{importProgress.total}
          </span>
        )}

        {/* Coordinate pick indicator */}
        {pendingCoordPick && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[10px] font-semibold animate-pulse">
            📍 Click map to pick coordinate
            <button onClick={() => setPendingCoordPick(null)} className="ml-1 text-cyan-600 hover:text-cyan-400">✕</button>
          </span>
        )}

        {/* Pending place indicator */}
        {pendingPlace && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-semibold animate-pulse">
            Click map to place {pendingPlace.type || pendingPlace.charType}
            <button onClick={() => setPendingPlace(null)} className="ml-1 text-amber-600 hover:text-amber-400">✕</button>
          </span>
        )}

        {/* Relocate pixel indicator */}
        {pendingRelocate && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[10px] font-semibold animate-pulse">
            {pendingRelocate.type === 'city' ? '⬛' : '⬜'} Click map to place new <b>{pendingRelocate.type}</b> pixel
            <button onClick={() => setPendingRelocate(null)} className="ml-1 text-cyan-600 hover:text-cyan-400">✕</button>
          </span>
        )}

        {/* Region wizard step indicator in toolbar */}
        {regionWizard?.step === 'city' && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900/80 border border-slate-500/40 text-slate-200 text-[10px] font-semibold animate-pulse">
            ⬛ Click map to place <b>settlement</b> (black pixel)
          </span>
        )}
        {regionWizard?.step === 'port' && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 border border-white/30 text-white text-[10px] font-semibold animate-pulse">
            ⬜ Click map to place <b>port</b> (white pixel) or
            <button onClick={handleWizardSkipPort} className="ml-1 underline text-slate-400 hover:text-white">skip</button>
          </span>
        )}
      </div>

      {/* Region paint wizard panel */}
      {regionWizard && (
        <div className="px-3 py-1.5 bg-slate-900/90 border-b border-amber-500/30">
          <NewRegionPaintWizard
            regionDraft={regionWizard.draft}
            currentStep={regionWizard.step}
            onFinish={handleWizardFinishPaint}
            onSkipPort={handleWizardSkipPort}
          />
        </div>
      )}

      {/* Paint toolbar */}
      <MapPaintToolbar
        paintState={paintState}
        onPaintChange={setPaintState}
        onSave={handleSave}
        onRevert={handleRevert}
        onExport={handleExportTGA}
        hasUnsaved={dirtyLayers.size > 0 || overlayDirty}
        hasSavedSnapshot={savedSnapshot.current !== null}
        dirtyLayers={dirtyLayers}
      />

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative min-w-0">
          <MapCanvas
            layers={layers}
            regionsMode={regionsMode}
            onRegionClick={handleCanvasClick}
            jumpRef={jumpRef}
            paintState={paintState}
            onPaint={handlePaint}
            showPixelGrid={showPixelGrid}
            showTooltip={!paintState.active || !!regionWizard}
            onTransformChange={setTransform}
            regionsData={regionsData}
            settlementNames={settlementNames}
            highlightRegion={selectedRegion}
          />
          {/* Strat SVG overlay */}
          <StratOverlay
            items={overlayItems}
            transform={transform}
            mapH={mapH}
            visibleCategories={visibleCategories}
            selectedId={selectedItem?.id}
            onSelect={setSelectedItem}
            onMoveItem={handleMoveItem}
            onDoubleClick={(item) => {
              setSelectedItem(item);
              setActiveTab('strat');
              setStratPanelOpenItemId(item.category === 'character' ? item.id : null);
            }}
          />
        </div>

        {/* Right panel */}
        <div className="w-80 xl:w-[22rem] border-l border-slate-800 flex flex-col shrink-0">
          {/* Tab bar */}
          <div className="flex border-b border-slate-800 shrink-0">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-semibold border-b-2 transition-colors ${
                  activeTab === id ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3 h-3" />{label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'strat' && (
              <div className="h-full overflow-hidden">
                <StratPanel
                  stratData={stratData}
                  regionsData={regionsData}
                  settlementNames={settlementNames}
                  factionColors={factionColors}
                  cultureList={cultureList}
                 edbData={edbData}
                 onStratDataChange={(updatedStratData) => {
                   // Preserve raw so the CharactersTab guard (!stratData?.raw) keeps working
                   const withRaw = updatedStratData.raw ? updatedStratData : { ...updatedStratData, raw: stratData?.raw };
                   setStratDataRaw(withRaw);
                   setOverlayItems(withRaw.items || overlayItems);
                   setOverlayDirty(true);
                 }}
                 onStratLoad={(text) => {
                    try { sessionStorage.setItem('m2tw_strat_raw', text); } catch {}
                    const p = parseDescrStrat(text);
                    const enriched = applySettlementPositions(p, regionsData, layers['regions']);
                    setStratDataRaw(enriched);
                    setOverlayItems(enriched.items);
                  }}
                  onRegionsLoad={(text) => {
                    try { sessionStorage.setItem('m2tw_regions_raw', text); } catch {}
                    const regData = parseDescrRegions(text);
                    setRegionsDataRaw(regData);
                    if (stratData) {
                      const enriched = applySettlementPositions(stratData, regData, layers['regions']);
                      setStratDataRaw(enriched);
                      setOverlayItems(enriched.items);
                    }
                  }}
                  onNamesLoad={(text) => { try { sessionStorage.setItem('m2tw_names_raw', text); } catch {} setSettlementNamesRaw(parseSettlementNames(text)); }}
                  onFactionsLoad={(text) => { try { sessionStorage.setItem('m2tw_factions_raw', text); } catch {} setFactionColorsRaw(parseDescrSmFactions(text)); }}
                  onRegionsDataUpdate={setRegionsDataRaw}
                  onSettlementChange={(id, edits) => {
                    setEditedSettlements(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...edits } }));
                    setOverlayItems(prev => prev.map(i => i.id === id ? { ...i, ...edits } : i));
                    setStratDataRaw(prev => prev ? { ...prev, items: (prev.items||[]).map(i => i.id === id ? { ...i, ...edits } : i) } : prev);
                    setOverlayDirty(true);
                  }}
                  overlayItems={overlayItems}
                  selectedItem={selectedItem}
                  onSaveItem={(item) => {
                    setOverlayItems(prev => prev.map(i => i.id === item.id ? item : i));
                    setStratDataRaw(prev => prev ? { ...prev, items: (prev.items || []).map(i => i.id === item.id ? item : i) } : prev);
                    setSelectedItem(item);
                    setOverlayDirty(true);
                  }}
                  onSelectItem={(item) => {
                    setSelectedItem(item);
                    if (jumpRef.current && item.x != null) jumpRef.current(item.x, mapH > 0 ? mapH - 1 - item.y : item.y);
                    // Highlight region on map when selecting a settlement
                    if (item.category === 'settlement' && item.region && regionsData) {
                      const reg = regionsData.find(r => r.regionName === item.region);
                      if (reg) {
                        setSelectedRegion(reg);
                        setActiveTab('strat');
                      }
                    }
                  }}
                  visibleCategories={visibleCategories}
                  onToggleCategory={handleToggleCategory}
                  onDeleteItem={handleDeleteItem}
                  onAddItem={handleAddItem}
                  regionsLayer={layers['regions']}
                  onSettlementNamesChange={(nameUpdates) => {
                    setSettlementNamesRaw(prev => ({ ...(prev || {}), ...nameUpdates }));
                  }}
                  onRecolorRegion={handleRecolorRegion}
                  onAddNewRegion={handleAddNewRegion}
                  layers={layers}
                  dirtyLayers={dirtyLayers}
                  editedSettlements={editedSettlements}
                  rebelFactionList={rebelFactionList}
                  hiddenResourceList={hiddenResourceList}
                  musicTypeList={musicTypeList}
                  mercenaryPoolList={mercenaryPoolList}
                  religionList={religionList}
                  naturalResList={naturalResList}
                  onRelocatePixel={handleRelocatePixel}
                    mapH={mapH}
                    onLoadTgaLayer={loadLayerFile}
                    descrNames={descrNames}
                    namesDisplayMap={namesDisplayMap}
                    traitsList={traitsList}
                    ancillariesList={ancillariesList}
                    eduUnits={eduUnits}
                    onPinCharacter={(char) => setPendingPlace({ ...char })}
                    onReorderSettlements={handleReorderSettlements}
                    openItemId={stratPanelOpenItemId}
                    onOpenItemHandled={() => setStratPanelOpenItemId(null)}
                    onPickFromMap={(cb) => setPendingCoordPick(() => cb)}
                    />
              </div>
            )}

            {activeTab === 'validation' && (
              <div className="h-full overflow-hidden">
                <MapValidationPanel layers={layers} onJumpTo={(x, y) => jumpRef.current?.(x, y)} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3D Preview — full-screen overlay when active */}
      {activeTab === '3d' && (
        <div className="absolute inset-0 z-10" style={{ top: '6.5rem' }}>
          <Map3DPreview layers={layers} />
          <button
            onClick={() => setActiveTab('layers')}
            className="absolute top-3 right-3 z-20 flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800/90 border border-slate-600/50 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors"
          >
            ✕ Close 3D
          </button>
        </div>
      )}
    </div>
  );
}
