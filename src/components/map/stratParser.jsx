/**
 * Parser and serializer for Total War descr_strat.txt, descr_regions.txt,
 * *_regions_and_settlement_names.txt, and descr_sm_factions.txt
 */
import { parseTextLocFile } from '@/lib/textLocParser';
import { toCRLF } from '@/lib/lineEndings';

export const SETTLEMENT_LEVELS = ['village', 'town', 'large_town', 'city', 'large_city', 'huge_city'];
export const SETTLEMENT_LEVEL_ICONS = {
  village: '🏘️', town: '🏚️', large_town: '🏠',
  city: '🏛️', large_city: '🏰', huge_city: '👑',
};

// ─── Utility ──────────────────────────────────────────────────────────────────
function cleanLine(l) { return l.replace(/;.*$/, '').trim(); }

// ─── Building block parser { type tree level } ────────────────────────────────
function parseBuildingBlock(lines, i) {
  // skip to opening brace
  while (i < lines.length && !cleanLine(lines[i]).includes('{')) i++;
  i++; // skip {
  const buildings = [];
  let depth = 1;
  while (i < lines.length && depth > 0) {
    const line = cleanLine(lines[i]);
    if (line === '{') { depth++; i++; continue; }
    if (line === '}') { depth--; if (depth === 0) break; i++; continue; }
    // "type core_building wooden_wall"
    const m = line.match(/^type\s+(.+)/);
    if (m) buildings.push(m[1].trim());
    i++;
  }
  return { buildings, endIndex: i };
}

// ─── Settlement block parser ───────────────────────────────────────────────────
// Called when we are at the line AFTER "settlement".
function parseSettlementBlock(lines, startI, lineStartOverride) {
  // skip to opening brace
  let i = startI;
  while (i < lines.length && !cleanLine(lines[i]).includes('{')) i++;
  const lineStart = lineStartOverride ?? (startI - 1);
  i++; // skip {

  const settlement = {
    level: 'village', region: '', population: 0,
    yearFounded: 0, planSet: 'default_set', factionCreator: '',
    buildings: [], upgrades: [], x: null, y: null,
    _lineStart: lineStart,
  };

  let depth = 1;
  while (i < lines.length && depth > 0) {
    const line = cleanLine(lines[i]);
    if (line === '{') { depth++; i++; continue; }
    if (line === '}') { depth--; if (depth === 0) break; i++; continue; }

    let m;
    if ((m = line.match(/^level\s+(\S+)/)))           settlement.level          = m[1];
    else if ((m = line.match(/^region\s+(\S+)/)))      settlement.region         = m[1];
    else if ((m = line.match(/^population\s+(\d+)/)))  settlement.population     = parseInt(m[1]);
    else if ((m = line.match(/^year_founded\s+(-?\d+)/))) settlement.yearFounded = parseInt(m[1]);
    else if ((m = line.match(/^plan_set\s+(\S+)/)))    settlement.planSet        = m[1];
    else if ((m = line.match(/^faction_creator\s+(\S+)/))) settlement.factionCreator = m[1];
    else if (line === 'building') {
      const { buildings: blds, endIndex } = parseBuildingBlock(lines, i + 1);
      settlement.buildings.push(...blds);
      i = endIndex + 1;
      continue;
    }
    else if (line === 'upgrades') {
      // legacy upgrades block
      let ui = i + 1;
      while (ui < lines.length && !cleanLine(lines[ui]).includes('{')) ui++;
      ui++; let ud = 1;
      while (ui < lines.length && ud > 0) {
        const ul = cleanLine(lines[ui]);
        if (ul === '{') { ud++; ui++; continue; }
        if (ul === '}') { ud--; if (ud === 0) break; ui++; continue; }
        if (ul) settlement.upgrades.push(ul);
        ui++;
      }
      i = ui + 1; continue;
    }
    i++;
  }

  settlement._lineEnd = i;
  return { settlement, endIndex: i };
}

// ─── Character / Agent inline parser ──────────────────────────────────────────
// Parses: "character [sub_faction F,] Name, type, sex, [leader|heir], age N, x X, y Y[, portrait P][, label L][, battle_model B][, hero_ability H][, direction D]"
// followed optionally by traits/ancillaries/army lines
function parseCharacterLine(line, lineIndex) {
  // Extract optional sub_faction prefix
  let subFaction = '';
  let coreLine = line;
  const sfm = line.match(/^character\s+sub_faction\s+(\S+)\s*,\s*/i);
  if (sfm) {
    subFaction = sfm[1];
    coreLine = 'character ' + line.slice(sfm[0].length);
  }

  const m = coreLine.match(/^character\s+(.+?),\s*(named character|general|admiral|spy|diplomat|assassin)\s*,?\s*(male|female)?,?\s*(leader|heir)?,?\s*age\s+(\d+),\s*x\s+(\d+),\s*y\s+(\d+)(.*)/i);
  if (!m) return null;

  const fullName = m[1].trim();
  const spaceIdx = fullName.indexOf(' ');
  const firstName = spaceIdx >= 0 ? fullName.slice(0, spaceIdx) : fullName;
  const surname = spaceIdx >= 0 ? fullName.slice(spaceIdx + 1) : '';

  // Parse optional trailing fields: portrait P, label L, battle_model B, hero_ability H, direction D
  const tail = m[8] || '';
  // Strip trailing comma from values (comma is a separator, not part of the value)
  const stripComma = s => s ? s.replace(/,$/, '') : '';
  const portrait     = stripComma((tail.match(/,\s*portrait\s+(\S+)/i)     || [])[1] || '');
  const label        = stripComma((tail.match(/,\s*label\s+(\S+)/i)        || [])[1] || '');
  const battleModel  = stripComma((tail.match(/,\s*battle_model\s+(\S+)/i) || [])[1] || '');
  const heroAbility  = stripComma((tail.match(/,\s*hero_ability\s+(\S+)/i) || [])[1] || '');
  const direction    = stripComma((tail.match(/,\s*direction\s+(\S+)/i)    || [])[1] || '');

  return {
    name: firstName,
    surname,
    charType: m[2].toLowerCase().trim(),
    sex: (m[3] || 'male').toLowerCase(),
    role: (m[4] || '').toLowerCase(),
    age: parseInt(m[5]),
    x: parseInt(m[6]),
    y: parseInt(m[7]),
    subFaction,
    portrait,
    label,
    battleModel,
    heroAbility,
    direction,
    traits: [],
    ancillaries: [],
    army: [],
    _lineNum: lineIndex,
  };
}

