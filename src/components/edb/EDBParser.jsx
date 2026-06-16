// EDB Parser - parses export_descr_buildings.txt into structured data
import { parseTextLocFile, serializeTextLocFile } from '@/lib/textLocParser';

export const BUILDING_TRAITS = [
  'recruit_pool', 'wall_level', 'tower_level', 'gate_strength', 'gate_defences',
  'happiness_bonus', 'law_bonus', 'trade_base_income_bonus', 'trade_level_bonus',
  'trade_fleet', 'taxable_income_bonus', 'mine_resource', 'farming_level',
  'road_level', 'free_upkeep', 'armour', 'weapon_simple', 'weapon_bladed',
  'weapon_missile', 'weapon_siege', 'weapon_other', 'weapon_naval_gunpowder',
  'recruitment_slots', 'agent', 'agent_limit', 'population_health_bonus',
  'population_growth_bonus', 'stage_games', 'stage_races', 'construction_cost_bonus_military',
  'construction_cost_bonus_religious', 'construction_cost_bonus_defensive',
  'construction_cost_bonus_other', 'construction_time_bonus_military',
  'construction_time_bonus_religious', 'construction_time_bonus_defensive',
  'construction_time_bonus_other', 'religious_belief', 'religious_order',
  'archer_bonus', 'cavalry_bonus', 'heavy_cavalry_bonus', 'gun_bonus',
  'navy_bonus', 'religious_conversion', 'body_guard',
];

export const SETTLEMENT_TYPES = ['city', 'castle'];
export const SETTLEMENT_LEVELS = ['village', 'town', 'large_town', 'city', 'large_city', 'huge_city'];
export const MATERIALS = ['wooden', 'stone'];

export const CULTURES = [
  'northern_european', 'mesoamerican', 'middle_eastern',
  'eastern_european', 'greek', 'southern_european'
];

export const FACTIONS = [
  'england', 'scotland', 'france', 'hre', 'denmark', 'spain', 'portugal',
  'milan', 'venice', 'papal_states', 'sicily', 'poland', 'russia', 'hungary',
  'byzantium', 'moors', 'egypt', 'turks', 'mongols', 'timurids', 'aztecs',
  'Normans', 'Saxons'
];

export const HIDDEN_RESOURCES_DEFAULT = [
  'sparta', 'rome', 'italy', 'america', 'atlantic', 'explorers_guild',
  'swordsmiths_guild', 'woodsmens_guild', 'teutonic_knights_chapter_house',
  'knights_of_santiago_chapter_house', 'crusade', 'jihad', 'arguin',
  'horde_target', 'no_pirates', 'no_brigands'
];

