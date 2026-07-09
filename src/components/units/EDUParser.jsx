import { toCRLF } from '@/lib/lineEndings';

// Parser and serializer for export_descr_unit.txt (EDU)

export const CATEGORIES = ['infantry', 'cavalry', 'handler', 'non_combatant', 'siege', 'ship'];
export const CLASSES = ['light', 'heavy', 'missile', 'spearmen'];
export const VOICE_TYPES = ['Female_1', 'General_1', 'Heavy_1', 'Light_1', 'Medium_1', 'Heavy', 'Light', 'General'];
export const ACCENTS = ['Roman', 'Barbarian', 'Greek', 'Carthaginian', 'Eastern', 'Egyptian'];
export const UNIT_ATTRIBUTES = [
  'sea_faring','hide_forest','hide_improved_forest','hide_anywhere','frighten_foot',
  'frighten_mounted','can_run_amok','general_unit','cantabrian_circle',
  'no_custom','not_horde','very_hardy','hardy','can_withdraw','can_sap',
  'free_upkeep_unit','is_peasant','slave','power_charge','mercenary_unit',
  'pike','spear','warcry','drilled','legionary_name','screeching_women',
  'rapid_reload','thrown','javelin','ghost_unit','no_custom',
];
export const WEAPON_TYPES = ['melee','missile'];
export const WEAPON_TECH = ['simple','blade','melee_simple','melee_blade','melee_blade_slash','melee_blade_thrust','missile','missile_mechanical','siege_missile'];
export const DAMAGE_TYPES = ['piercing','slashing','blunt','fire'];
export const WEAPON_NAMES = ['none','knife','spear','sword','axe','mace','hammer','pike','lance','club','bow','catapult_shot','ballista_bolt','fire_bolt','javelin','pilum'];
export const PROJECTILE_TYPES = ['no','arrow','bolt','rock','heavy_rock','quicklime','fire_pot','javelin','pilum'];
export const ARMOUR_MATERIALS = ['flesh','leather','metal','plate'];
export const MENTAL_TYPES = ['impetuous','normal','calm','steady'];
export const MENTAL_TRAINING = ['untrained','trained','highly_trained','disciplined'];
export const FORMATIONS = ['square','wedge','phalanx','horde','testudo','column','line'];
export const OWNERSHIP_FACTIONS = [
  'all',
  'romans_julii','romans_brutii','romans_scipii','romans_senate','egypt','seleucid',
  'carthage','parthia','pontus','gauls','germans','britons','greek_cities','macedon',
  'dacia','numidia','scythia','spain','thrace','armenia','slave',
];

export function cleanOwnershipList(ownership) {
  const values = Array.isArray(ownership) ? ownership : String(ownership || '').split(',');
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = String(value || '').replace(/,+$/g, '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function parseKV(line) {
  const match = String(line || '').match(/^(\S+)(?:\s+(.*))?$/);
  if (!match) return { key: '', value: '' };
  return { key: match[1].trim(), value: (match[2] || '').trim() };
}

function cleanKey(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith(';')) return '';
  return parseKV(trimmed).key.toLowerCase();
}

function withInlineComment(rawLine, line) {
  const commentAt = String(rawLine || '').indexOf(';');
  if (commentAt < 0) return line;
  const comment = String(rawLine).slice(commentAt).trimEnd();
  return comment ? `${line} ${comment}` : line;
}

function kvLine(key, value, rawLine) {
  return withInlineComment(rawLine, `${key.padEnd(17)}${value}`);
}

function statProjectile(stat) {
  return String(stat || '').split(',')[2]?.trim() || '';
}

export function inferSiegeEngine(unit) {
  if (unit?.engine) return unit.engine;
  if (String(unit?.category || '').toLowerCase() !== 'siege') return '';

  const type = String(unit?.type || '').toLowerCase();
  if (type.includes('large lithobolos') || type.includes('large_lithobolos')) return 'large_lithobolos';
  if (type.includes('palintone')) return 'palintone';
  if (type.includes('repeating ballista') || type.includes('repeating_ballista')) return 'repeating_ballista';
  if (type.includes('heavy onager') || type.includes('heavy_onager')) return 'heavy_onager';
  if (type.includes('onager')) return 'onager';
  if (type.includes('scorpion')) return 'scorpion';
  if (type.includes('ballista')) return 'ballista';

  const projectiles = [statProjectile(unit?.stat_pri), statProjectile(unit?.stat_sec)]
    .map(v => String(v || '').toLowerCase())
    .filter(v => v && v !== 'no');

  if (projectiles.includes('repeating_ballista')) return 'repeating_ballista';
  if (projectiles.includes('scorpion') || projectiles.includes('scorpion_new')) return 'scorpion';
  if (projectiles.includes('ballista')) return 'ballista';
  if (projectiles.includes('big_boulder')) return 'heavy_onager';
  if (projectiles.includes('boulder')) return 'onager';
  return '';
}