// Build a character line string from a char object
function serializeCharLine(char) {
  // family type → character_record
  if (char.charType === 'family') {
    const fullName = [char.name, char.surname].filter(Boolean).join(' ');
    const isDead = char.status === 'dead';
    const recordRole = char.recordRole || 'never_a_leader';
    // Format: character_record\t\tName, \tsex, age N, dead N, role  OR  alive, role
    if (isDead) {
      return `character_record\t\t${fullName}, \t${char.sex || 'male'}, age ${char.age ?? 0}, dead ${char.deadYears ?? 0}, ${recordRole}`;
    }
    return `character_record\t\t${fullName}, \t${char.sex || 'male'}, age ${char.age ?? 0}, alive, ${recordRole}`;
  }
  // Normal characters — no leading indent (game format)
  const fullName = [char.name, char.surname].filter(Boolean).join(' ');
  let line = `character\t`;
  if (char.subFaction) line += `sub_faction ${char.subFaction}, `;
  line += `${fullName}, ${char.charType}, ${char.sex}`;
  if (char.role) line += `, ${char.role}`;
  line += `, age ${char.age ?? 30}, x ${char.x ?? 0}, y ${char.y ?? 0}`;
  if (char.portrait)    line += `, portrait ${char.portrait}`;
  if (char.label)       line += `, label ${char.label}`;
  if (char.battleModel) line += `, battle_model ${char.battleModel}`;
  if (char.heroAbility) line += `, hero_ability ${char.heroAbility}`;
  if (char.direction)   line += `, direction ${char.direction}`;
  line += ' ';
  return line;
}

