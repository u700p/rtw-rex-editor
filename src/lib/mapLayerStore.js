/**
 * Module-level in-memory store for M2TW map layer pixel data.
 * Survives React component unmount/remount (navigation between pages).
 * Cleared automatically when the browser tab/window is closed.
 */

// Re-export constants from mapLayerConstants so imports from mapLayerStore keep working
export { LAYER_DEFS, LAYER_BY_ID } from '../components/map/mapLayerConstants';

// M2TW canonical palettes for the NewMapEditor paint tool
export const CLIMATE_PALETTE = [
  { id: 'mediterranean',             color: '#ec008c', label: 'Mediterranean' },
  { id: 'sandy_desert',              color: '#662d91', label: 'Sandy Desert' },
  { id: 'rocky_desert',              color: '#92278f', label: 'Rocky Desert' },
  { id: 'temperate_grassland',       color: '#ed145b', label: 'Temperate Grassland Fertile' },
  { id: 'steppe',                    color: '#ed1c24', label: 'Steppe' },
  { id: 'temperate_deciduous',       color: '#f26522', label: 'Temperate Deciduous Forest' },
  { id: 'temperate_coniferous',      color: '#f7941d', label: 'Temperate Coniferous Forest' },
  { id: 'swamp',                     color: '#fff200', label: 'Swamp' },
  { id: 'highland',                  color: '#8dc63f', label: 'Highland' },
  { id: 'alpine',                    color: '#39b54a', label: 'Alpine' },
  { id: 'tropical',                  color: '#00a651', label: 'Tropical' },
  { id: 'semi_arid',                 color: '#0072bc', label: 'Semi-Arid' },
];

export const GROUND_TYPE_PALETTE = [
  { id: 'fertile_low',       color: '#008080', label: 'Fertile Low' },
  { id: 'fertile_medium',    color: '#60a040', label: 'Fertile Medium' },
  { id: 'fertile_high',      color: '#657c00', label: 'Fertile High' },
  { id: 'wilderness',        color: '#000000', label: 'Wilderness' },
  { id: 'mountains_high',    color: '#c48080', label: 'Mountains High' },
  { id: 'mountains_low',     color: '#624141', label: 'Mountains Low' },
  { id: 'hills',             color: '#808040', label: 'Hills' },
  { id: 'forest_dense',      color: '#004000', label: 'Forest Dense (impassable)' },
  { id: 'forest_sparse',     color: '#008000', label: 'Forest Sparse' },
  { id: 'swamp',             color: '#00ff80', label: 'Swamp' },
  { id: 'beach',             color: '#ffffff', label: 'Beach' },
  { id: 'impassable_land',   color: '#404040', label: 'Impassable Land' },
  { id: 'impassable_sea',    color: '#000040', label: 'Impassable Sea' },
  { id: 'ocean',             color: '#400000', label: 'Ocean' },
  { id: 'sea_deep',          color: '#800000', label: 'Sea Deep' },
  { id: 'sea_shallow',       color: '#c40000', label: 'Sea Shallow' },
];

export const FEATURES_PALETTE = [
  { id: 'river',        color: '#0000ff', label: 'River' },
  { id: 'ford',         color: '#00ffff', label: 'Ford' },
  { id: 'river_origin', color: '#ffffff', label: 'River Origin' },
  { id: 'cliff',        color: '#ffff00', label: 'Cliff' },
  { id: 'land_bridge',  color: '#00ff00', label: 'Land-bridge' },
  { id: 'volcano',      color: '#ff0000', label: 'Volcano' },
];

/** Converts a CSS hex color string to an {r, g, b} object. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** Returns the pixel dimensions of a given layer relative to the base map size. */
export function getLayerDimensions(def, mapWidth, mapHeight) {
  // Ground/climates are 2× regions size + 1 in M2TW; everything else matches base size
  const scaled = def?.id === 'ground' || def?.id === 'climates';
  return {
    width:  scaled ? mapWidth  * 2 + 1 : mapWidth,
    height: scaled ? mapHeight * 2 + 1 : mapHeight,
  };
}


const _store = {
  layers: {},       // { [layerId]: { data: Uint8ClampedArray, width, height, bitmap } }
  texts: {},        // { [key]: string } — raw text file content
};

// Clear everything when the tab closes (not on page navigation)
window.addEventListener('beforeunload', () => {
  _store.layers = {};
  _store.texts = {};
  // Also clear sessionStorage campaign data
  const SESSION_KEYS = [
    'm2tw_strat_raw', 'm2tw_regions_raw', 'm2tw_regions_data_json',
    'm2tw_names_raw', 'm2tw_factions_raw', 'm2tw_overlay_items_json',
    'm2tw_rebel_factions_raw', 'm2tw_religions_raw', 'm2tw_sm_resources_raw',
    'm2tw_mercenaries_raw', 'm2tw_music_types_raw', 'm2tw_cultures_raw',
    'm2tw_descr_names_raw', 'm2tw_traits_raw', 'm2tw_ancillaries_raw',
    'm2tw_edu_raw', 'm2tw_char_names_display', 'm2tw_script_raw',
    'm2tw_events_raw', 'm2tw_terrain_raw', 'm2tw_win_conditions_raw',
    'm2tw_mercenaries_raw', 'm2tw_music_types_raw',
  ];
  SESSION_KEYS.forEach(k => { try { sessionStorage.removeItem(k); } catch {} });
});

export function setLayer(layerId, layerData) {
  _store.layers[layerId] = layerData;
}

export function getLayer(layerId) {
  return _store.layers[layerId] || null;
}

export function getAllLayers() {
  return _store.layers;
}

export function clearLayer(layerId) {
  delete _store.layers[layerId];
}

export function clearAllLayers() {
  _store.layers = {};
}

export function hasAnyLayer() {
  return Object.keys(_store.layers).some(k => _store.layers[k]?.data);
}
