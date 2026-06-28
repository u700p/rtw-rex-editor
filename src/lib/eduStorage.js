import { loadLargeText, saveLargeText } from './largeTextStore';

export const EDU_FILE_KEY = 'm2tw_units_file';
export const EDU_FILE_NAME_KEY = 'm2tw_edu_file_name';
export const EDU_SESSION_KEY = 'm2tw_edu_raw';
export const EDU_UNIT_LIST_KEY = 'm2tw_edu_units_list';

function getStorageItem(store, key) {
  try { return store?.getItem(key) || ''; } catch { return ''; }
}

function setStorageItem(store, key, value) {
  try { store?.setItem(key, value); return true; } catch { return false; }
}

export function extractEduUnitNames(text) {
  return [...new Set(String(text || '').split('\n')
    .map(line => line.replace(/;.*$/, '').trim().match(/^type\s+(.+)/i)?.[1]?.trim())
    .filter(Boolean))]
    .sort();
}

export function setEduRawText(text, filename = '') {
  const raw = String(text ?? '');
  const safeName = filename || getEduFilename();

  if (typeof window !== 'undefined') {
    window._m2tw_edu_raw = raw;
    if (safeName) window._m2tw_edu_file_name = safeName;
  }

  setStorageItem(typeof localStorage !== 'undefined' ? localStorage : null, EDU_FILE_KEY, raw);
  setStorageItem(typeof sessionStorage !== 'undefined' ? sessionStorage : null, EDU_SESSION_KEY, raw);
  if (safeName) {
    setStorageItem(typeof localStorage !== 'undefined' ? localStorage : null, EDU_FILE_NAME_KEY, safeName);
  }

  const unitNames = extractEduUnitNames(raw);
  if (unitNames.length) {
    setStorageItem(
      typeof localStorage !== 'undefined' ? localStorage : null,
      EDU_UNIT_LIST_KEY,
      JSON.stringify(unitNames)
    );
  }

  saveLargeText(EDU_FILE_KEY, raw, { filename: safeName }).catch(() => {});
  return unitNames;
}

export function getEduFilename() {
  if (typeof window !== 'undefined' && window._m2tw_edu_file_name) return window._m2tw_edu_file_name;
  return getStorageItem(typeof localStorage !== 'undefined' ? localStorage : null, EDU_FILE_NAME_KEY);
}

export function getEduRawText() {
  if (typeof window !== 'undefined' && typeof window._m2tw_edu_raw === 'string') {
    return window._m2tw_edu_raw;
  }

  const sessionRaw = getStorageItem(typeof sessionStorage !== 'undefined' ? sessionStorage : null, EDU_SESSION_KEY);
  if (sessionRaw) {
    if (typeof window !== 'undefined') window._m2tw_edu_raw = sessionRaw;
    return sessionRaw;
  }

  const localRaw = getStorageItem(typeof localStorage !== 'undefined' ? localStorage : null, EDU_FILE_KEY);
  if (localRaw) {
    if (typeof window !== 'undefined') window._m2tw_edu_raw = localRaw;
    return localRaw;
  }

  return '';
}

export async function loadEduRawText() {
  const syncText = getEduRawText();
  if (syncText) return { text: syncText, filename: getEduFilename() };

  try {
    const record = await loadLargeText(EDU_FILE_KEY);
    const text = record?.text || '';
    const filename = record?.metadata?.filename || getEduFilename();
    if (text && typeof window !== 'undefined') {
      window._m2tw_edu_raw = text;
      if (filename) window._m2tw_edu_file_name = filename;
    }
    return { text, filename };
  } catch {
    return { text: '', filename: '' };
  }
}

export function hasEduRawText() {
  return !!getEduRawText();
}