// ─── descr_strat.txt ─────────────────────────────────────────────────────────
export function parseDescrStrat(text) {
  const lines = text.split('\n');
  const items = [];
  const factions = [];
  let itemId = 0;

  // Global campaign settings
  let campaignName = '';
  let playable = [];
  let unlockable = [];
  let nonplayable = [];
  let startDate = '', endDate = '', timescale = '';
  let scriptFile = 'campaign_script.txt';

  // Global flags (boolean or string value)
  const flags = {};

  // Diplomacy
  const factionStandings = []; // { faction, targets: [{name, value}] }
  const factionRelationships = []; // { faction, relation, targets }

  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = cleanLine(raw);
    if (!line) { i++; continue; }

    let m;

    // Campaign name
    if ((m = line.match(/^campaign\s+(\S+)/))) {
      campaignName = m[1]; i++; continue;
    }

    // Playable / unlockable / nonplayable blocks
    if (/^playable$/i.test(line)) {
      i++;
      while (i < lines.length) {
        const fl = cleanLine(lines[i]);
        if (/^end$/i.test(fl)) { i++; break; }
        if (fl) playable.push(fl);
        i++;
      }
      continue;
    }
    if (/^unlockable$/i.test(line)) {
      i++;
      while (i < lines.length) {
        const fl = cleanLine(lines[i]);
        if (/^end$/i.test(fl)) { i++; break; }
        if (fl) unlockable.push(fl);
        i++;
      }
      continue;
    }
    if (/^nonplayable$/i.test(line)) {
      i++;
      while (i < lines.length) {
        const fl = cleanLine(lines[i]);
        if (/^end$/i.test(fl)) { i++; break; }
        if (fl) nonplayable.push(fl);
        i++;
      }
      continue;
    }

    // Dates & timescale
    if ((m = line.match(/^start_date\s+(.+)/)))   { startDate = m[1].trim(); i++; continue; }
    if ((m = line.match(/^end_date\s+(.+)/)))      { endDate   = m[1].trim(); i++; continue; }
    if ((m = line.match(/^timescale\s+([\d.]+)/))) { timescale = m[1];        i++; continue; }

    // Script file
    if ((m = line.match(/^script$/i))) {
      const nextLine = cleanLine(lines[i + 1] || '');
      if (nextLine) { scriptFile = nextLine; i += 2; } else i++;
      continue;
    }

    // Flags (key value? or just key)
    if (/^(marian_reforms_(disabled|activated)|rebelling_characters_(active|inactive)|gladiator_uprising_(disabled)|night_battles_(enabled|disabled)|show_date_as_turns)$/i.test(line)) {
      flags[line] = true; i++; continue;
    }
    if ((m = line.match(/^(brigand_spawn_value|pirate_spawn_value)\s+(\d+)/))) {
      flags[m[1]] = parseInt(m[2]); i++; continue;
    }

    // Resources: M2TW commonly uses "resource iron, 83, 128"; RTW files often
    // use whitespace around the comma: "resource iron 83 , 128".
    if ((m = line.match(/^resource\s+(\S+)\s*,?\s*(\d+)\s*,\s*(\d+)/i))) {
      items.push({ id: itemId++, category: 'resource', type: m[1], x: parseInt(m[2]), y: parseInt(m[3]), _lineNum: i });
      i++; continue;
    }

    // Rome landmarks use the same map coordinate overlay shape as resources.
    if ((m = line.match(/^landmark\s+(\S+)\s+(\d+)\s*,\s*(\d+)/i))) {
      items.push({ id: itemId++, category: 'landmark', type: m[1], x: parseInt(m[2]), y: parseInt(m[3]), _lineNum: i });
      i++; continue;
    }

    // Faction block
    if ((m = line.match(/^faction\s+(\w+)(?:\s*,\s*(\w+)\s+(\w+))?(?:\s*,\s*(\w+))?/))) {
      const faction = {
        name: m[1],
        economicAI: m[2] || '',
        militaryAI: m[3] || '',
        shadowing: m[4] === 'shadowing' ? '' : (m[4] === 'shadowed_by' ? undefined : undefined), // resolved below
        aiLabel: '',
        treasury: 0,
        kingsPurse: 0,
        deadUntilResurrected: false,
        deadUntilEmerged: false,
        reEmergent: false,
        undiscovered: false,
        settlements: [],
        characters: [],
        characterRecords: [],
        relatives: [],
      };
      // Parse shadowing/shadowed_by from the raw line
      const shadowM = line.match(/,\s*(shadowing|shadowed_by)\s+(\w+)/);
      if (shadowM) {
        if (shadowM[1] === 'shadowing') faction.shadowing = shadowM[2];
        if (shadowM[1] === 'shadowed_by') faction.shadowedBy = shadowM[2];
      }
      i++;

      while (i < lines.length) {
        const fl = cleanLine(lines[i]);
        if (!fl) { i++; continue; }

        // End of faction: next top-level keyword
        if (
          /^faction\s+\w/i.test(fl) ||
          /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl) ||
          /^region\s+\S/i.test(fl) ||
          /^script\s*$/i.test(fl) ||
          /^(playable|unlockable|nonplayable|start_date|end_date|timescale|campaign)\b/i.test(fl)
        ) {
          break;
        }

        let fm;
        if ((fm = fl.match(/^ai_label\s+(\S+)/)))       { faction.aiLabel     = fm[1]; i++; continue; }
        if ((fm = fl.match(/^denari_kings_purse\s+(\d+)/))) { faction.kingsPurse = parseInt(fm[1]); i++; continue; }
        if ((fm = fl.match(/^denari\s+(\d+)/)))          { faction.treasury    = parseInt(fm[1]); i++; continue; }
        if (/^dead_until_resurrected$/i.test(fl))  { faction.deadUntilResurrected = true; i++; continue; }
        if (/^dead_until_emerged$/i.test(fl))      { faction.deadUntilEmerged = true; i++; continue; }
        if (/^re_emergent$/i.test(fl))             { faction.reEmergent = true; i++; continue; }
        if (/^undiscovered$/i.test(fl))            { faction.undiscovered = true; i++; continue; }

        // Settlement block
        if (/^settlement(\s+castle)?$/i.test(fl)) {
          const { settlement, endIndex } = parseSettlementBlock(lines, i + 1, i);
          settlement.id       = itemId++;
          settlement.faction  = faction.name;
          settlement.category = 'settlement';
          settlement.castle   = false;
          faction.settlements.push(settlement);
          items.push(settlement);
          i = endIndex + 1;
          continue;
        }

        // Inline character line: character Name, type, sex, role, age N, x X, y Y
        // sub_faction prefix is handled inside parseCharacterLine
        if (/^character\s+/i.test(fl)) {
          const char = parseCharacterLine(fl, i);
          if (char) {
            char.id = itemId++;
            char.faction = faction.name;
            char.category = 'character';
            // Parse subsequent trait/ancillary/army lines
            i++;
            while (i < lines.length) {
              const cl = cleanLine(lines[i]);
              if (!cl) { i++; break; }
              // Stop if new character, settlement, character_record, relative, or next faction keyword
              if (/^(character|character_record|relative|settlement|faction|region|faction_standings|action_relationships|faction_relationships)\b/i.test(cl)) break;
              let tm;
              if ((tm = cl.match(/^traits\s+(.+)/i))) {
                // "traits TraitA N , TraitB N"
                const parts = tm[1].split(',').map(s => s.trim()).filter(Boolean);
                char.traits = parts.map(p => {
                  const pm = p.match(/(\S+)\s+(-?\d+)/);
                  return pm ? { name: pm[1], level: parseInt(pm[2]) } : { name: p, level: 1 };
                });
              } else if ((tm = cl.match(/^ancillaries\s+(.+)/i))) {
                char.ancillaries = tm[1].split(',').map(s => s.trim()).filter(Boolean);
              } else if (/^army$/i.test(cl)) {
                // parse units until next non-unit line
                i++;
                while (i < lines.length) {
                  const ul = cleanLine(lines[i]);
                  if (!ul) { i++; break; }
                  if (!/^unit\b/i.test(ul)) break;
                  // unit <name> exp N armour N weapon_lvl N
                  const um = ul.match(/^unit\s+(.+?)\s+exp\s+(\d+)\s+armour\s+(\d+)\s+weapon_lvl\s+(\d+)/i);
                  if (um) char.army.push({ unit: um[1].trim(), exp: parseInt(um[2]), armour: parseInt(um[3]), weaponLvl: parseInt(um[4]) });
                  i++;
                }
                continue;
              }
              i++;
            }
            faction.characters.push(char);
            items.push(char);
            continue;
          }
        }

        // character_record
        if ((fm = fl.match(/^character_record\s+(.+?),\s*(male|female)\s*,\s*age\s+(\d+)\s*,\s*(dead\s+\d+|never_a_leader|past_leader|leader|heir|\w+)/i))) {
          const statusRaw = fm[4].trim();
          const deadMatch = statusRaw.match(/^dead\s+(\d+)/i);
          faction.characterRecords.push({
            name: fm[1].trim(), sex: fm[2], age: parseInt(fm[3]),
            status: deadMatch ? 'dead' : statusRaw,
            deadYears: deadMatch ? parseInt(deadMatch[1]) : 0,
          });
          i++; continue;
        }

        // relative
        if (/^relative\s+/i.test(fl)) {
          // relative\tWilliam,\tMatilda,\t\tRufus,\t...end
          const parts = fl.replace(/^relative\s+/i, '').split(/[\t,]+/).map(s => s.trim()).filter(Boolean);
          const endIdx = parts.indexOf('end');
          const rel = endIdx >= 0 ? parts.slice(0, endIdx) : parts;
          faction.relatives.push(rel);
          i++; continue;
        }

        i++;
      }

      factions.push(faction);
      continue;
    }

    // Diplomacy: faction_standings
    if ((m = line.match(/^(faction_standings)\s+(\w+)\s*,\s*([-\d.]+)\s+([\w\s,]+)/i))) {
      const targets = m[4].split(',').map(s => s.trim()).filter(Boolean);
      // Preserve the original value string to avoid 0.20 → 0.2 rounding
      factionStandings.push({ faction: m[2], value: parseFloat(m[3]), valueStr: m[3], targets });
      i++; continue;
    }

    // Diplomacy: action_relationships / faction_relationships
    if ((m = line.match(/^(action_relationships|faction_relationships)\s+(\w+)\s*,\s*(\w+)\s+([\w\s,]+)/i))) {
      const targets = m[4].split(',').map(s => s.trim()).filter(Boolean);
      factionRelationships.push({ faction: m[2], relation: m[3], targets });
      i++; continue;
    }

    // Regions section (forts/watchtowers)
    if ((m = line.match(/^region\s+(\S+)/i))) {
      // just skip the region header, parse forts and watchtowers inside
      i++;
      while (i < lines.length) {
        const rl = cleanLine(lines[i]);
        if (!rl) { i++; continue; }
        if (/^region\s+/i.test(rl) || /^(faction_standings|faction_relationships|action_relationships|script)/i.test(rl)) break;

        let wm;
        if ((wm = rl.match(/^(watchtower)\s+(\d+)\s+(\d+)/i))) {
          items.push({ id: itemId++, category: 'fortification', type: 'watchtower', x: parseInt(wm[2]), y: parseInt(wm[3]), region: m[1], _lineNum: i });
        } else if ((wm = rl.match(/^(fort)\s+(\d+)\s+(\d+)(.*)/i))) {
          const rest = wm[4].trim();
          const fortTypem = rest.match(/(\S+_fort\S*)/i);
          const culturem = rest.match(/culture\s+(\S+)/i);
          items.push({
            id: itemId++, category: 'fortification', type: 'fort',
            x: parseInt(wm[2]), y: parseInt(wm[3]),
            fortType: fortTypem?.[1] || '',
            culture: culturem?.[1] || '',
            region: m[1], _lineNum: i,
          });
        }
        i++;
      }
      continue;
    }

    i++;
  }

  return {
    raw: text, items, factions, factionStandings, factionRelationships,
    campaignName, playable, unlockable, nonplayable,
    startDate, endDate, timescale, scriptFile, flags,
  };
}