function parseRequirements(reqStr) {
  // Parse requirement string like:
  // "factions { england, scotland, }  and event_counter gunpowder_discovered 1"
  if (!reqStr || !reqStr.trim()) return [];
  
  const conditions = [];
  let remaining = reqStr.trim();
  
  // Split on top-level "and" / "or" / "and not" outside braces
  const parts = [];
  let depth = 0;
  let current = '';
  const tokens = remaining.split(/\s+/);
  let i = 0;
  
  while (i < tokens.length) {
    const token = tokens[i];
    
    if (token === '{') {
      depth++;
      current += ' ' + token;
    } else if (token === '}') {
      depth--;
      current += ' ' + token;
    } else if (depth === 0 && (token === 'and' || token === 'or')) {
      if (current.trim()) {
        // Check if next token is "not"
        let connector = token;
        if (i + 1 < tokens.length && tokens[i + 1] === 'not') {
          connector = token + ' not';
          i++;
        }
        parts.push({ text: current.trim(), connector: null });
        current = '';
        parts[parts.length - 1].nextConnector = connector;
      }
    } else {
      current += ' ' + token;
    }
    i++;
  }
  if (current.trim()) {
    parts.push({ text: current.trim(), connector: null });
  }
  
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const text = part.text;
    // prevConnector = connector that precedes this condition
    const prevConn = pi > 0 ? (parts[pi - 1].nextConnector || null) : undefined;
    const cond = { connector: part.nextConnector || null, prevConnector: prevConn };
    
    if (text.startsWith('factions')) {
      const match = text.match(/factions\s*\{([^}]*)\}/);
      if (match) {
        cond.type = 'factions';
        cond.values = match[1].split(',').map(f => f.trim()).filter(Boolean);
      }
    } else if (text.startsWith('event_counter')) {
      const match = text.match(/event_counter\s+(\S+)\s+(\d+)/);
      if (match) {
        cond.type = 'event_counter';
        cond.event = match[1];
        cond.value = parseInt(match[2]);
      }
    } else if (text.startsWith('hidden_resource')) {
      const match = text.match(/hidden_resource\s+(\S+)/);
      if (match) {
        cond.type = 'hidden_resource';
        cond.resource = match[1];
      }
    } else if (text.startsWith('building_present')) {
      const match = text.match(/building_present(?:_min_level)?\s+(\S+)\s+(\S+)/);
      if (match) {
        cond.type = 'building_present_min_level';
        cond.building = match[1];
        cond.level = match[2];
      }
    } else if (text.startsWith('resource')) {
      const match = text.match(/resource\s+(\S+)/);
      if (match) {
        cond.type = 'resource';
        cond.resource = match[1];
      }
    } else if (text.startsWith('region_religion')) {
      const match = text.match(/region_religion\s+(\S+)\s+(\d+)/);
      if (match) {
        cond.type = 'region_religion';
        cond.religion = match[1];
        cond.percentage = parseInt(match[2]);
      }
    } else {
      cond.type = 'raw';
      cond.text = text;
    }
    
    conditions.push(cond);
  }
  
  return conditions;
}



function parseCapabilityLine(line) {
  line = line.trim();
  
  // recruit_pool parsing
  if (line.startsWith('recruit_pool')) {
    const match = line.match(/recruit_pool\s+"([^"]+)"\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+requires\s+(.*))?/);
    if (match) {
      return {
        type: 'recruit_pool',
        unitName: match[1],
        initialPool: parseFloat(match[2]),
        replenishRate: parseFloat(match[3]),
        maxPool: parseFloat(match[4]),
        experience: parseInt(match[5]),
        requirements: match[6] ? parseRequirements(match[6]) : []
      };
    }
  }
  
  // bonus-style capabilities: "identifier bonus N"
  const bonusMatch = line.match(/^(\S+)\s+bonus\s+([-\d.]+)/);
  if (bonusMatch) {
    const identifier = bonusMatch[1];
    return {
      type: 'bonus',
      identifier,
      needsBonus: true,
      value: parseFloat(bonusMatch[2]),
    };
  }
  
  // simple value capabilities: "identifier N"
  const simpleMatch = line.match(/^(\S+)\s+([-\d.]+)/);
  if (simpleMatch) {
    const identifier = simpleMatch[1];
    return {
      type: 'bonus',
      identifier,
      needsBonus: false,
      value: parseFloat(simpleMatch[2]),
    };
  }
  
  // agent-style: "agent merchant" or "agent merchant 0 requires factions { ... }" or "agent_limit merchant 1"
  if (line.startsWith('agent_limit')) {
    const parts = line.split(/\s+/);
    return { type: 'agent_limit', identifier: 'agent_limit', agentType: parts[1], value: parseInt(parts[2] || 1) };
  }
  if (line.startsWith('agent ')) {
    // Format: agent <type> [<value>] [requires ...]
    const reqIdx = line.search(/\brequires\b/);
    if (reqIdx !== -1) {
      const beforeReq = line.slice(0, reqIdx).trim().split(/\s+/);
      const agentType = beforeReq[1];
      const agentValue = beforeReq[2] !== undefined ? parseInt(beforeReq[2]) : undefined;
      const reqText = line.slice(reqIdx + 'requires'.length).trim();
      return { type: 'agent', identifier: 'agent', agentType, agentValue, requirements: parseRequirements(reqText) };
    }
    const parts = line.split(/\s+/);
    const agentType = parts[1];
    const agentValue = parts[2] !== undefined ? parseInt(parts[2]) : undefined;
    return { type: 'agent', identifier: 'agent', agentType, agentValue, requirements: [] };
  }
  
  // body_guard
  if (line.startsWith('body_guard')) {
    return { type: 'raw', text: line };
  }
  
  return { type: 'raw', text: line };
}

