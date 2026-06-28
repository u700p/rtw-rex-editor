/**
 * Shared store for Total War localization files.
 * Uses an in-memory store as primary (survives localStorage quota failures).
 * Also persists to localStorage when possible.
 * Shape: { [filename]: { entries: [{key, value}], sourceFormat: 'txt', rawText?: string } }
 */

import { loadLargeText, saveLargeText } from './largeTextStore';

const STORE_KEY = 'm2tw_text_localization_files';
// In-memory store — always available regardless of localStorage limits
let _memoryStore = null;

export function normalizeTextLocalizationName(name) {
  const raw = String(name || 'localization.txt').trim() || 'localization.txt';
  let clean = raw;
  if (clean.toLowerCase() === 'expanded.txt') clean = 'expanded_bi.txt';
  if (!/\.txt$/i.test(clean)) clean = `${clean}.txt`;
  return clean;
}

function normalizeStore(store) {
  const normalized = {};
  for (const [name, data] of Object.entries(store || {})) {
    normalized[normalizeTextLocalizationName(name)] = {
      ...data,
      entries: Array.isArray(data?.entries) ? data.entries : [],
      sourceFormat: 'txt',
    };
  }
  return normalized;
}

function getMemoryStore() {
  if (_memoryStore === null) {
    // Try to hydrate from localStorage on first access
    try {
      const raw = localStorage.getItem(STORE_KEY);
      _memoryStore = raw ? normalizeStore(JSON.parse(raw)) : {};
    } catch {
      _memoryStore = {};
    }
  }
  return _memoryStore;
}

export function getTextLocalizationStore() {
  return getMemoryStore();
}

export function setTextLocalizationStore(store) {
  _memoryStore = normalizeStore(store);
  saveLargeText(STORE_KEY, JSON.stringify(_memoryStore)).catch(() => {});
  // Best-effort persist to localStorage
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(_memoryStore));
  } catch (e) {
    console.warn('[TextLocalizationStore] localStorage write failed (quota), using in-memory only:', e.message);
  }
}

export async function hydrateTextLocalizationStore() {
  const current = getMemoryStore();
  if (Object.keys(current).length > 0) return current;

  try {
    const record = await loadLargeText(STORE_KEY);
    if (!record?.text) return current;
    _memoryStore = normalizeStore(JSON.parse(record.text));
    window.dispatchEvent(new CustomEvent('text-localization-updated', { detail: { hydrated: true } }));
    return _memoryStore;
  } catch {
    return current;
  }
}

export function updateTextLocalizationFile(name, fileData) {
  const store = getMemoryStore();
  store[normalizeTextLocalizationName(name)] = { ...fileData, sourceFormat: 'txt' };
  setTextLocalizationStore(store);
  window.dispatchEvent(new CustomEvent('text-localization-updated', { detail: { name } }));
}

export function clearTextLocalizationStore() {
  _memoryStore = {};
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {}
}