function parseUnit(lines) {
  const unit = {
    type: '', dictionary: '', dictionaryComment: '',
    category: 'infantry', class: 'heavy', voice_type: 'Heavy', accent: '',
    // soldier: model, num, extras, mass
    soldier_model: '', soldier_num: 60, soldier_extras: 0, soldier_mass: 1,
    animal: '', engine: '',
    officer1: '', officer2: '', officer3: '',
    mount: '', mount_effect: '',
    attributes: [],
    move_speed_mod: '',
    // formation: spacing, rank_spacing, deep_spacing, deep_rank_spacing, ranks, formations...
    formation: '1.2, 1.2, 2.4, 2.4, 8, square',
    stat_health: '1, 0',
    // stat_pri: attack, charge, projectile, range, ammunition, weapontype, tech, damage, weapon, lethality, minRange, canShootOverWalls
    stat_pri: '7, 3, no, 0, 0, melee, melee_blade, piercing, sword, 25, 1',
    stat_pri_attr: 'no',
    stat_sec: '5, 2, no, 0, 0, melee, melee_blade, piercing, sword, 25, 1',
    stat_sec_attr: 'no',
    // armour: armour, defence_skill, shield, material
    stat_pri_armour: '3, 5, 2, flesh',
    stat_sec_armour: '0, 0, flesh',
    stat_heat: 2,
    stat_ground: '2, -1, 3, 2',
    // mental: morale, discipline, training
    stat_mental: '11, normal, trained',
    stat_charge_dist: 30,
    stat_fire_delay: 0,
    stat_food: '60, 300',
    // cost: turns, cost, upkeep, weapon cost, armour cost, custom_limit, exp_requirement, move_pts
    stat_cost: '1, 500, 175, 100, 100, 500, 4, 100',
    ownership: ['romans_julii'],
    info_pics: '',
    card_pic: '',
    card_info: '',
    _rawLines: [...lines],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    const { key, value } = parseKV(trimmed);
    // Strip inline comments
    const cleanVal = value.split(';')[0].trim();

    switch (key) {
      case 'type': unit.type = cleanVal; break;
      case 'dictionary': {
        const parts = value.split(';');
        unit.dictionary = parts[0].trim();
        unit.dictionaryComment = parts[1] ? parts[1].trim() : '';
        break;
      }
      case 'category': unit.category = cleanVal; break;
      case 'class': unit.class = cleanVal; break;
      case 'voice_type': unit.voice_type = cleanVal; break;
      case 'accent': unit.accent = cleanVal; break;
      case 'soldier': {
        const parts = cleanVal.split(',').map(s => s.trim());
        unit.soldier_model = parts[0] || '';
        unit.soldier_num = parseInt(parts[1]) || 60;
        unit.soldier_extras = parseInt(parts[2]) || 0;
        unit.soldier_mass = parseFloat(parts[3]) || 1;
        break;
      }
      case 'animal': unit.animal = cleanVal; break;
      case 'engine': unit.engine = cleanVal; break;
      case 'officer':
        if (!unit.officer1) unit.officer1 = cleanVal;
        else if (!unit.officer2) unit.officer2 = cleanVal;
        else unit.officer3 = cleanVal;
        break;
      case 'mount': unit.mount = cleanVal; break;
      case 'mount_effect': unit.mount_effect = cleanVal; break;
      case 'attributes': unit.attributes = cleanVal.split(',').map(s => s.trim()).filter(Boolean); break;
      case 'move_speed_mod': unit.move_speed_mod = cleanVal; break;
      case 'formation': unit.formation = cleanVal; break;
      case 'stat_health': unit.stat_health = cleanVal; break;
      case 'stat_pri': unit.stat_pri = cleanVal; break;
      case 'stat_pri_attr': unit.stat_pri_attr = cleanVal; break;
      case 'stat_sec': unit.stat_sec = cleanVal; break;
      case 'stat_sec_attr': unit.stat_sec_attr = cleanVal; break;
      case 'stat_pri_armour': unit.stat_pri_armour = cleanVal; break;
      case 'stat_sec_armour': unit.stat_sec_armour = cleanVal; break;
      case 'stat_heat': unit.stat_heat = parseInt(cleanVal) || 0; break;
      case 'stat_ground': unit.stat_ground = cleanVal; break;
      case 'stat_mental': unit.stat_mental = cleanVal; break;
      case 'stat_charge_dist': unit.stat_charge_dist = parseInt(cleanVal) || 30; break;
      case 'stat_fire_delay': unit.stat_fire_delay = parseInt(cleanVal) || 0; break;
      case 'stat_food': unit.stat_food = cleanVal; break;
      case 'stat_cost': unit.stat_cost = cleanVal; break;
      case 'ownership': unit.ownership = cleanOwnershipList(cleanVal); break;
      case 'info_pic_dir': unit.info_pics = cleanVal; break;
      case 'card_pic_dir': unit.card_pic = cleanVal; break;
      case 'card_info_pic_dir': unit.card_info = cleanVal; break;
      default: break;
    }
  }
  unit._rawLines = [...lines];
  return unit;
}