// ─── Settlement position computation ─────────────────────────────────────────
export function computeSettlementPositions(settlements, regionsData, regionsLayer) {
  if (!settlements?.length || !regionsData?.length || !regionsLayer?.data) return settlements;
  const { data, width, height } = regionsLayer;

  // Build a set of known region colors for quick lookup
  const knownColors = new Set();
  const colorMap = {};
  for (const reg of regionsData) {
    if (reg.regionName) {
      colorMap[reg.regionName.toLowerCase()] = { r: reg.r, g: reg.g, b: reg.b };
      knownColors.add(`${reg.r},${reg.g},${reg.b}`);
    }
  }

  const nearestRegionColor = (px, py) => {
    let fallback = null;
    for (let radius = 1; radius <= 4; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          const nr = data[ni], ng = data[ni+1], nb = data[ni+2];
          if (nr < 5 && ng < 5 && nb < 5) continue;
          if (nr > 245 && ng > 245 && nb > 245) continue;
          const key = `${nr},${ng},${nb}`;
          if (knownColors.has(key)) return key;
          if (!fallback) fallback = key;
        }
      }
    }
    return fallback;
  };

  // For each black pixel, find the nearest region color. Some large RTW maps
  // separate city markers from fill colors with border/road pixels, so a small
  // search radius is more reliable than only checking the four direct neighbors.
  const cityPx = {};
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;
      if (data[idx] > 5 || data[idx+1] > 5 || data[idx+2] > 5) continue;

      const bestKey = nearestRegionColor(px, py);
      if (bestKey && !cityPx[bestKey]) {
        cityPx[bestKey] = { x: px, y: height - 1 - py };
      }
    }
  }

  return settlements.map(s => {
    const color = colorMap[s.region?.toLowerCase()];
    if (!color) return s;
    const pos = cityPx[`${color.r},${color.g},${color.b}`];
    return pos ? { ...s, x: pos.x, y: pos.y } : s;
  });
}

// ─── Serializer ───────────────────────────────────────────────────────────────
function generateSettlementBlock(s, indent = '') {
  const ind2 = indent + '\t';
  const ind3 = indent + '\t\t';
  // NOTE: opening brace is on the SAME line as settlement to avoid any stray
  // lines being inserted between "settlement" and "{" during splice operations.
  const lines = [
    `${indent}settlement`,
    `${indent}{`,
    `${ind2}level ${s.level}`,
    `${ind2}region ${s.region}`,
    ``,
    `${ind2}year_founded ${s.yearFounded ?? 0}`,
    `${ind2}population ${s.population ?? 0}`,
    `${ind2}plan_set ${s.planSet || 'default_set'}`,
    `${ind2}faction_creator ${s.factionCreator || s.faction}`,
    ...(s.buildings || []).flatMap(b => [`${ind2}building`, `${ind2}{`, `${ind3}type ${b}`, `${ind2}}`]),
    `${indent}}`,
  ];
  return lines;
}

function generateFactionHeader(faction) {
  let line = `faction\t${faction.name}`;
  if (faction.economicAI && faction.militaryAI) line += `, ${faction.economicAI} ${faction.militaryAI}`;
  if (faction.shadowing) line += `, shadowing ${faction.shadowing}`;
  if (faction.shadowedBy) line += `, shadowed_by ${faction.shadowedBy}`;
  return line;
}

function generateFactionStubBlock(faction) {
  const lines = [
    generateFactionHeader(faction),
    `\tai_label\t${faction.aiLabel || 'default'}`,
  ];
  if (faction.deadUntilResurrected) lines.push('\tdead_until_resurrected');
  if (faction.deadUntilEmerged) lines.push('\tdead_until_emerged');
  if (faction.reEmergent) lines.push('\tre_emergent');
  if (faction.undiscovered) lines.push('\tundiscovered');
  lines.push(`\tdenari\t${faction.treasury || 0}`);
  lines.push(`\tdenari_kings_purse\t${faction.kingsPurse || 0}`);
  return lines;
}

function findTopLevelPostFactionIndex(lines) {
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const fl = lines[i].replace(/;.*$/, '').trim();
    if (braceDepth === 0 && /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl)) return i;
    if (braceDepth === 0 && /^region\s+\S/i.test(fl)) return i;
    if (braceDepth === 0 && /^script\s*$/i.test(fl)) return i;
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
  }
  return lines.length;
}

