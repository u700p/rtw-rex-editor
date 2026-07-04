import { toCRLF } from './lineEndings';

export const TEXT_LOC_META = Symbol.for('rtw-editor.textLocMeta');

/**
 * Parser for Total War text localization files.
 *
 * RTW ships plain data/text/*.txt files where a key may be followed by an
 * inline value or by one or more value lines:
 *   {unit_key}Display Name
 *   {unit_key_descr}
 *   Longer text...
 *
 * The editor keeps these files in Rome-style plain text for import/export.
 */

function stripBom(text) {
  let out = String(text || '');
  const nullCount = (out.match(/\u0000/g) || []).length;
  if (nullCount > Math.max(2, out.length / 10)) {
    out = out.replace(/\u0000/g, '');
  }
  return out
    .replace(/^\uFEFF/, '')
    .replace(/^\u00FF\u00FE/, '')
    .replace(/^\u00FE\u00FF/, '')
    .replace(/^\uFFFD+/, '')
    .replace(/^\u00BB\u00BF/, '');
}

function isNoteLine(line) {
  const t = line.trim();
  return t.startsWith(';') || t.startsWith('¬');
}

function isBlankLine(line) {
  return !String(line ?? '').trim();
}

function normalizeValueLine(line) {
  return String(line ?? '').replace(/[ \t]+$/, '');
}

export function parseTextLocFile(text) {
  const map = {};
  const tokens = [];
  const cleaned = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');

  let currentEntry = null;
  let valueLines = [];

  const flush = () => {
    if (!currentEntry) return;
    const value = valueLines.join('\n').replace(/^\n+|\n+$/g, '');
    map[currentEntry.key] = value;
    tokens.push({
      type: 'entry',
      key: currentEntry.key,
      inline: currentEntry.inline && !value.includes('\n'),
      multiline: valueLines.length > 1 || (!currentEntry.inline && value.length > 0),
      notes: currentEntry.notes || [],
    });
    currentEntry = null;
    valueLines = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (isBlankLine(raw)) {
      flush();
      tokens.push({ type: 'raw', raw });
      continue;
    }

    if (isNoteLine(raw)) {
      if (currentEntry && valueLines.length === 0) {
        currentEntry.notes = [...(currentEntry.notes || []), raw];
        continue;
      }
      flush();
      tokens.push({ type: 'raw', raw });
      continue;
    }

    const keyMatch = trimmed.match(/^\{([^}]+)\}(.*)$/);
    if (keyMatch) {
      flush();
      const inlineValue = keyMatch[2].replace(/^[\t ]+/, '').replace(/[ \t]+$/, '');
      currentEntry = { key: keyMatch[1].trim(), inline: !!inlineValue };
      valueLines = inlineValue ? [inlineValue] : [];
      continue;
    }

    if (!currentEntry) {
      tokens.push({ type: 'raw', raw });
      continue;
    }

    valueLines.push(normalizeValueLine(raw));
  }

  flush();
  Object.defineProperty(map, TEXT_LOC_META, {
    value: { tokens },
    enumerable: true,
    configurable: true,
  });
  return map;
}

function serializeEntryLine(key, value, token = {}) {
  const strValue = String(value ?? '');
  const valueLines = strValue.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (!strValue) return [`{${key}}`, ...(token.notes || [])];
  if (token.multiline || strValue.includes('\n') || !token.inline || token.notes?.length) {
    return [`{${key}}`, ...(token.notes || []), ...valueLines];
  }
  return [`{${key}}\t${strValue}`];
}

export function textLocMapToEntries(map) {
  return Object.entries(map || {})
    .filter(([key]) => key)
    .map(([key, value]) => ({ key, value: String(value ?? '') }));
}

export function textLocEntriesToMap(entries, rawText = '', { preserveMissing = false } = {}) {
  const map = rawText ? parseTextLocFile(rawText) : {};
  const keep = new Set();

  for (const entry of entries || []) {
    const key = String(entry?.key || '').trim().replace(/^\{/, '').replace(/\}$/, '');
    if (!key) continue;
    keep.add(key);
    map[key] = String(entry.value ?? '');
  }

  if (!preserveMissing) {
    for (const key of Object.keys(map)) {
      if (!keep.has(key)) delete map[key];
    }
  }

  return map;
}

export function serializeTextLocEntries(entries, { rawText = '', header, preserveMissing = false } = {}) {
  return serializeTextLocFile(textLocEntriesToMap(entries, rawText, { preserveMissing }), { header });
}

export function serializeTextLocFile(map, { header } = {}) {
  const lines = [];
  const meta = map?.[TEXT_LOC_META];
  const emitted = new Set();

  if (meta?.tokens?.length) {
    for (const token of meta.tokens) {
      if (token.type === 'raw') {
        lines.push(token.raw ?? '');
        continue;
      }
      if (token.type !== 'entry') continue;
      if (!Object.prototype.hasOwnProperty.call(map, token.key)) continue;
      lines.push(...serializeEntryLine(token.key, map[token.key], token));
      emitted.add(token.key);
    }
    for (const [key, value] of Object.entries(map || {})) {
      if (!key || emitted.has(key)) continue;
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(...serializeEntryLine(key, value, { inline: true }));
      emitted.add(key);
    }
    return toCRLF(lines.join('\n').replace(/\n+$/, '') + '\n');
  }

  if (header) lines.push('¬--------------', `¬ ${header}`, '¬--------------', '');
  for (const [key, value] of Object.entries(map || {})) {
    lines.push(...serializeEntryLine(key, value, { inline: true }), '');
  }
  return toCRLF(lines.join('\n').trimEnd() + '\n');
}