export function parseEDU(text) {
  const lines = text.split('\n');
  const units = [];
  let currentLines = [];
  let inUnit = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^type\s+/i.test(trimmed) && !/^voice_type\s+/i.test(trimmed)) {
      if (inUnit && currentLines.length > 0) {
        units.push(parseUnit(currentLines));
      }
      inUnit = true;
      currentLines = [line];
    } else if (inUnit) {
      currentLines.push(line);
    }
  }
  if (inUnit && currentLines.length > 0) units.push(parseUnit(currentLines));
  return units;
}

function officerLines(unit) {
  return [unit.officer1, unit.officer2, unit.officer3]
    .filter(Boolean)
    .map(officer => `officer          ${officer}`);
}

function serializeKnownLine(key, unit, rawLine) {
  switch (key) {
    case 'type': return kvLine('type', unit.type, rawLine);
    case 'dictionary': return `dictionary       ${unit.dictionary}      ; ${unit.dictionaryComment || unit.type}`;
    case 'category': return kvLine('category', unit.category, rawLine);
    case 'class': return kvLine('class', unit.class, rawLine);
    case 'voice_type': return kvLine('voice_type', unit.voice_type, rawLine);
    case 'accent': return unit.accent ? kvLine('accent', unit.accent, rawLine) : null;
    case 'soldier': return kvLine('soldier', `${unit.soldier_model}, ${unit.soldier_num}, ${unit.soldier_extras}, ${unit.soldier_mass}`, rawLine);
    case 'animal': return unit.animal ? kvLine('animal', unit.animal, rawLine) : null;
    case 'engine': {
      const engine = inferSiegeEngine(unit);
      return engine ? kvLine('engine', engine, rawLine) : null;
    }
    case 'mount': return unit.mount ? kvLine('mount', unit.mount, rawLine) : null;
    case 'mount_effect': return unit.mount_effect ? kvLine('mount_effect', unit.mount_effect, rawLine) : null;
    case 'attributes': return unit.attributes?.length ? kvLine('attributes', unit.attributes.join(', '), rawLine) : null;
    case 'move_speed_mod': return unit.move_speed_mod ? kvLine('move_speed_mod', unit.move_speed_mod, rawLine) : null;
    case 'formation': return kvLine('formation', unit.formation, rawLine);
    case 'stat_health': return kvLine('stat_health', unit.stat_health, rawLine);
    case 'stat_pri': return kvLine('stat_pri', unit.stat_pri, rawLine);
    case 'stat_pri_attr': return kvLine('stat_pri_attr', unit.stat_pri_attr, rawLine);
    case 'stat_sec': return kvLine('stat_sec', unit.stat_sec, rawLine);
    case 'stat_sec_attr': return kvLine('stat_sec_attr', unit.stat_sec_attr, rawLine);
    case 'stat_pri_armour': return kvLine('stat_pri_armour', unit.stat_pri_armour, rawLine);
    case 'stat_sec_armour': return kvLine('stat_sec_armour', unit.stat_sec_armour, rawLine);
    case 'stat_heat': return kvLine('stat_heat', unit.stat_heat, rawLine);
    case 'stat_ground': return kvLine('stat_ground', unit.stat_ground, rawLine);
    case 'stat_mental': return kvLine('stat_mental', unit.stat_mental, rawLine);
    case 'stat_charge_dist': return kvLine('stat_charge_dist', unit.stat_charge_dist, rawLine);
    case 'stat_fire_delay': return kvLine('stat_fire_delay', unit.stat_fire_delay, rawLine);
    case 'stat_food': return kvLine('stat_food', unit.stat_food, rawLine);
    case 'stat_cost': return kvLine('stat_cost', unit.stat_cost, rawLine);
    case 'ownership': return kvLine('ownership', cleanOwnershipList(unit.ownership).join(', '), rawLine);
    case 'info_pic_dir': return unit.info_pics ? kvLine('info_pic_dir', unit.info_pics, rawLine) : null;
    case 'card_pic_dir': return unit.card_pic ? kvLine('card_pic_dir', unit.card_pic, rawLine) : null;
    case 'card_info_pic_dir': return unit.card_info ? kvLine('card_info_pic_dir', unit.card_info, rawLine) : null;
    default: return undefined;
  }
}