export function parseEDB(text) {
  const lines = text.split('\n');
  let hiddenResources = [];
  const buildings = [];
  let i = 0;
  
  // Skip comments and empty lines, find hidden_resources
  while (i < lines.length) {
    const rawLine = lines[i].trim();
    const line = rawLine.startsWith(';') ? '' : rawLine.split(';')[0].trim();
    if (line === '') { i++; continue; }
    if (line.startsWith('hidden_resources')) {
      // Strip inline comments before parsing
      const withoutComment = line.split(';')[0];
      hiddenResources = withoutComment.replace('hidden_resources', '').trim().split(/\s+/).filter(Boolean);
      i++;
      continue;
    }
    if (line.startsWith('building ')) {
      const building = parseBuilding(lines, i);
      buildings.push(building.data);
      i = building.nextIndex;
    } else {
      i++;
    }
  }
  
  return { hiddenResources, buildings };
}

function parseBuilding(lines, startIndex) {
  // Strip inline comment
  const headerLine = lines[startIndex].trim().split(';')[0].trim();
  const buildingName = headerLine.replace('building ', '').trim();
  
  const building = {
    name: buildingName,
    convertTo: null,
    levels: [],
    plugins: '',
    factionCapability: []
  };
  
  let i = startIndex + 1;
  // Skip to opening brace
  while (i < lines.length && lines[i].trim() !== '{') i++;
  i++; // skip {
  
  let braceDepth = 1;
  
  while (i < lines.length && braceDepth > 0) {
    let line = lines[i].trim();
    // Strip inline comments
    if (line.includes(';')) line = line.split(';')[0].trim();
    
    if (line === '}') {
      braceDepth--;
      if (braceDepth === 0) { i++; break; }
      i++; continue;
    }
    
    if (line.startsWith('convert_to ')) {
      building.convertTo = line.replace('convert_to ', '').trim();
      i++; continue;
    }
    
    if (line.startsWith('religion ')) {
      building.religion = line.replace('religion ', '').trim();
      i++; continue;
    }
    
    if (line.startsWith('levels ') || line === 'levels') {
      // Parse level names - they may span multiple lines before opening {
      const levelsPart = [];
      // line is already comment-stripped
      const firstTokens = line.replace(/^levels\s*/, '').trim().split(/\s+/);
      let brace_found = false;
      for (const t of firstTokens) {
        if (t === '{') { brace_found = true; break; }
        if (!t) continue;
        levelsPart.push(t);
      }
      i++;
      // If { not on levels line, collect more names from subsequent lines
      if (!brace_found) {
        while (i < lines.length) {
          const nline = lines[i].trim();
          if (nline === '' || nline.startsWith(';')) { i++; continue; }
          const tokens = nline.split(/\s+/);
          let lineBrace = false;
          for (const t of tokens) {
            if (t === '{') { lineBrace = true; break; }
            if (t.startsWith(';')) break;
            if (t) levelsPart.push(t);
          }
          i++;
          if (lineBrace) break;
        }
      }
      // i is now right after the opening {
      let levelDepth = 1;
      while (i < lines.length && levelDepth > 0) {
        const rawLLine = lines[i].trim();
        // Strip pure comment lines
        if (rawLLine.startsWith(';') || rawLLine === '') { i++; continue; }
        // Strip inline comments for structural matching
        const lLine = rawLLine.split(';')[0].trim();
        if (!lLine) { i++; continue; }
        if (lLine === '}') {
          levelDepth--;
          i++;
          continue;
        }
        if (lLine === '{') { levelDepth++; i++; continue; }
        // Format: level_name (city|castle) [requires ...]  OR just check first token against levelsPart
        const firstToken = lLine.split(/\s+/)[0];
        if (levelsPart.includes(firstToken)) {
          // extract settlement type and requires string
          const rest = lLine.slice(firstToken.length).trim();
          const stMatch = rest.match(/^(city|castle)(.*)/);
          const settlementType = stMatch ? stMatch[1] : null;
          const requiresStr = stMatch ? stMatch[2].trim() : rest;
          const level = parseLevelBlock(lines, i, firstToken, settlementType, requiresStr);
          building.levels.push(level.data);
          i = level.nextIndex;
        } else {
          i++;
        }
      }
      continue;
    }
    
    if (line.startsWith('plugins')) {
      // Skip plugins block
      while (i < lines.length && !lines[i].trim().startsWith('{')) i++;
      i++; // skip {
      let pluginDepth = 1;
      while (i < lines.length && pluginDepth > 0) {
        if (lines[i].trim() === '{') pluginDepth++;
        if (lines[i].trim() === '}') pluginDepth--;
        i++;
      }
      continue;
    }
    
    if (line.startsWith('faction_capability')) {
      // Parse faction_capability block
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('{')) i++;
      i++; // skip {
      let fcDepth = 1;
      while (i < lines.length && fcDepth > 0) {
        const fcLine = lines[i].trim();
        if (fcLine === '{') { fcDepth++; i++; continue; }
        if (fcLine === '}') { fcDepth--; i++; continue; }
        if (fcLine) {
          building.factionCapability.push(parseCapabilityLine(fcLine));
        }
        i++;
      }
      continue;
    }
    
    i++;
  }
  
  return { data: building, nextIndex: i };
}

