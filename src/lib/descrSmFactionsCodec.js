/**
 * Parser and serializer for M2TW descr_sm_factions.txt
 *
 * Format – each faction block:
 *
 *   faction <name>
 *   {
 *       culture                    <value>
 *       religion                   <value>
 *       symbol                     <path>
 *       rebel_symbol               <path>
 *       primary_colour             { red <r> green <g> blue <b> }
 *       secondary_colour           { red <r> green <g> blue <b> }
 *       loading_logo               <path>
 *       standard_index             <int>
 *       logo_index                 <int>
 *       small_logo_index           <int>
 *       triumph_value              <int>
 *       custom_battle_availability <yes|no>
 *       can_sap                    <yes|no>
 *       prefer_naval_invasions     <yes|no>
 *       has_princess               <yes|no>
 *       can_have_princess          <yes|no>
 *       ai_label                   <value>
 *       economic_ai                <value>
 *       military_ai                <value>
 *       cai_*                      <float>   (zero or more CAI tuning lines)
 *   }
 *
 * Semicolons begin line comments; braces may be on the same line as "faction".
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const SM_CULTURES = [
  'northern_european', 'middle_eastern', 'eastern_european',
  'greek', 'southern_european', 'mesoamerican', 'eastern',
];

export const SM_RELIGIONS = [
  'catholic', 'orthodox', 'islam', 'pagan',
];

export const SM_AI_LABELS = [
  'aggressive', 'balanced', 'defensive', 'trader', 'religious',
];

export const SM_ECONOMIC_AI = [
  'balanced', 'religious', 'trader', 'comfortable', 'bureaucrat',
  'craftsman', 'sailor', 'fortified',
];

export const SM_MILITARY_AI = [
  'smith', 'mao', 'genghis', 'stalin', 'napoleon', 'henry', 'caesar',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseColour(str) {
  // Accepts: "{ red 225 green 0 blue 0 }" or "red 225 green 0 blue 0"
  const s = str.replace(/[{}]/g, '');
  const r = s.match(/red\s+(\d+)/i);
  const g = s.match(/green\s+(\d+)/i);
  const b = s.match(/blue\s+(\d+)/i);
  return {
    r: r ? parseInt(r[1], 10) : 0,
    g: g ? parseInt(g[1], 10) : 0,
    b: b ? parseInt(b[1], 10) : 0,
  };
}

function serializeColour(c) {
  return `{ red ${c.r} green ${c.g} blue ${c.b} }`;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

function parseFactionBlock(lines, startIndex) {
  const nameLine = lines[startIndex].replace(/;.*$/, '').trim();
  const nameMatch = nameLine.match(/^faction\s+(\S+)/i);
  if (!nameMatch) return null;

  const faction = {
    name: nameMatch[1],
    culture: '',
    religion: '',
    symbol: '',
    rebel_symbol: '',
    primary_colour: { r: 0, g: 0, b: 0 },
    secondary_colour: { r: 0, g: 0, b: 0 },
    loading_logo: '',
    standard_index: 0,
    logo_index: 0,
    small_logo_index: 0,
    triumph_value: 5,
    custom_battle_availability: false,
    can_sap: false,
    prefer_naval_invasions: false,
    has_princess: false,
    can_have_princess: false,
    ai_label: '',
    economic_ai: 'balanced',
    military_ai: 'napoleon',
    _cai: {},    // cai_* key → raw value string
    _extra: [],  // verbatim unknown lines
  };

  let i = startIndex + 1;

  // Advance to opening brace
  while (i < lines.length) {
    const l = lines[i].replace(/;.*$/, '').trim();
    if (l.includes('{')) { i++; break; }
    i++;
  }

  // Parse until matching closing brace
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/;.*$/, '').trim();

    if (line === '}') {
      return { faction, endIndex: i + 1 };
    }

    if (!line) { i++; continue; }

    const spIdx = line.search(/\s/);
    const key  = (spIdx >= 0 ? line.slice(0, spIdx) : line).toLowerCase();
    const rest = spIdx >= 0 ? line.slice(spIdx + 1).trim() : '';
    const yesNo = (s) => s.toLowerCase() === 'yes';

    switch (key) {
      case 'culture':                    faction.culture = rest; break;
      case 'religion':                   faction.religion = rest; break;
      case 'symbol':                     faction.symbol = rest; break;
      case 'rebel_symbol':               faction.rebel_symbol = rest; break;
      case 'primary_colour':
      case 'primary_color':              faction.primary_colour = parseColour(rest); break;
      case 'secondary_colour':
      case 'secondary_color':            faction.secondary_colour = parseColour(rest); break;
      case 'loading_logo':               faction.loading_logo = rest; break;
      case 'standard_index':             faction.standard_index = parseInt(rest, 10) || 0; break;
      case 'logo_index':                 faction.logo_index = parseInt(rest, 10) || 0; break;
      case 'small_logo_index':           faction.small_logo_index = parseInt(rest, 10) || 0; break;
      case 'triumph_value':              faction.triumph_value = parseInt(rest, 10) || 5; break;
      case 'custom_battle_availability': faction.custom_battle_availability = yesNo(rest); break;
      case 'can_sap':                    faction.can_sap = yesNo(rest); break;
      case 'prefer_naval_invasions':     faction.prefer_naval_invasions = yesNo(rest); break;
      case 'has_princess':               faction.has_princess = yesNo(rest); break;
      case 'can_have_princess':          faction.can_have_princess = yesNo(rest); break;
      case 'ai_label':                   faction.ai_label = rest; break;
      case 'economic_ai':                faction.economic_ai = rest; break;
      case 'military_ai':                faction.military_ai = rest; break;
      default:
        if (key.startsWith('cai_')) {
          faction._cai[key] = rest;
        } else {
          faction._extra.push(raw);
        }
    }

    i++;
  }

  // Reached EOF without closing brace
  return { faction, endIndex: i };
}

export function parseDescrSmFactions(text) {
  const factions = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].replace(/;.*$/, '').trim();
    if (/^faction\s+\S+/i.test(line)) {
      const result = parseFactionBlock(lines, i);
      if (result) {
        factions.push(result.faction);
        i = result.endIndex;
        continue;
      }
    }
    i++;
  }

  return factions;
}

// ─── Serializer ──────────────────────────────────────────────────────────────

export function serializeDescrSmFactions(factions) {
  return factions.map(f => {
    const lines = [`faction ${f.name}`, '{'];
    const add = (k, v) => lines.push(`\t${k.padEnd(34)}${v}`);

    if (f.culture)       add('culture',      f.culture);
    if (f.religion)      add('religion',     f.religion);
    if (f.symbol)        add('symbol',       f.symbol);
    if (f.rebel_symbol)  add('rebel_symbol', f.rebel_symbol);
    add('primary_colour',   serializeColour(f.primary_colour   || { r: 0, g: 0, b: 0 }));
    add('secondary_colour', serializeColour(f.secondary_colour || { r: 0, g: 0, b: 0 }));
    if (f.loading_logo)     add('loading_logo',               f.loading_logo);
    add('standard_index',   String(f.standard_index  ?? 0));
    add('logo_index',       String(f.logo_index       ?? 0));
    add('small_logo_index', String(f.small_logo_index ?? 0));
    add('triumph_value',    String(f.triumph_value    ?? 5));
    add('custom_battle_availability', f.custom_battle_availability ? 'yes' : 'no');
    add('can_sap',                    f.can_sap                    ? 'yes' : 'no');
    add('prefer_naval_invasions',     f.prefer_naval_invasions     ? 'yes' : 'no');
    add('has_princess',               f.has_princess               ? 'yes' : 'no');
    add('can_have_princess',          f.can_have_princess          ? 'yes' : 'no');
    if (f.ai_label)     add('ai_label',     f.ai_label);
    if (f.economic_ai)  add('economic_ai',  f.economic_ai);
    if (f.military_ai)  add('military_ai',  f.military_ai);

    for (const [k, v] of Object.entries(f._cai || {})) add(k, String(v));
    for (const ex of (f._extra || []))                  lines.push(ex);

    lines.push('}');
    return lines.join('\n');
  }).join('\n\n');
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDefaultSmFaction(name = 'new_faction') {
  return {
    name,
    culture:  'northern_european',
    religion: 'catholic',
    symbol:        'models_strat/symbol_northern_european.cas',
    rebel_symbol:  'models_strat/rebel_symbol_northern_european.cas',
    primary_colour:   { r: 128, g: 128, b: 128 },
    secondary_colour: { r: 255, g: 255, b: 255 },
    loading_logo: '',
    standard_index:   0,
    logo_index:       0,
    small_logo_index: 0,
    triumph_value:    5,
    custom_battle_availability: false,
    can_sap:                    false,
    prefer_naval_invasions:     false,
    has_princess:               false,
    can_have_princess:          false,
    ai_label:     'aggressive',
    economic_ai:  'balanced',
    military_ai:  'napoleon',
    _cai: {
      cai_aggressive_expansion_modifier:        '0.0',
      cai_at_war_aggression_modifier:           '0.0',
      cai_garrison_modifier:                    '1.0',
      cai_personal_security_modifier:           '1.0',
      cai_building_contribution_to_target_size: '1.0',
      cai_trade_contribution_to_target_size:    '1.0',
      cai_population_contribution_to_target_size:'1.0',
      cai_treasury_at_start_turns_income:       '4',
      cai_war_declaration_chance_modifier:      '1.0',
      cai_alliance_accept_chance_modifier:      '1.0',
    },
    _extra: [],
  };
}
