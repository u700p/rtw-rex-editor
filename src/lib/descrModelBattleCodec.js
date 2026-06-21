/**
 * Parser/serializer for Rome: Total War descr_model_battle.txt.
 *
 * The unit editor already understands the M2TW battle_models.modeldb shape, so
 * this parser projects RTW model blocks into the same broad structure:
 * { entries, byName, factions, meshes, mountTypes, scale }.
 */

import { toCRLF } from '@/lib/lineEndings';

const MODEL_KEYS = new Set(['model_flexi', 'model_flexi_m', 'model_flexi_c', 'model_mesh', 'model_stat']);
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
    type: name,
    scale: 1,
    meshes: [],
    factions: [],
    attachFactions: [],
    mountTypes: [],
    torchBoneIndex: -1,
    torch: [0, 0, 0, 0, 0, 0],
    skeletons: [],
    skeleton: '',
    skeleton_horse: '',
    indivRange: null,
    indiv_range: '',
    sprites: [],
    tri: null,
    textures: [],
    pbr: [],
    model_flexi: [],
    model_flexi_m: [],
    model_flexi_c: [],
    model_mesh: [],
    model_stat: [],
    model_sprite: [],
    model_tri: '',
    _extra: [],
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
  entry.type = entry.type || entry.name;
  entry.name = entry.name || entry.type;

  const defaultSprite = entry.sprites.find(s => s.faction === 'default')?.path || '';
  const spriteByFaction = new Map(entry.sprites.map(s => [s.faction.toLowerCase(), s.path]));
  entry.factions = entry.factions.map(f => ({
    ...f,
    sprite: spriteByFaction.get(f.faction.toLowerCase()) || defaultSprite || f.sprite || '',
  }));
  if (!entry.textures.length) {
    entry.textures = entry.factions.map(f => ({
      faction: f.faction || 'all',
      path: f.texture || f.path || '',
      variant: f.variant || '',
    }));
  }
  if (!entry.model_sprite.length) {
    entry.model_sprite = entry.sprites.map(s => ({
      faction: s.faction,
      path: s.path,
      dist: s.dist,
    }));
  }
  if (!entry.model_tri && entry.tri) {
    entry.model_tri = `${distOut(entry.tri.dist)}, ${fmtFloat(entry.tri.r)}f, ${fmtFloat(entry.tri.g)}f, ${fmtFloat(entry.tri.b)}f`;
  }
  return entry;
}