function parseLevelBlock(lines, startIndex, levelName, settlementType, requiresStr) {
  const level = {
    name: levelName,
    settlementType: settlementType ?? null,
    requirements: [],
    convertTo: null,
    capabilities: [],
    factionCapability: [],
    material: 'wooden',
    construction: 1,
    cost: 0,
    settlementMin: 'village',
    upgrades: []
  };
  
  // Parse the requirements from the header line
  if (requiresStr) {
    let reqText = requiresStr.trim();
    if (reqText.startsWith('requires')) {
      reqText = reqText.replace(/^requires\s*/, '');
    }
    level.requirements = parseRequirements(reqText);
  }
  
  let i = startIndex + 1;
  // Find opening brace of this level block
  while (i < lines.length && lines[i].trim() !== '{') i++;
  i++; // skip {
  
  let depth = 1;
  let inCapability = false;
  let inFactionCapability = false;
  let inUpgrades = false;
  let capDepth = 0;
  
  while (i < lines.length && depth > 0) {
    // Strip single-; comments (but not inside requires clauses; those are handled in capability parsing)
    const rawLine = lines[i].trim();
    // For capability content lines we want to keep inline requires, so only strip trailing ;;+ comments
    // For structural keywords, strip everything after ;
    const line = rawLine.startsWith(';') ? '' : rawLine.split(';')[0].trim();
    
    if (line === '') { i++; continue; }
    
    if (line === '}') {
      if (inCapability) {
        capDepth--;
        if (capDepth === 0) inCapability = false;
        i++; continue;
      }
      if (inFactionCapability) {
        capDepth--;
        if (capDepth === 0) inFactionCapability = false;
        i++; continue;
      }
      if (inUpgrades) {
        inUpgrades = false;
        i++; continue;
      }
      depth--;
      i++; continue;
    }
    
    if (line === '{') {
      if (inCapability || inFactionCapability) { capDepth++; }
      else if (!inUpgrades) { depth++; }
      i++; continue;
    }
    
    if (inCapability) {
      // Use rawLine for capability content to preserve inline requires clauses
      const capLine = rawLine.replace(/\s*;;;.*$/, '').trim();
      if (capLine && !capLine.startsWith(';')) level.capabilities.push(parseCapabilityLine(capLine));
      i++; continue;
    }
    
    if (inFactionCapability) {
      const capLine = rawLine.replace(/\s*;;;.*$/, '').trim();
      if (capLine && !capLine.startsWith(';')) level.factionCapability.push(parseCapabilityLine(capLine));
      i++; continue;
    }
    
    if (inUpgrades) {
      if (line && line !== '{' && line !== '}') {
        // line may be: "civlib" or "civlib requires factions { ... } and not hidden_resource italy"
        const reqIdx = line.search(/\brequires\b/);
        if (reqIdx !== -1) {
          const levelName = line.slice(0, reqIdx).trim();
          const reqText = line.slice(reqIdx + 'requires'.length).trim();
          level.upgrades.push({ name: levelName, requirements: parseRequirements(reqText) });
        } else {
          level.upgrades.push(line);
        }
      }
      i++; continue;
    }
    
    if (line.startsWith('convert_to ')) {
      level.convertTo = line.replace('convert_to ', '').trim();
      i++; continue;
    }
    
    if (line === 'capability') {
      inCapability = true;
      // Find next {
      i++;
      while (i < lines.length && lines[i].trim() !== '{') i++;
      capDepth = 1;
      i++; continue;
    }
    
    if (line === 'faction_capability') {
      inFactionCapability = true;
      i++;
      while (i < lines.length && lines[i].trim() !== '{') i++;
      capDepth = 1;
      i++; continue;
    }
    
    if (line.startsWith('material ')) {
      level.material = line.replace('material ', '').trim();
      i++; continue;
    }
    
    if (line.startsWith('construction')) {
      const match = line.match(/construction\s+([\d.]+)/);
      if (match) level.construction = parseInt(match[1]);
      i++; continue;
    }
    
    if (line.startsWith('cost')) {
      const match = line.match(/cost\s+([\d.]+)/);
      if (match) level.cost = parseInt(match[1]);
      i++; continue;
    }
    
    if (line.startsWith('settlement_min')) {
      level.settlementMin = line.replace('settlement_min ', '').trim();
      i++; continue;
    }
    
    if (line === 'upgrades' || line.startsWith('upgrades')) {
      inUpgrades = true;
      if (!line.includes('{')) {
        i++;
        while (i < lines.length && lines[i].trim() !== '{') i++;
      }
      i++; continue;
    }
    
    i++;
  }
  
  return { data: level, nextIndex: i };
}

