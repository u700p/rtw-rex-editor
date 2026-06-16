/**
 * Parser for Total War text localization files.
 *
 * RTW ships plain data/text/*.txt files where a key may be followed by an
 * inline value or by one or more value lines:
 *   {unit_key}Display Name
 *   {unit_key_descr}
 *   Longer text...
 *
 * M2TW often compiles these files into .strings.bin, but the plain text shape
 * is still useful for Rome and for mod source files.
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

function isCommentLine(line) {
  const t = line.trim();
  return !t || t.startsWith(';') || t.startsWith('¬');
}

function normalizeValueLine(line) {
  return line.trim();
}

export function parseTextLocFile(text) {
  const map = {};
  const cleaned = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');

  let currentKey = null;
  let valueLines = [];

  const flush = () => {
    if (!currentKey) return;
    const value = valueLines.join('\n').trim();
    map[currentKey] = value;
    currentKey = null;
    valueLines = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    const keyMatch = trimmed.match(/^\{([^}]+)\}(.*)$/);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1].trim();
      const inlineValue = keyMatch[2].replace(/^[\t ]+/, '').trim();
      valueLines = inlineValue ? [inlineValue] : [];
      continue;
    }

    if (!currentKey || isCommentLine(raw)) {
      continue;
    }

    valueLines.push(normalizeValueLine(raw));
  }

  flush();
  return map;
}

export function textLocMapToEntries(map) {
  return Object.entries(map || {})
    .filter(([key]) => key)
    .map(([key, value]) => ({ key, value: String(value ?? '') }));
}

export function serializeTextLocFile(map, { header } = {}) {
  const lines = [];
  if (header) lines.push(`¬ ${header}`, '');
  for (const [key, value] of Object.entries(map || {})) {
    lines.push(`{${key}}${value ?? ''}`, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