export function serializeDescrStrat(stratData, overlayItems, editedSettlements = {}) {
  if (!stratData?.raw) return '';
  const lines = stratData.raw.split('\n');
  const replacements = [];

  // ── Patch global campaign settings ──────────────────────────────────────
  const pl = (regex, newLine) => {
    const idx = lines.findIndex(l => regex.test(l.replace(/;.*$/, '').trim()));
    if (idx >= 0) lines[idx] = newLine;
  };
  if (stratData.campaignName) pl(/^campaign\b/i, `campaign\t\t${stratData.campaignName}`);
  if (stratData.startDate)    pl(/^start_date\b/i, `start_date\t${stratData.startDate}`);
  if (stratData.endDate)      pl(/^end_date\b/i, `end_date\t${stratData.endDate}`);
  if (stratData.timescale)    pl(/^timescale\b/i, `timescale\t${stratData.timescale}`);
  if (stratData.scriptFile) {
    const si = lines.findIndex(l => /^script\s*$/.test(l.replace(/;.*$/, '').trim()));
    if (si >= 0 && si + 1 < lines.length) lines[si + 1] = stratData.scriptFile;
  }
  // Boolean flags
  const BOOL_FLAGS = ['marian_reforms_disabled','marian_reforms_activated','rebelling_characters_active','rebelling_characters_inactive','gladiator_uprising_disabled','night_battles_enabled','night_battles_disabled','show_date_as_turns'];
  for (const key of BOOL_FLAGS) {
    const enabled = stratData.flags?.[key] === true;
    const idx = lines.findIndex(l => l.replace(/;.*$/, '').trim() === key);
    if (!enabled && idx >= 0) lines[idx] = `; ${key}`;
  }
  if (stratData.flags?.brigand_spawn_value !== undefined)
    pl(/^brigand_spawn_value\b/i, `brigand_spawn_value ${stratData.flags.brigand_spawn_value}`);
  if (stratData.flags?.pirate_spawn_value !== undefined)
    pl(/^pirate_spawn_value\b/i, `pirate_spawn_value ${stratData.flags.pirate_spawn_value}`);
  // Playable / unlockable / nonplayable blocks
  const repBlock = (keyword, values) => {
    if (!values) return;
    const si = lines.findIndex(l => l.replace(/;.*$/, '').trim().toLowerCase() === keyword);
    if (si < 0) return;
    const ei = lines.findIndex((l, i) => i > si && l.replace(/;.*$/, '').trim().toLowerCase() === 'end');
    if (ei < 0) return;
    lines.splice(si, ei - si + 1, keyword, ...values.map(v => `\t${v}`), 'end');
  };
  repBlock('playable', stratData.playable);
  repBlock('unlockable', stratData.unlockable);
  repBlock('nonplayable', stratData.nonplayable);

  // ── Patch faction blocks (ai_label, denari, treasury, dead flags) ──────────
  if (stratData.factions?.length) {
    const patchedFactionNames = new Set();
    for (const faction of stratData.factions) {
      // Find the faction line in the file
      const factionLineIdx = lines.findIndex(l => {
        const cl = l.replace(/;.*$/, '').trim();
        return cl === `faction ${faction.name}` ||
          cl.startsWith(`faction ${faction.name},`) ||
          cl.startsWith(`faction ${faction.name} `);
      });
      if (factionLineIdx < 0) continue;
      patchedFactionNames.add(faction.name);

      // Find end of this faction block
      let factionEnd = lines.length;
      for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
        const fl = lines[fi].replace(/;.*$/, '').trim();
        if (!fl) continue;
        if (
          /^faction\s+\w/i.test(fl) ||
          /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl) ||
          /^region\s+\S/i.test(fl) ||
          /^script\s*$/i.test(fl)
        ) { factionEnd = fi; break; }
      }

      // Rewrite faction header line with correct economicAI/militaryAI
      lines[factionLineIdx] = generateFactionHeader(faction);

      // Patch or add ai_label
      const aiIdx = lines.findIndex((l, i) => i > factionLineIdx && i < factionEnd && /^\s*ai_label\b/i.test(l.replace(/;.*$/, '')));
      const aiLine = `\tai_label\t${faction.aiLabel || 'default'}`;
      if (aiIdx >= 0) lines[aiIdx] = aiLine;
      else lines.splice(factionLineIdx + 1, 0, aiLine);

      // Refind factionEnd after potential splice
      factionEnd = lines.length;
      for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
        const fl = lines[fi].replace(/;.*$/, '').trim();
        if (!fl) continue;
        if (
          /^faction\s+\w/i.test(fl) ||
          /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl) ||
          /^region\s+\S/i.test(fl) ||
          /^script\s*$/i.test(fl)
        ) { factionEnd = fi; break; }
      }

      // Remove/add dead flags
      const deadFlags = ['dead_until_resurrected','dead_until_emerged','re_emergent','undiscovered'];
      for (const flag of deadFlags) {
        const idx = lines.findIndex((l, i) => i > factionLineIdx && i < factionEnd && l.replace(/;.*$/, '').trim() === flag);
        if (idx >= 0) lines.splice(idx, 1);
      }
      // Refind factionEnd
      factionEnd = lines.length;
      for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
        const fl = lines[fi].replace(/;.*$/, '').trim();
        if (!fl) continue;
        if (/^faction\s+\w/i.test(fl)||/^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl)||/^region\s+\S/i.test(fl)||/^script\s*$/i.test(fl)) { factionEnd = fi; break; }
      }
      // Insert new dead flags after ai_label line
      const insertFlagAfter = lines.findIndex((l, i) => i > factionLineIdx && i < factionEnd && /^\s*ai_label\b/i.test(l.replace(/;.*$/, '')));
      const flagsToInsert = [];
      if (faction.deadUntilResurrected) flagsToInsert.push('\tdead_until_resurrected');
      if (faction.deadUntilEmerged) flagsToInsert.push('\tdead_until_emerged');
      if (faction.reEmergent) flagsToInsert.push('\tre_emergent');
      if (faction.undiscovered) flagsToInsert.push('\tundiscovered');
      if (flagsToInsert.length && insertFlagAfter >= 0) {
        lines.splice(insertFlagAfter + 1, 0, ...flagsToInsert);
      }

      // Refind factionEnd
      factionEnd = lines.length;
      for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
        const fl = lines[fi].replace(/;.*$/, '').trim();
        if (!fl) continue;
        if (/^faction\s+\w/i.test(fl)||/^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl)||/^region\s+\S/i.test(fl)||/^script\s*$/i.test(fl)) { factionEnd = fi; break; }
      }

      // Patch denari
      const denariIdx = lines.findIndex((l, i) => i > factionLineIdx && i < factionEnd && /^\s*denari\b(?!_kings)/i.test(l.replace(/;.*$/, '')));
      const denariLine = `\tdenari\t${faction.treasury || 0}`;
      if (denariIdx >= 0) lines[denariIdx] = denariLine;

      // Patch denari_kings_purse
      const kpIdx = lines.findIndex((l, i) => i > factionLineIdx && i < factionEnd && /^\s*denari_kings_purse\b/i.test(l.replace(/;.*$/, '')));
      const kpLine = `\tdenari_kings_purse\t${faction.kingsPurse || 0}`;
      if (kpIdx >= 0) lines[kpIdx] = kpLine;

      // Rewrite relative lines if faction.relatives is defined (from family tree editor)
      if (faction.relatives !== undefined) {
        // Refind factionEnd
        factionEnd = lines.length;
        for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
          const fl = lines[fi].replace(/;.*$/, '').trim();
          if (!fl) continue;
          if (/^faction\s+\w/i.test(fl)||/^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl)||/^region\s+\S/i.test(fl)||/^script\s*$/i.test(fl)) { factionEnd = fi; break; }
        }
        // Remove all existing relative lines in this faction block
        for (let fi = factionEnd - 1; fi > factionLineIdx; fi--) {
          if (/^\s*relative\s+/i.test(lines[fi].replace(/;.*$/, ''))) {
            lines.splice(fi, 1);
            factionEnd--;
          }
        }
        // Insert new relative lines before factionEnd
        const relLines = (faction.relatives || [])
          .filter(rel => rel && rel.some(n => n))
          .map(rel => `\trelative\t${rel.join(',\t')}\tend`);
        if (relLines.length > 0) {
          lines.splice(factionEnd, 0, ...relLines);
        }
      }
    }

    const newFactions = stratData.factions.filter(f => f?.name && !patchedFactionNames.has(f.name));
    if (newFactions.length) {
      const insertIdx = findTopLevelPostFactionIndex(lines);
      const newLines = [];
      for (const faction of newFactions) {
        if (newLines.length && newLines[newLines.length - 1] !== '') newLines.push('');
        newLines.push(...generateFactionStubBlock(faction), '');
      }
      lines.splice(insertIdx, 0, ...newLines);
    }
  }

  // ── Patch diplomacy (faction_standings + faction_relationships) ────────────
  if (stratData.factionStandings?.length) {
    // Find the diplomacy section start
    const firstStandingsIdx = lines.findIndex(l => /^\s*faction_standings\b/i.test(l.replace(/;.*$/, '')));
    if (firstStandingsIdx >= 0) {
      // Find the end of standings block
      let endStandingsIdx = firstStandingsIdx;
      for (let fi = firstStandingsIdx; fi < lines.length; fi++) {
        const fl = lines[fi].replace(/;.*$/, '').trim();
        if (!fl || /^(faction_standings|faction_relationships|action_relationships)\b/i.test(fl)) {
          endStandingsIdx = fi;
        } else if (fl && !/^(faction_standings|faction_relationships|action_relationships)\b/i.test(fl)) {
          break;
        }
      }
      // Replace the whole diplomacy block
      const newDiploLines = [];
      for (const s of stratData.factionStandings) {
        // Use the original value string to preserve decimal precision (e.g. 0.20 not 0.2)
        const val = s.valueStr ?? String(s.value);
        // Keep multiple targets on one line, comma-separated, matching original format
        newDiploLines.push(`faction_standings\t${s.faction},\t\t${val}\t${s.targets.join(', ')}`);
      }
      for (const r of (stratData.factionRelationships || [])) {
        newDiploLines.push(`faction_relationships \t${r.faction}, ${r.relation}\t${r.targets.join(', ')}`);
      }
      lines.splice(firstStandingsIdx, endStandingsIdx - firstStandingsIdx + 1, ...newDiploLines);
    }
  }

  // ── Patch existing characters/resources/forts FIRST (before any splices that shift line numbers) ──
  for (const item of overlayItems) {
    if (item.id < 0) continue; // new items handled below
    const orig = stratData.items?.find(o => o.id === item.id);
    if (!orig) continue;

    if (item.category === 'character' && orig._lineNum !== undefined) {
      lines[orig._lineNum] = serializeCharLine(item);
    }

    if (item.category === 'resource' && orig._lineNum !== undefined && (orig.x !== item.x || orig.y !== item.y)) {
      const old = lines[orig._lineNum];
      if (old) lines[orig._lineNum] = old.replace(/,\s*\d+\s*,\s*\d+/, `,\t${item.x},\t${item.y}`);
    }

    if (item.category === 'fortification' && orig._lineNum !== undefined && (orig.x !== item.x || orig.y !== item.y)) {
      const old = lines[orig._lineNum];
      if (old) lines[orig._lineNum] = old.replace(/^(\s*(?:fort|watchtower))\s+\d+\s+\d+/, `$1 ${item.x} ${item.y}`);
    }
  }

  // origIds: IDs that existed in the ORIGINAL file (positive IDs from parsing).
  // New items added by the user have negative IDs (id: -(Date.now())).
  // We detect "new" items as those with negative IDs — they need to be appended.
  const origIds = new Set((stratData.items || []).filter(i => i.id >= 0).map(i => i.id));
  const newSettlements = overlayItems.filter(i => i.id < 0 && i.category === 'settlement');
  if (newSettlements.length > 0) {
    for (const s of newSettlements) {
      const factionName = s.faction || 'slave';
      // Find the faction block — handle both space and tab separators
      const factionLineIdx = lines.findIndex(l => {
        const cl = l.replace(/;.*$/, '').trim();
        // "faction <name>" or "faction <name>, ..." or "faction <name> ..."
        return /^faction[\s\t]+/.test(cl) && cl.replace(/^faction[\s\t]+/, '').split(/[\s\t,]/)[0] === factionName;
      });
      const block = generateSettlementBlock(s, '');
      if (factionLineIdx >= 0) {
        // Strategy: find the line index of the closing '}' of the LAST settlement
        // block inside this faction, then insert right after it.
        // If no settlement blocks exist, insert after the denari_kings_purse line
        // (or after the faction header line as a fallback).
        // We track brace depth to correctly find the end of each settlement block.
        let lastSettlementEndIdx = -1;
        let afterHeaderIdx = factionLineIdx; // fallback insertion point
        let braceDepth = 0;
        let insideSettlement = false;

        for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
          const raw = lines[fi];
          const fl = raw.replace(/;.*$/, '').trim();

          // Track brace depth
          for (const ch of raw) {
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;
          }

          // Outside any braces — check for top-level keywords
          if (braceDepth === 0) {
            // Record position of lines useful as fallback insertion (after header fields)
            if (/^denari_kings_purse\b/i.test(fl) || /^denari\b(?!_kings)/i.test(fl) || /^ai_label\b/i.test(fl)) {
              afterHeaderIdx = fi;
            }
            // A closing brace at depth 0 means we just closed a top-level block
            if (fl === '}') {
              lastSettlementEndIdx = fi;
            }
            // Hard stop: next faction, diplomacy section, region section, or script
            if (
              /^faction[\s\t]+\w/i.test(fl) ||
              /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl) ||
              /^region[\s\t]+\S/i.test(fl) ||
              /^script\s*$/i.test(fl)
            ) {
              break;
            }
            // Stop at first character-level keyword (characters come after settlements)
            // But only when NOT inside a brace block
            if (
              /^character[\s\t]+/i.test(fl) ||
              /^character_record\b/i.test(fl) ||
              /^relative\b/i.test(fl)
            ) {
              break;
            }
          }
        }

        // Determine insertion index: right after last settlement closing brace,
        // or after the last header field if no settlements found yet
        const insertIdx = lastSettlementEndIdx >= 0
          ? lastSettlementEndIdx + 1
          : afterHeaderIdx + 1;

        lines.splice(insertIdx, 0, '', ...block);
      } else {
        // No faction block found — append at end under a slave faction stub
        lines.push('', `faction\t${factionName}`, ...block);
      }
    }
  }

  // Append newly added characters (negative ID = user-created)
  // Only insert chars that have been confirmed (no _isNew flag)
  const newChars = overlayItems.filter(i => i.id < 0 && i.category === 'character' && !i._isNew);
  if (newChars.length > 0) {
    for (const char of newChars) {
      if (!char.name || !char.faction) continue;
      const factionName = char.faction;
      const factionLineIdx = lines.findIndex(l => {
        const cl = l.replace(/;.*$/, '').trim();
        return /^faction[\s\t]+/.test(cl) && cl.replace(/^faction[\s\t]+/, '').split(/[\s\t,]/)[0] === factionName;
      });

      // Build the block for this character
      const blockLines = [];
      if (char.comment) blockLines.push(`;;;;; ${char.comment}`);
      blockLines.push(serializeCharLine(char));
      if (char.charType !== 'family') {
        // M2TW correct indentation: no leading tabs on traits/ancillaries/army/unit
        if (char.traits?.length) blockLines.push(`traits\t${char.traits.map(t => `${t.name} ${t.level}`).join(' , ')}`);
        if (char.ancillaries?.length) blockLines.push(`ancillaries\t${char.ancillaries.join(', ')}`);
        if (char.army?.length) {
        blockLines.push('army');
        for (const u of char.army) {
          if (u.unit) blockLines.push(`unit\t\t${u.unit}\t\t\texp ${u.exp ?? 0} armour ${u.armour ?? 0} weapon_lvl ${u.weaponLvl ?? 0}`);
        }
        }
        blockLines.push(''); // blank line after character
      }

      if (factionLineIdx >= 0) {
        // family chars → insert after last character_record (or at factionEnd)
        // normal chars → insert before first character_record (or at factionEnd)
        const isFamily = char.charType === 'family';
        let firstRecordIdx = -1;
        let lastRecordIdx = -1;
        let braceDepth = 0;
        let factionEnd = lines.length;
        for (let fi = factionLineIdx + 1; fi < lines.length; fi++) {
          const raw = lines[fi];
          const fl = raw.replace(/;.*$/, '').trim();
          for (const ch of raw) { if (ch === '{') braceDepth++; else if (ch === '}') braceDepth--; }
          if (braceDepth > 0) continue;
          if (/^character_record\b/i.test(fl)) {
            if (firstRecordIdx < 0) firstRecordIdx = fi;
            lastRecordIdx = fi;
          }
          if (
            /^faction[\s\t]+\w/i.test(fl) ||
            /^(faction_standings|action_relationships|faction_relationships)\b/i.test(fl) ||
            /^region[\s\t]+\S/i.test(fl) ||
            /^script\s*$/i.test(fl)
          ) { factionEnd = fi; break; }
        }
        const insertIdx = isFamily
          ? (lastRecordIdx >= 0 ? lastRecordIdx + 1 : factionEnd)
          : (firstRecordIdx >= 0 ? firstRecordIdx : factionEnd);
        lines.splice(insertIdx, 0, ...blockLines);
      } else {
        lines.push('', `faction\t${factionName}`, ...blockLines);
      }
    }
  }

  // Append newly added forts (negative ID)
  const newForts = overlayItems.filter(i => i.id < 0 && i.category === 'fortification' && i.type === 'fort');
  if (newForts.length > 0) {
    for (const fort of newForts) {
      let line = `\tfort\t${fort.x} ${fort.y}`;
      if (fort.fortType) line += ` ${fort.fortType}`;
      if (fort.culture) line += ` culture ${fort.culture}`;
      if (fort.comment) line += `\t;;;;; ${fort.comment}`;
      lines.push(line);
    }
  }

  // Patch edited settlement blocks
  for (const [id, edits] of Object.entries(editedSettlements)) {
    const orig = stratData.items?.find(it => it.id == id && it.category === 'settlement');
    if (!orig || orig._lineStart === undefined) continue;
    const merged = { ...orig, ...edits };
    const indentMatch = (lines[orig._lineStart] || '').match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '\t';
    const newBlock = generateSettlementBlock(merged, indent);
    replacements.push({ start: orig._lineStart, end: orig._lineEnd, newLines: newBlock });
  }

  replacements.sort((a, b) => b.start - a.start);
  const result = [...lines];
  for (const { start, end, newLines } of replacements) {
    result.splice(start, end - start + 1, ...newLines);
  }

  return toCRLF(result.join('\n'));
}