// Serialize back to EDB format
export function serializeEDB(edbData) {
  let output = ';This file is generated by the Rome / Medieval II Mod Editor\n\n\n\n\n';
  output += 'hidden_resources ' + edbData.hiddenResources.join(' ') + '\n\n';
  
  for (const building of edbData.buildings) {
    output += serializeBuilding(building);
  }
  
  return output;
}

export function serializeBuilding(building) {
  let out = `building ${building.name}\n{\n`;
  
  if (building.convertTo) {
    out += `    convert_to ${building.convertTo}\n`;
  }
  
  if (building.religion) {
    out += `    religion ${building.religion}\n`;
  }
  
  const levelNames = building.levels.map(l => l.name).join(' ');
  out += `    levels ${levelNames} \n    {\n`;
  
  for (const level of building.levels) {
    out += serializeLevel(level);
  }
  
  out += '    }\n';
  out += '    plugins \n    {\n    }\n';
  out += '}\n';
  
  return out;
}

function serializeRequirements(reqs) {
  if (!reqs || reqs.length === 0) return '';
  
  let out = '';
  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i];
    
    if (i > 0) {
      // Support both old 'connector' (on previous) and new 'prevConnector' (on current)
      const conn = req.prevConnector || reqs[i - 1].connector || 'and';
      out += ` ${conn} `;
    }
    
    if (req.type === 'factions') {
      out += `factions { ${req.values.join(', ')}, } `;
    } else if (req.type === 'event_counter') {
      out += `event_counter ${req.event} ${req.value} `;
    } else if (req.type === 'hidden_resource') {
      out += `hidden_resource ${req.resource}`;
    } else if (req.type === 'building_present_min_level') {
      out += `building_present_min_level ${req.building} ${req.level}`;
    } else if (req.type === 'resource') {
      out += `resource ${req.resource}`;
    } else if (req.type === 'region_religion') {
      out += `region_religion ${req.religion} ${req.percentage}`;
    } else if (req.type === 'raw') {
      out += req.text;
    }
  }
  
  return out;
}

