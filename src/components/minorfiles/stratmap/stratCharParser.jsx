/**
 * Parser / serialiser for descr_character.txt and descr_model_strat.txt
 */

// ── descr_character.txt ──────────────────────────────────────────────────────

/**
 * Returns:
 * {
 *   globalActionPoints: number,
 *   types: [
 *     {
 *       type: string,
 *       actions: string,
 *       wageBase: number,
 *       startingActionPoints: number,
 *       factions: [{ faction, dictionary, stratModels: [string], battleModel, battleEquip }]
 *     }
 *   ]
 * }
 */
export function parseDescrCharacter(text) {
  const lines = text.split('\n');
  let globalActionPoints = 80;
  const types = [];
  let currentType = null;
  let currentFaction = null;

  function flushFaction() {
    if (currentFaction && currentType) {
      currentType.factions.push(currentFaction);
      currentFaction = null;
    }
  }
  function flushType() {
    flushFaction();
    if (currentType) types.push(currentType);
    currentType = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;

    const tokens = line.split(/\s+/);
    const key = tokens[0].toLowerCase();

    if (key === 'starting_action_points' && !currentType) {
      globalActionPoints = parseInt(tokens[1], 10) || 80;
      continue;
    }
    if (key === 'type' && tokens.slice(1).join(' ').trim()) {
      flushType();
      currentType = {
        type: tokens.slice(1).join(' ').trim(),
        actions: '',
        wageBase: 0,
        startingActionPoints: 80,
        factions: [],
      };
      continue;
    }
    if (!currentType) continue;

    if (key === 'actions') {
      currentType.actions = tokens.slice(1).join(' ').trim();
    } else if (key === 'wage_base') {
      currentType.wageBase = parseInt(tokens[1], 10) || 0;
    } else if (key === 'starting_action_points') {
      currentType.startingActionPoints = parseInt(tokens[1], 10) || 80;
    } else if (key === 'faction') {
      flushFaction();
      currentFaction = { faction: (tokens[1] || '').replace(/,+$/, ''), dictionary: '', stratModels: [], battleModel: '', battleEquip: '' };
    } else if (currentFaction) {
      if (key === 'dictionary') {
        currentFaction.dictionary = tokens[1] || '';
      } else if (key === 'strat_model') {
        currentFaction.stratModels.push(tokens[1]);
      } else if (key === 'battle_model') {
        currentFaction.battleModel = tokens.slice(1).join(' ').trim();
      } else if (key === 'battle_equip') {
        currentFaction.battleEquip = tokens.slice(1).join(' ').trim();
      }
    }
  }
  flushType();
  return { globalActionPoints, types };
}

export function serialiseDescrCharacter(data) {
  const lines = [];
  lines.push(`starting_action_points\t${data.globalActionPoints}\t\t; default value for all characters and pathfinding calculations`);
  lines.push('');
  for (const t of data.types) {
    lines.push(';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;');
    lines.push('');
    lines.push(`type\t\t\t${t.type}`);
    lines.push('');
    if (t.actions) lines.push(`actions\t\t\t${t.actions}`);
    lines.push(`wage_base\t\t${t.wageBase}`);
    lines.push(`starting_action_points\t${t.startingActionPoints}`);
    lines.push('');
    for (const f of t.factions) {
      lines.push(`faction\t\t\t${f.faction}`);
      lines.push(`dictionary\t\t${f.dictionary}`);
      for (const sm of f.stratModels) lines.push(`strat_model\t\t${sm}`);
      if (f.battleModel) lines.push(`battle_model\t${f.battleModel}`);
      if (f.battleEquip) lines.push(`battle_equip\t${f.battleEquip}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ── descr_model_strat.txt ────────────────────────────────────────────────────

/**
 * Returns:
 * [
 *   {
 *     name: string,
 *     skeleton: string,
 *     scale: string,
 *     indivRange: string,
 *     textures: [{ faction, path }],
 *     models: [{ keyword, path, range }],  // e.g. model_flexi_m, shadow_model_flexi
 *   }
 * ]
 */
export function parseDescrModelStrat(text) {
  const lines = text.split('\n');
  const models = [];
  let current = null;

  function flush() {
    if (current) { models.push(current); current = null; }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line || line === 'ignore_registry') continue;

    const tokens = line.split(/[ \t]+/);
    const key = tokens[0].toLowerCase();

    if (key === 'type') {
      flush();
      current = { name: tokens.slice(1).join(' ').trim(), skeleton: '', scale: '', indivRange: '', textures: [], models: [] };
      continue;
    }
    if (!current) continue;

    if (key === 'skeleton') {
      current.skeleton = tokens.slice(1).join(' ').trim();
    } else if (key === 'scale') {
      current.scale = tokens[1] || '';
    } else if (key === 'indiv_range') {
      current.indivRange = tokens[1] || '';
    } else if (key === 'texture') {
      // texture  faction, path
      const rest = tokens.slice(1).join(' ');
      const commaIdx = rest.indexOf(',');
      if (commaIdx !== -1) {
        current.textures.push({
          faction: rest.slice(0, commaIdx).trim(),
          path: rest.slice(commaIdx + 1).trim(),
        });
      }
    } else if (key.startsWith('model_') || key === 'shadow_model_flexi') {
      const rest = tokens.slice(1).join(' ');
      const commaIdx = rest.lastIndexOf(',');
      current.models.push({
        keyword: tokens[0],
        path: commaIdx !== -1 ? rest.slice(0, commaIdx).trim() : rest.trim(),
        range: commaIdx !== -1 ? rest.slice(commaIdx + 1).trim() : 'max',
      });
    }
  }
  flush();
  return models;
}

export function serialiseDescrModelStrat(models) {
  const lines = [];
  lines.push('ignore_registry');
  lines.push('');
  for (const m of models) {
    lines.push(`type\t\t\t\t${m.name}`);
    if (m.skeleton) lines.push(`skeleton\t\t\t${m.skeleton}`);
    if (m.scale) lines.push(`scale\t\t\t\t${m.scale}`);
    if (m.indivRange) lines.push(`indiv_range\t\t\t${m.indivRange}`);
    for (const t of m.textures) lines.push(`texture\t\t\t\t${t.faction}, ${t.path}`);
    for (const md of m.models) lines.push(`${md.keyword}\t\t\t${md.path}, ${md.range}`);
    lines.push('');
  }
  return lines.join('\n');
}