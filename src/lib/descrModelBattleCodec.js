/**
 * Parser/serializer for Rome: Total War descr_model_battle.txt.
 *
 * The unit editor already understands the M2TW battle_models.modeldb shape, so
 * this parser projects RTW model blocks into the same broad structure:
 * { entries, byName, factions, meshes, mountTypes, scale }.
 */

const MODEL_KEYS = new Set(['model_flexi', 'model_flexi_m', 'model_flexi_c', 'model_mesh']);
const MAX_DIST = 10000;

function cleanLine(raw) {
  return String(raw || '').replace(/;.*$/, '').trim();
}

function splitCommaParts(rest) {
  return rest.split(',').map(s => s.trim()).filter(Boolean);
}

function parseDist(value) {
  if (!value || /^max$/i.test(value)) return MAX_DIST;
  const n = parseFloat(value.replace(/f$/i, ''));
  return Number.isFinite(n) ? n : MAX_DIST;
}

function parseSkeletons(rest) {
  return splitCommaParts(rest).map(s => s.replace(/,$/, '').trim()).filter(Boolean);
}

function createEntry(name) {
  return {
    name,
    scale: 1,
    meshes: [],
    factions: [],
    attachFactions: [],
    mountTypes: [],
    torchBoneIndex: -1,
    torch: [0, 0, 0, 0, 0, 0],
    skeletons: [],
    indivRange: null,
    sprites: [],
    tri: null,
  };
}

function parseTexture(rest) {
  const parts = splitCommaParts(rest);
  if (parts.length < 2) return null;
  const texture = parts[parts.length - 1];
  const faction = parts[0];
  const variant = parts.length > 2 ? parts.slice(1, -1).join(', ') : '';
  return { faction, texture, normalTex: '', sprite: '', variant };
}

function parseModelLine(keyword, rest) {
  const parts = splitCommaParts(rest);
  if (parts.length < 1) return null;
  const path = parts[0];
  const dist = parseDist(parts[1]);
  return { path, dist, modelType: keyword };
}

function parseSprite(rest) {
  const parts = splitCommaParts(rest);
  if (parts.length < 2) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(parts[0])) {
    return { faction: 'default', dist: parseDist(parts[0]), path: parts.slice(1).join(', ') };
  }
  return { faction: parts[0], dist: parseDist(parts[1]), path: parts.slice(2).join(', ') };
}

function parseTri(rest) {
  const parts = splitCommaParts(rest);
  if (parts.length < 4) return null;
  return {
    dist: parseDist(parts[0]),
    r: parseFloat(parts[1].replace(/f$/i, '')),
    g: parseFloat(parts[2].replace(/f$/i, '')),
    b: parseFloat(parts[3].replace(/f$/i, '')),
  };
}

function finalizeEntry(entry) {
  if (!entry) return null;
  const defaultSprite = entry.sprites.find(s => s.faction === 'default')?.path || '';
  const spriteByFaction = new Map(entry.sprites.map(s => [s.faction.toLowerCase(), s.path]));
  entry.factions = entry.factions.map(f => ({
    ...f,
    sprite: spriteByFaction.get(f.faction.toLowerCase()) || defaultSprite || f.sprite || '',
  }));
  return entry;
}

export function parseDescrModelBattle(text) {
  const entries = [];
  let current = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;

    const typeMatch = line.match(/^type\s+(.+)$/i);
    if (typeMatch) {
      const finished = finalizeEntry(current);
      if (finished) entries.push(finished);
      current = createEntry(typeMatch[1].trim());
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^(\S+)\s+(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const rest = kv[2].trim();

    if (key === 'skeleton') {
      current.skeletons = parseSkeletons(rest);
      continue;
    }
    if (key.startsWith('skeleton_')) {
      const mountType = key.replace(/^skeleton_/, '');
      const skeletons = parseSkeletons(rest);
      current.mountTypes.push({
        mountType,
        primarySkeleton: skeletons[0] || '',
        secondarySkeleton: skeletons[1] || '',
        primaryWeapons: [],
        secondaryWeapons: [],
      });
      continue;
    }
    if (key === 'scale') {
      const scale = parseFloat(rest);
      if (Number.isFinite(scale)) current.scale = scale;
      continue;
    }
    if (key === 'indiv_range') {
      current.indivRange = parseDist(rest);
      continue;
    }
    if (key === 'texture') {
      const texture = parseTexture(rest);
      if (texture) current.factions.push(texture);
      continue;
    }
    if (MODEL_KEYS.has(key)) {
      const model = parseModelLine(key, rest);
      if (model) current.meshes.push(model);
      continue;
    }
    if (key === 'model_sprite') {
      const sprite = parseSprite(rest);
      if (sprite) current.sprites.push(sprite);
      continue;
    }
    if (key === 'model_tri') {
      current.tri = parseTri(rest);
    }
  }

  const finished = finalizeEntry(current);
  if (finished) entries.push(finished);

  const byName = {};
  for (const entry of entries) byName[entry.name.toLowerCase()] = entry;
  return { sourceFormat: 'descr_model_battle', totalEntries: entries.length, entries, byName, raw: text };
}

function fmtFloat(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0';
  return String(value);
}

function distOut(dist) {
  return Number(dist) >= MAX_DIST ? 'max' : String(dist);
}

export function serializeDescrModelBattle(parsed) {
  const lines = [
    '; Generated by Mylae RTW/M2TW Mod Editor',
    '; Rome descr_model_battle.txt',
    '',
  ];

  for (const entry of parsed?.entries || []) {
    lines.push(`type\t\t\t\t${entry.name}`);
    if (entry.skeletons?.length) lines.push(`skeleton\t\t\t${entry.skeletons.join(', ')}`);
    for (const mt of entry.mountTypes || []) {
      const skels = [mt.primarySkeleton, mt.secondarySkeleton].filter(Boolean).join(', ');
      if (mt.mountType && skels) lines.push(`skeleton_${mt.mountType}\t\t${skels}`);
    }
    if ((entry.scale ?? 1) !== 1) lines.push(`scale\t\t\t\t${fmtFloat(entry.scale)}`);
    if (entry.indivRange !== null && entry.indivRange !== undefined) lines.push(`indiv_range\t\t\t${entry.indivRange}`);

    for (const f of entry.factions || []) {
      const parts = [f.faction, f.variant, f.texture].filter(Boolean);
      lines.push(`texture\t\t\t\t${parts.join(', ')}`);
    }
    for (const mesh of entry.meshes || []) {
      lines.push(`${mesh.modelType || 'model_flexi'}\t\t\t${mesh.path}, ${distOut(mesh.dist)}`);
    }
    for (const s of entry.sprites || []) {
      if (s.faction && s.faction !== 'default') lines.push(`model_sprite\t\t${s.faction}, ${fmtFloat(s.dist)}, ${s.path}`);
      else lines.push(`model_sprite\t\t${fmtFloat(s.dist)}, ${s.path}`);
    }
    if (entry.tri) {
      lines.push(`model_tri\t\t\t${distOut(entry.tri.dist)}, ${fmtFloat(entry.tri.r)}f, ${fmtFloat(entry.tri.g)}f, ${fmtFloat(entry.tri.b)}f`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