function serializeLevel(level) {
  const reqSerialized = (level.requirements && level.requirements.length > 0)
    ? serializeRequirements(level.requirements)
    : '';
  
  const stPart = level.settlementType ? ` ${level.settlementType}` : '';
  // M2TW format uses two spaces before 'requires'
  const reqPart = reqSerialized ? `  requires ${reqSerialized}` : '';
  let out = `        ${level.name}${stPart}${reqPart}\n        {\n`;
  
  // Only emit convert_to if it was explicitly present in the source (not null/undefined/empty string)
  if (level.convertTo !== null && level.convertTo !== undefined && level.convertTo !== '') {
    out += `            convert_to ${level.convertTo}\n`;
  }
  
  out += '            capability\n            {\n';
  for (const cap of level.capabilities) {
    out += '                ' + serializeCapability(cap) + '\n';
  }
  out += '            }\n';
  
  if (level.factionCapability && level.factionCapability.length > 0) {
    out += '            faction_capability\n            {\n';
    for (const cap of level.factionCapability) {
      out += '                ' + serializeCapability(cap) + '\n';
    }
    out += '            }\n';
  }
  
  out += `            material ${level.material}\n`;
  out += `            construction  ${level.construction} \n`;
  out += `            cost  ${level.cost} \n`;
  out += `            settlement_min ${level.settlementMin}\n`;
  out += '            upgrades\n            {\n';
  for (const up of level.upgrades) {
    if (typeof up === 'string') {
      out += `                ${up}\n`;
    } else if (up.requirements && up.requirements.length > 0) {
      out += `                ${up.name} requires ${serializeRequirements(up.requirements)}\n`;
    } else {
      out += `                ${up.name}\n`;
    }
  }
  out += '            }\n';
  out += '        }\n';
  
  return out;
}

function serializeCapability(cap) {
  if (cap.type === 'recruit_pool') {
    let line = `recruit_pool "${cap.unitName}"  ${cap.initialPool}   ${cap.replenishRate}   ${cap.maxPool}  ${cap.experience}`;
    if (cap.requirements && cap.requirements.length > 0) {
      line += '  requires ' + serializeRequirements(cap.requirements);
    }
    return line;
  }
  
  if (cap.type === 'bonus') {
    return cap.needsBonus
      ? `${cap.identifier} bonus ${cap.value}`
      : `${cap.identifier} ${cap.value}`;
  }
  
  if (cap.type === 'agent') {
    let line = `agent ${cap.agentType}`;
    if (cap.agentValue !== undefined) line += `  ${cap.agentValue}`;
    if (cap.requirements && cap.requirements.length > 0) {
      line += `  requires ${serializeRequirements(cap.requirements)}`;
    }
    return line;
  }
  
  if (cap.type === 'agent_limit') {
    return `agent_limit ${cap.agentType} ${cap.value}`;
  }
  
  return cap.text || '';
}

// Create a new building with defaults
export function createDefaultBuilding(name) {
  return {
    name: name || 'new_building',
    convertTo: null,
    levels: [{
      name: name ? name + '_1' : 'new_level_1',
      settlementType: 'city',
      requirements: [{ type: 'factions', values: ['northern_european', 'southern_european'], connector: null }],
      convertTo: null,
      capabilities: [
        { type: 'bonus', identifier: 'happiness_bonus', needsBonus: true, value: 1 }
      ],
      factionCapability: [],
      material: 'wooden',
      construction: 2,
      cost: 600,
      settlementMin: 'village',
      upgrades: []
    }],
    plugins: '',
    factionCapability: []
  };
}

// ─── Reference File Parsers ───────────────────────────────────────────────

export function parseFactionsFile(text) {
  const factions = [];
  const cultures = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const facMatch = trimmed.match(/^faction\s+(\w+)/);
    if (facMatch) factions.push(facMatch[1]);
    const culMatch = trimmed.match(/^culture\s+(\w+)/);
    if (culMatch) cultures.add(culMatch[1]);
  }
  return { factions: factions.length ? factions : null, cultures: cultures.size ? [...cultures] : null };
}

export function parseResourcesFile(text) {
  const resources = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;
    const match = trimmed.match(/^resource\s+(\S+)/);
    if (match) resources.push(match[1]);
  }
  return resources;
}