export function syncDescrModelBattleEntryAliases(entry, source = 'descriptor') {
  if (!entry) return entry;
  const next = {
    ...entry,
    name: entry.name || entry.type,
    type: entry.type || entry.name,
  };

  if (source === 'legacy') {
    const horseMount = (next.mountTypes || []).find(mt => mt.mountType === 'horse');
    if (horseMount?.primarySkeleton || horseMount?.secondarySkeleton) {
      next.skeleton_horse = [horseMount.primarySkeleton, horseMount.secondarySkeleton].filter(Boolean).join(', ');
    }

    if (Array.isArray(next.factions)) {
      next.textures = next.factions
        .map(f => ({
          faction: f.faction || 'all',
          path: f.texture || f.path || '',
          variant: f.variant || '',
        }))
        .filter(t => t.path || t.faction);

      const spriteRows = next.factions
        .filter(f => f.sprite)
        .map(f => ({ faction: f.faction || 'default', path: f.sprite, dist: MAX_DIST }));
      if (spriteRows.length) {
        next.sprites = spriteRows;
        next.model_sprite = spriteRows.map(s => ({ faction: s.faction, path: s.path, dist: s.dist }));
      }
    }

    if (Array.isArray(next.meshes)) {
      const grouped = Object.fromEntries(MODEL_KEYS_VALUES.map(key => [key, []]));
      for (const mesh of next.meshes) {
        const key = MODEL_KEYS.has(mesh.modelType) ? mesh.modelType : 'model_flexi';
        grouped[key].push({ path: mesh.path || '', dist: mesh.dist ?? MAX_DIST });
      }
      for (const [key, rows] of Object.entries(grouped)) next[key] = rows;
    }
  } else {
    if (typeof next.skeleton === 'string' && next.skeleton.trim()) {
      next.skeletons = parseSkeletons(next.skeleton);
    }
    if (next.skeleton_horse) {
      const horseSkeletons = parseSkeletons(next.skeleton_horse);
      const horseMount = {
        mountType: 'horse',
        primarySkeleton: horseSkeletons[0] || '',
        secondarySkeleton: horseSkeletons[1] || '',
        primaryWeapons: [],
        secondaryWeapons: [],
      };
      const others = (next.mountTypes || []).filter(mt => mt.mountType !== 'horse');
      next.mountTypes = horseSkeletons.length ? [horseMount, ...others] : others;
    }
    if (next.indiv_range !== null && next.indiv_range !== undefined && next.indiv_range !== '') {
      next.indivRange = parseDist(String(next.indiv_range));
    }

    if (Array.isArray(next.textures)) {
      next.factions = next.textures
        .map(t => ({
          faction: t.faction || 'all',
          texture: t.texture || t.path || '',
          normalTex: '',
          sprite: '',
          variant: t.variant || '',
        }))
        .filter(f => f.texture || f.faction);
    }

    const meshes = MODEL_KEYS_VALUES.flatMap(modelType =>
      (next[modelType] || []).map(m => ({
        path: m.path || '',
        dist: m.dist ?? MAX_DIST,
        modelType,
      }))
    );
    if (meshes.length) next.meshes = meshes;

    if (Array.isArray(next.model_sprite)) {
      next.sprites = next.model_sprite
        .map(s => ({
          faction: s.faction || 'default',
          path: s.path || '',
          dist: parseDist(String(s.dist || 'max')),
        }))
        .filter(s => s.path);
    }
    if (typeof next.model_tri === 'string' && next.model_tri.trim()) {
      next.tri = parseTri(next.model_tri) || next.tri;
    }
  }

  return finalizeEntry(next);
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
      current.skeleton = current.skeletons[0] || '';
      continue;
    }
    if (key.startsWith('skeleton_')) {
      const mountType = key.replace(/^skeleton_/, '');
      const skeletons = parseSkeletons(rest);
      current[key] = rest;
      if (key === 'skeleton_horse') current.skeleton_horse = rest;
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
      current.indiv_range = rest;
      continue;
    }
    if (key === 'texture') {
      const texture = parseTexture(rest);
      if (texture) {
        current.factions.push(texture);
        current.textures.push({ faction: texture.faction, path: texture.texture, variant: texture.variant });
      }
      continue;
    }
    if (MODEL_KEYS.has(key)) {
      const model = parseModelLine(key, rest);
      if (model) {
        current.meshes.push(model);
        current[key].push({ path: model.path, dist: model.dist });
      }
      continue;
    }
    if (key === 'model_sprite') {
      const sprite = parseSprite(rest);
      if (sprite) {
        current.sprites.push(sprite);
        current.model_sprite.push({ faction: sprite.faction, path: sprite.path, dist: sprite.dist });
      }
      continue;
    }
    if (key === 'model_tri') {
      current.tri = parseTri(rest);
      current.model_tri = rest;
      continue;
    }
    current._extra.push(line);
  }

  const finished = finalizeEntry(current);
  if (finished) entries.push(finished);

  const byName = {};
  const byType = {};
  for (const entry of entries) {
    byName[entry.name.toLowerCase()] = entry;
    byType[(entry.type || entry.name).toLowerCase()] = entry;
  }
  return { sourceFormat: 'descr_model_battle', totalEntries: entries.length, entries, byName, byType, raw: text };
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
    '; Generated by Mylae Rome: Total War Mod Editor',
    '; Rome descr_model_battle.txt',
    '',
  ];

  for (const entry of parsed?.entries || []) {
    const name = entry.name || entry.type;
    lines.push(`type\t\t\t\t${name}`);

    const skeletons = entry.skeleton
      ? parseSkeletons(entry.skeleton)
      : (entry.skeletons?.length ? entry.skeletons : []);
    if (skeletons.length) lines.push(`skeleton\t\t\t${skeletons.join(', ')}`);

    if (entry.skeleton_horse) {
      lines.push(`skeleton_horse\t\t${entry.skeleton_horse}`);
    }
    for (const mt of entry.mountTypes || []) {
      if (mt.mountType === 'horse' && entry.skeleton_horse) continue;
      const skels = [mt.primarySkeleton, mt.secondarySkeleton].filter(Boolean).join(', ');
      if (mt.mountType && skels) lines.push(`skeleton_${mt.mountType}\t\t${skels}`);
    }
    if ((entry.scale ?? 1) !== 1) lines.push(`scale\t\t\t\t${fmtFloat(entry.scale)}`);
    const indivRange = entry.indiv_range ?? entry.indivRange;
    if (indivRange !== null && indivRange !== undefined && indivRange !== '') lines.push(`indiv_range\t\t\t${indivRange}`);

    const factions = (entry.textures?.length ? entry.textures.map(t => ({
      faction: t.faction,
      variant: t.variant,
      texture: t.texture || t.path,
    })) : (entry.factions || []));
    for (const f of factions) {
      const parts = [f.faction, f.variant, f.texture || f.path].filter(Boolean);
      lines.push(`texture\t\t\t\t${parts.join(', ')}`);
    }

    const meshes = MODEL_KEYS_VALUES.flatMap(modelType => (entry[modelType] || []).map(m => ({ ...m, modelType })));
    const meshRows = meshes.length ? meshes : (entry.meshes || []);
    for (const mesh of meshRows) {
      lines.push(`${mesh.modelType || 'model_flexi'}\t\t\t${mesh.path}, ${distOut(mesh.dist)}`);
    }
    const sprites = entry.model_sprite?.length
      ? entry.model_sprite.map(s => ({ ...s, dist: parseDist(String(s.dist || 'max')) }))
      : (entry.sprites || []);
    for (const s of sprites) {
      if (s.faction && s.faction !== 'default') lines.push(`model_sprite\t\t${s.faction}, ${fmtFloat(s.dist)}, ${s.path}`);
      else lines.push(`model_sprite\t\t${fmtFloat(s.dist)}, ${s.path}`);
    }
    if (typeof entry.model_tri === 'string' && entry.model_tri.trim()) {
      lines.push(`model_tri\t\t\t${entry.model_tri.trim()}`);
    } else if (entry.tri) {
      lines.push(`model_tri\t\t\t${distOut(entry.tri.dist)}, ${fmtFloat(entry.tri.r)}f, ${fmtFloat(entry.tri.g)}f, ${fmtFloat(entry.tri.b)}f`);
    }
    for (const extra of entry._extra || []) if (extra) lines.push(extra);
    lines.push('');
  }

  return toCRLF(lines.join('\n'));
}

const MODEL_KEYS_VALUES = [...MODEL_KEYS];

export function createDefaultBattleModelEntry(typeName) {
  return finalizeEntry(createEntry(typeName || 'new_model_type'));
}