// ─── descr_regions.txt ────────────────────────────────────────────────────────
// Format per block:
//   (province name)
//   (settlement name)
//   (faction creator)
//   (rebel faction)
//   R G B
//   resource1, resource2, ...  (may be blank)
//   triumph_points              (integer, default 5)
//   farm_level                  (integer, default 5)
//   religions { name val name val ... }  (M2TW, optional)
//   ...any extra mod data lines
export function parseDescrRegions(text) {
  const isRgbLine = (line) => !!line && /^\d+\s+\d+\s+\d+$/.test(line);
  const isIntLine = (line) => /^-?\d+$/.test(line || '');
  const hasResourcesLine = (lines, i) => (
    i + 7 < lines.length &&
    isRgbLine(lines[i + 4]) &&
    isIntLine(lines[i + 6]) &&
    isIntLine(lines[i + 7])
  );
  const hasOmittedResourcesLine = (lines, i) => (
    i + 6 < lines.length &&
    isRgbLine(lines[i + 4]) &&
    isIntLine(lines[i + 5]) &&
    isIntLine(lines[i + 6])
  );
  const isRegionStart = (lines, i) => hasResourcesLine(lines, i) || hasOmittedResourcesLine(lines, i);

  const parseRegionBlock = (block, omittedResources = false) => {
    const regionName     = block[0];
    const settlementName = block[1];
    const factionCreator = block[2];
    const rebelFaction   = block[3];
    const rgbParts       = block[4].split(/\s+/);
    const r = parseInt(rgbParts[0]) || 0;
    const g = parseInt(rgbParts[1]) || 0;
    const b = parseInt(rgbParts[2]) || 0;
    const resourcesLine  = omittedResources ? '' : (block[5] || '');
    const resources      = resourcesLine.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none');
    const val1           = parseInt(block[omittedResources ? 5 : 6]) || 0;
    const val2           = parseInt(block[omittedResources ? 6 : 7]) || 0;
    const religions      = {};
    const tail = [];
    let hasReligions = false;

    for (const line of block.slice(omittedResources ? 7 : 8)) {
      if (/^religions\b/i.test(line)) {
        hasReligions = true;
        tail.push({ kind: 'religions' });
        const relMatch = line.match(/religions\s*\{([^}]*)\}/i);
        if (relMatch) {
          const parts = relMatch[1].trim().split(/\s+/).filter(Boolean);
          for (let j = 0; j < parts.length; j += 2) {
            if (parts[j] && parts[j + 1] !== undefined) religions[parts[j]] = parseInt(parts[j + 1]);
          }
        }
      } else {
        tail.push({ kind: 'extra', value: line });
      }
    }

    const extraDataLines = tail.filter(t => t.kind === 'extra').map(t => t.value);
    return {
      regionName, settlementName, factionCreator, rebelFaction,
      r, g, b, resources, val1, val2, religions,
      extraDataLines,
      _regionTail: tail,
      _hasReligions: hasReligions,
    };
  };

  const lines = text
    .split(/\r?\n/)
    .map(l => l.replace(/;.*$/, '').trim())
    .filter(Boolean);
  const regions = [];

  let i = 0;
  while (i < lines.length) {
    if (!isRegionStart(lines, i)) { i++; continue; }
    const omittedResources = !hasResourcesLine(lines, i) && hasOmittedResourcesLine(lines, i);
    const baseLen = omittedResources ? 7 : 8;
    let next = i + baseLen;
    while (next < lines.length && !isRegionStart(lines, next)) next++;
    const parsed = parseRegionBlock(lines.slice(i, next), omittedResources);
    if (parsed) regions.push(parsed);
    i = next;
  }

  return regions;
}