function serializeUnitFromTemplate(unit) {
  const rawLines = Array.isArray(unit._rawLines) ? unit._rawLines : [];
  if (!rawLines.length) return null;

  const rawKeys = new Set(rawLines.map(cleanKey).filter(Boolean));
  const engine = inferSiegeEngine(unit);
  const out = [];
  let emittedOfficers = false;

  const emitMissingAfterSoldier = () => {
    if (!rawKeys.has('animal') && unit.animal) out.push(`animal           ${unit.animal}`);
    if (!rawKeys.has('engine') && engine) out.push(`engine           ${engine}`);
    if (!rawKeys.has('officer')) out.push(...officerLines(unit));
    if (!rawKeys.has('mount') && unit.mount) out.push(`mount            ${unit.mount}`);
    if (!rawKeys.has('mount_effect') && unit.mount_effect) out.push(`mount_effect     ${unit.mount_effect}`);
  };

  const emitMissingAfterVoice = () => {
    if (!rawKeys.has('accent') && unit.accent) out.push(`accent           ${unit.accent}`);
  };

  const emitMissingAfterAttributes = () => {
    if (!rawKeys.has('move_speed_mod') && unit.move_speed_mod) out.push(`move_speed_mod   ${unit.move_speed_mod}`);
  };

  const emitMissingAfterOwnership = () => {
    if (!rawKeys.has('info_pic_dir') && unit.info_pics) out.push(`info_pic_dir     ${unit.info_pics}`);
    if (!rawKeys.has('card_pic_dir') && unit.card_pic) out.push(`card_pic_dir     ${unit.card_pic}`);
    if (!rawKeys.has('card_info_pic_dir') && unit.card_info) out.push(`card_info_pic_dir ${unit.card_info}`);
  };

  for (const rawLine of rawLines) {
    const key = cleanKey(rawLine);
    if (!key) {
      out.push(rawLine);
      continue;
    }

    if (key === 'officer') {
      if (!emittedOfficers) {
        out.push(...officerLines(unit));
        emittedOfficers = true;
      }
      continue;
    }

    const serialized = serializeKnownLine(key, unit, rawLine);
    if (serialized === undefined) {
      out.push(rawLine);
      continue;
    }
    if (serialized) out.push(serialized);

    if (key === 'voice_type') emitMissingAfterVoice();
    if (key === 'soldier') emitMissingAfterSoldier();
    if (key === 'attributes') emitMissingAfterAttributes();
    if (key === 'ownership') emitMissingAfterOwnership();
  }

  return out.join('\n');
}