export function parseEventsFromCampaign(text) {
  const events = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;
    // descr_event.txt format: "event  event_counter  name  initial_value"
    const match = trimmed.match(/^event\s+event_counter\s+(\S+)/i);
    if (match) events.add(match[1]);
    // Also handle plain event_counter lines
    const match2 = trimmed.match(/^event_counter\s+(\S+)/i);
    if (match2) events.add(match2[1]);
  }
  return [...events];
}

export function parseEventsFile(text) {
  const events = new Set();
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^event_counter\s+(\w+)/);
    if (match) events.add(match[1]);
  }
  return [...events];
}

export function parseUnitsFile(text) {
  const units = [];
  let currentType = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;
    const typeMatch = trimmed.match(/^type\s+(.+)/);
    if (typeMatch) { currentType = typeMatch[1].trim(); }
    const dictMatch = trimmed.match(/^dictionary\s+(\S+)/);
    if (dictMatch && currentType) {
      units.push({ type: currentType, dictionary: dictMatch[1] });
      currentType = null;
    }
  }
  return units;
}

// ─── export_buildings.txt Parser & Serializer ────────────────────────────────

/**
 * Parses export_buildings.txt into a flat key→value map.
 * Format: {key}value  (one entry per line, value is everything after the closing brace)
 * Also handles the UCS/UTF-16 BOM that M2TW sometimes uses.
 */
export function parseTextFile(text) {
  return parseTextLocFile(text);
}

/**
 * Serializes the key→value map back into export_buildings.txt format.
 */
export function serializeTextFile(textData) {
  return serializeTextLocFile(textData, { header: 'Generated by Mylae RTW/M2TW Mod Editor' });
}

// ─── Building Image Path Parser ────────────────────────────────────────────────

/**
 * Parses a TGA file path/name to extract culture, level name, and image type.
 * Returns { culture, levelName, type, key } or null if not a building UI image.
 *
 * Expected M2TW paths:
 *   data\ui\[culture]\buildings\constructed\#[culture]_[level].tga   → type = 'icon'
 *   data\ui\[culture]\buildings\#[culture]_[level].tga               → type = 'panel'
 *   data\ui\[culture]\buildings\#[culture]_[level]_constructed.tga   → type = 'construction'
 *
 * Key format: `${levelName}_${culture}_${type}`
 */
export function parseBuildingImageKey(filePath, fileName) {
  const pathLower = (filePath || fileName).toLowerCase().replace(/\\/g, '/');
  // Extract the folder immediately before 'buildings/'
  const buildingMatch = pathLower.match(/([a-z_]+)\/buildings\//);
  if (!buildingMatch) return null;
  const culture = buildingMatch[1];
  if (culture === 'buildings') return null; // bad match
  const nameLower = fileName.toLowerCase().replace(/\.tga$/i, '');
  const inConstructedDir = pathLower.includes('/buildings/constructed/');
  const hasConstructedSuffix = nameLower.endsWith('_constructed');
  const nameWithoutHash = nameLower.replace(/^#/, '');
  const prefix = culture + '_';
  // Allow files that don't carry the culture prefix (e.g. plain "civlib.tga")
  const afterCulture = nameWithoutHash.startsWith(prefix)
    ? nameWithoutHash.slice(prefix.length)
    : nameWithoutHash;
  let levelName, type;
  if (inConstructedDir) {
    type = 'icon';
    levelName = afterCulture;
  } else if (hasConstructedSuffix) {
    type = 'construction';
    levelName = afterCulture.replace(/_constructed$/, '');
  } else {
    type = 'panel';
    levelName = afterCulture;
  }
  return { culture, levelName, type, key: `${levelName}_${culture}_${type}` };
}

// Create a new level with defaults
export function createDefaultLevel(baseName, index) {
  return {
    name: baseName + '_' + (index + 1),
    settlementType: 'city',
    requirements: [{ type: 'factions', values: ['northern_european', 'southern_european'], connector: null }],
    convertTo: null,
    capabilities: [],
    factionCapability: [],
    material: 'wooden',
    construction: 2,
    cost: 600,
    settlementMin: 'village',
    upgrades: []
  };
}