// ─── Regions serializer ───────────────────────────────────────────────────────
export function serializeDescrRegions(regions, allReligions) {
  const includeReligions = regions.some(reg => reg._hasReligions || Object.keys(reg.religions || {}).length > 0);
  const religionLine = (reg) => {
    const relObj = reg.religions || {};
    const relEntries = allReligions?.length > 0
      ? allReligions.map(name => `${name} ${relObj[name] ?? 0}`).join(' ')
      : Object.entries(relObj).map(([k, v]) => `${k} ${v}`).join(' ');
    return relEntries ? `religions { ${relEntries} }` : 'religions {  }';
  };

  return toCRLF(regions.map(reg => {
    const resourcesLine = (reg.resources || []).filter(r => r && r.toLowerCase?.() !== 'none').length > 0 ? (reg.resources || []).join(', ') : 'none';
    const base = [
      reg.regionName,
      reg.settlementName,
      reg.factionCreator,
      reg.rebelFaction || 'slave',
      `${reg.r} ${reg.g} ${reg.b}`,
      resourcesLine,
      String(reg.val1 ?? 0),
      String(reg.val2 ?? 0),
    ];

    const tail = Array.isArray(reg._regionTail) && reg._regionTail.length > 0
      ? reg._regionTail
      : [
          ...(includeReligions ? [{ kind: 'religions' }] : []),
          ...(reg.extraDataLines || []).map(value => ({ kind: 'extra', value })),
        ];
    let emittedReligions = false;
    for (const part of tail) {
      if (part?.kind === 'religions') {
        if (includeReligions && !emittedReligions) {
          base.push(religionLine(reg));
          emittedReligions = true;
        }
      } else if (part?.kind === 'extra' && part.value) {
        base.push(part.value);
      }
    }
    if (includeReligions && !emittedReligions) base.push(religionLine(reg));
    return base.join('\n');
  }).join('\n\n'));
}