function serializeUnitCanonical(unit) {
  const lines = [];
  lines.push(`type             ${unit.type}`);
  lines.push(`dictionary       ${unit.dictionary}      ; ${unit.dictionaryComment || unit.type}`);
  lines.push(`category         ${unit.category}`);
  lines.push(`class            ${unit.class}`);
  lines.push(`voice_type       ${unit.voice_type}`);
  if (unit.accent) lines.push(`accent           ${unit.accent}`);
  lines.push(`soldier          ${unit.soldier_model}, ${unit.soldier_num}, ${unit.soldier_extras}, ${unit.soldier_mass}`);
  if (unit.animal) lines.push(`animal           ${unit.animal}`);
  const engine = inferSiegeEngine(unit);
  if (engine) lines.push(`engine           ${engine}`);
  lines.push(...officerLines(unit));
  if (unit.mount) lines.push(`mount            ${unit.mount}`);
  if (unit.mount_effect) lines.push(`mount_effect     ${unit.mount_effect}`);
  if (unit.attributes.length > 0) lines.push(`attributes       ${unit.attributes.join(', ')}`);
  if (unit.move_speed_mod) lines.push(`move_speed_mod   ${unit.move_speed_mod}`);
  lines.push(`formation        ${unit.formation}`);
  lines.push(`stat_health      ${unit.stat_health}`);
  lines.push(`stat_pri         ${unit.stat_pri}`);
  lines.push(`;stat_pri_ex     0, 0, 0`);
  lines.push(`stat_pri_attr    ${unit.stat_pri_attr}`);
  lines.push(`stat_sec         ${unit.stat_sec}`);
  lines.push(`;stat_sec_ex     0, 0, 0`);
  lines.push(`stat_sec_attr    ${unit.stat_sec_attr}`);
  lines.push(`stat_pri_armour  ${unit.stat_pri_armour}`);
  lines.push(`;stat_armour_ex  0, 0, 0, 0, 5, 0, 0, flesh`);
  lines.push(`stat_sec_armour  ${unit.stat_sec_armour}`);
  lines.push(`stat_heat        ${unit.stat_heat}`);
  lines.push(`stat_ground      ${unit.stat_ground}`);
  lines.push(`stat_mental      ${unit.stat_mental}`);
  lines.push(`stat_charge_dist ${unit.stat_charge_dist}`);
  lines.push(`stat_fire_delay  ${unit.stat_fire_delay}`);
  lines.push(`stat_food        ${unit.stat_food}`);
  lines.push(`stat_cost        ${unit.stat_cost}`);
  lines.push(`ownership        ${cleanOwnershipList(unit.ownership).join(', ')}`);
  if (unit.info_pics) lines.push(`info_pic_dir     ${unit.info_pics}`);
  if (unit.card_pic) lines.push(`card_pic_dir     ${unit.card_pic}`);
  if (unit.card_info) lines.push(`card_info_pic_dir ${unit.card_info}`);
  return lines.join('\n');
}

export function serializeUnit(unit) {
  return serializeUnitFromTemplate(unit) || serializeUnitCanonical(unit);
}

export function serializeEDU(units) {
  return toCRLF(units.map(serializeUnit).join('\n\n'));
}

export function createDefaultUnit() {
  return {
    type: 'New_Unit', dictionary: 'New_Unit', dictionaryComment: 'New Unit',
    category: 'infantry', class: 'heavy', voice_type: 'Heavy', accent: '',
    soldier_model: 'New_Unit', soldier_num: 60, soldier_extras: 0, soldier_mass: 1,
    animal: '', engine: '',
    officer1: '', officer2: '', officer3: '',
    mount: '', mount_effect: '',
    attributes: ['sea_faring', 'can_withdraw'],
    move_speed_mod: '',
    formation: '1.2, 1.2, 2.4, 2.4, 8, square',
    stat_health: '1, 0',
    stat_pri: '7, 3, no, 0, 0, melee, melee_blade, piercing, sword, 25, 1',
    stat_pri_attr: 'no',
    stat_sec: '5, 2, no, 0, 0, melee, melee_blade, piercing, sword, 25, 1',
    stat_sec_attr: 'no',
    stat_pri_armour: '3, 5, 2, flesh',
    stat_sec_armour: '0, 0, flesh',
    stat_heat: 2,
    stat_ground: '2, -1, 3, 2',
    stat_mental: '11, normal, trained',
    stat_charge_dist: 30,
    stat_fire_delay: 0,
    stat_food: '60, 300',
    stat_cost: '1, 500, 175, 100, 100, 500, 4, 100',
    ownership: ['romans_julii'],
    info_pics: '', card_pic: '', card_info: '',
  };
}
