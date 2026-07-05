const CHARACTER_KEYS = [
  ['SPY', 'Spy'],
  ['ASSASSIN', 'Assassin'],
  ['DIPLOMAT', 'Diplomat'],
  ['ADMIRAL', 'Navy'],
  ['GENERAL', 'Army'],
  ['NAMED_CHARACTER', 'Family Member'],
  ['MERCHANT', 'Merchant'],
  ['VILLAGE', 'Village'],
  ['TOWN', 'Town'],
  ['LARGE_TOWN', 'Large Town'],
  ['CITY', 'City'],
  ['LARGE_CITY', 'Large City'],
  ['HUGE_CITY', 'Huge City'],
  ['CAPITAL', 'Capital'],
  ['FORT', 'Fort'],
  ['PORT', 'Port'],
  ['DOCK', 'Docks'],
  ['FISHING_VILLAGE', 'Fishing Village'],
];

function keyUpper(key) {
  return String(key || '').replace(/^\{/, '').replace(/\}$/, '').toUpperCase();
}

function normalizeFactionInternalId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCaseFactionId(value) {
  return normalizeFactionInternalId(value)
    .replace(/_\d+$/i, '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ensureRtwFactionLocEntries(entries, factionName, options = {}) {
  const internalId = normalizeFactionInternalId(factionName);
  const factionUpper = keyUpper(internalId);
  if (!factionUpper) return entries || [];

  const displayName = String(options.displayName || '').trim() || titleCaseFactionId(internalId) || internalId;
  const adjective = String(options.adjective || '').trim() || displayName;
  const pluralName = String(options.pluralName || '').trim() || `${adjective}s`;
  const leaderTitle = String(options.leaderTitle || '').trim() || 'Faction Leader';
  const heirTitle = String(options.heirTitle || '').trim() || 'Faction Heir';
  const description = String(options.description || '').trim()
    || `${displayName}\\nA playable faction configured for the campaign with its own roster, leaders, and battlefield identity.`;
  const strengths = String(options.strengths || '').trim()
    || `${displayName} can draw on regional troops, established command structures, and flexible campaign options.`;
  const weaknesses = String(options.weaknesses || '').trim()
    || `${displayName} must balance expansion with public order, economy, and reliable frontier defense.`;
  const signatureUnit = String(options.customUnit || options.unit || '').trim()
    || `${adjective} General`;

  const next = (entries || []).map(entry => ({
    key: String(entry.key || '').replace(/^\{/, '').replace(/\}$/, ''),
    value: entry.value ?? '',
  }));
  const indexByKey = new Map(next.map((entry, index) => [keyUpper(entry.key), index]));

  const upsert = (key, value, force = false) => {
    const normalized = keyUpper(key);
    const index = indexByKey.get(normalized);
    if (index === undefined) {
      indexByKey.set(normalized, next.length);
      next.push({ key, value });
      return;
    }
    if (force || !String(next[index].value ?? '').trim()) {
      next[index] = { ...next[index], key, value };
    }
  };

  upsert(factionUpper, displayName, !!options.displayName);
  for (const [key, label] of CHARACTER_KEYS) {
    upsert(`EMT_${factionUpper}_${key}`, `${adjective} ${label}`);
  }
  upsert(`EMT_${factionUpper}_FACTION_LEADER`, leaderTitle, !!options.leaderTitle);
  upsert(`EMT_${factionUpper}_FACTION_HEIR`, heirTitle, !!options.heirTitle);

  upsert(`EMT_YOUR_FORCES_ATTACK_ARMY_${factionUpper}`, `Your forces attack an army of ${displayName}`);
  upsert(`EMT_YOUR_FORCES_ATTACK_NAVY_${factionUpper}`, `Your forces attack a navy of ${displayName}`);
  upsert(`EMT_YOUR_FORCES_AMBUSH_ARMY_${factionUpper}`, `Your forces ambush an army of ${displayName}`);
  upsert(`EMT_YOUR_FORCES_ATTACKED_ARMY_${factionUpper}`, `Your forces are attacked by an army of ${displayName}`);
  upsert(`EMT_YOUR_FORCES_ATTACKED_NAVY_${factionUpper}`, `Your forces are attacked by a navy of ${displayName}`);
  upsert(`EMT_YOUR_FORCES_AMBUSHED_ARMY_${factionUpper}`, `Your forces are ambushed by an army of ${displayName}`);
  upsert(`EMT_VICTORY_${factionUpper}`, `The ${pluralName} are victorious`);
  upsert(`EMT_VICTORY_DESCR_${factionUpper}`, `${displayName} has risen from a regional power into a force feared across the world.`);
  upsert(`EMT_DEFEATED_BY_${factionUpper}`, `Victory has been claimed by ${displayName}. Their enemies have been humbled, and their name now carries the authority of conquerors.`);
  upsert(`EMT_SHORT_VICTORY_${factionUpper}`, `${displayName} stands among the powers of the world.`);
  upsert(`${factionUpper}_DESCR`, description, !!options.description);
  upsert(`${factionUpper}_STRENGTH`, strengths, !!options.strengths);
  upsert(`${factionUpper}_WEAKNESS`, weaknesses, !!options.weaknesses);
  upsert(`${factionUpper}_UNIT`, signatureUnit, !!(options.customUnit || options.unit));

  return next;
}

export function extractFactionIdsFromLocEntries(entries) {
  const ids = new Set();
  const add = (value) => {
    const id = keyUpper(value);
    if (id) ids.add(id.toLowerCase());
  };

  for (const entry of entries || []) {
    const key = keyUpper(entry.key);
    let match;
    if ((match = key.match(/^EMT_(YOUR_FORCES_(?:ATTACKED|ATTACK|AMBUSHED|AMBUSH)_(?:ARMY|NAVY)|VICTORY_DESCR|VICTORY|DEFEATED_BY|SHORT_VICTORY)_([A-Z0-9_]+)$/))) {
      add(match[2]);
    } else if ((match = key.match(/^EMT_([A-Z0-9_]+)_(SPY|ASSASSIN|DIPLOMAT|ADMIRAL|GENERAL|NAMED_CHARACTER|MERCHANT|VILLAGE|TOWN|LARGE_TOWN|CITY|LARGE_CITY|HUGE_CITY|CAPITAL|FORT|PORT|DOCK|FISHING_VILLAGE|FACTION_LEADER|FACTION_HEIR)$/))) {
      add(match[1]);
    } else if ((match = key.match(/^([A-Z0-9_]+)_(DESCR|STRENGTH|WEAKNESS|UNIT)$/))) {
      add(match[1]);
    } else if (/^[A-Z0-9_]+$/.test(key) && !key.startsWith('EMT_') && !key.startsWith('UI_')) {
      add(key);
    }
  }

  return [...ids].sort();
}