// ─── regions_and_settlement_names.txt ─────────────────────────────────────────
export function parseSettlementNames(text) {
  return parseTextLocFile(text);
}

// ─── descr_win_conditions.txt ─────────────────────────────────────────────────
// Format: faction_name\n  hold_regions ...\n  take_regions N\n  outlive ...\n  short_campaign ...
export function parseWinConditions(text) {
  const factions = {};
  const lines = text.split('\n');
  let current = null;
  let inShort = false;

  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;

    let m;
    // New faction entry: a line with a single word that is a faction name
    if (/^\w+$/.test(line) && !['hold_regions','take_regions','outlive','short_campaign'].includes(line)) {
      current = line;
      inShort = false;
      factions[current] = {
        holdRegions: [], takeRegions: 0, outlive: [],
        short: { holdRegions: [], takeRegions: 0, outlive: [] }
      };
      continue;
    }
    if (!current) continue;

    if (line === 'short_campaign') { inShort = true; continue; }

    if ((m = line.match(/^hold_regions\s*(.*)/))) {
      const regs = m[1].trim().split(/\s+/).filter(Boolean);
      if (inShort) factions[current].short.holdRegions = regs;
      else factions[current].holdRegions = regs;
    } else if ((m = line.match(/^take_regions\s+(\d+)/))) {
      if (inShort) factions[current].short.takeRegions = parseInt(m[1]);
      else factions[current].takeRegions = parseInt(m[1]);
    } else if ((m = line.match(/^outlive\s*(.*)/))) {
      const facs = m[1].trim().split(/\s+/).filter(Boolean);
      if (inShort) factions[current].short.outlive = facs;
      else factions[current].outlive = facs;
    }
  }
  return factions;
}

export function serializeWinConditions(winConditions) {
  const lines = [];
  for (const [faction, cond] of Object.entries(winConditions)) {
    lines.push(faction);
    lines.push(`hold_regions ${cond.holdRegions.join(' ')}`);
    lines.push(`take_regions ${cond.takeRegions}`);
    if (cond.outlive.length) lines.push(`outlive ${cond.outlive.join(' ')}`);
    else lines.push('outlive');
    lines.push('short_campaign hold_regions ' + (cond.short.holdRegions.join(' ')));
    lines.push(`take_regions ${cond.short.takeRegions}`);
    if (cond.short.outlive.length) lines.push(`outlive ${cond.short.outlive.join(' ')}`);
    else lines.push('outlive');
    lines.push('');
  }
  return toCRLF(lines.join('\n'));
}

// ─── descr_sm_factions.txt ───────────────────────────────────────────────────
export function parseDescrSmFactions(text) {
  const factions = {};
  let currentFaction = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^faction\s+(\w+)/))) { currentFaction = m[1]; factions[currentFaction] = {}; continue; }
    if (!currentFaction) continue;
    if ((m = line.match(/^primary_colour\s+red\s+(\d+),?\s*green\s+(\d+),?\s*blue\s+(\d+)/))) {
      factions[currentFaction].primaryColor = { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
    }
    if ((m = line.match(/^secondary_colour\s+red\s+(\d+),?\s*green\s+(\d+),?\s*blue\s+(\d+)/))) {
      factions[currentFaction].secondaryColor = { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
    }
    if ((m = line.match(/^tertiary_colour\s+red\s+(\d+),?\s*green\s+(\d+),?\s*blue\s+(\d+)/))) {
      factions[currentFaction].tertiaryColor = { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
    }
    if ((m = line.match(/^logo_filename\s+(.+)/))) {
      factions[currentFaction].logo = m[1].trim();
    }
  }
  return factions;
}
