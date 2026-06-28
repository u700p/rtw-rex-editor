const MOUNT_MAP = {
  'light horse': 'horse_light',
  'medium horse': 'horse_medium',
  'heavy horse': 'horse_heavy',
  'generals horse': 'generals_horse',
};

export function parseFactionTargets(text) {
  return String(text || '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function splitEduBlocks(text) {
  const blocks = [];
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const matches = [...normalized.matchAll(/^type\s+(.+)$/gim)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    blocks.push(normalized.slice(start, end));
  }
  return blocks;
}

function parseEduModels(eduText, factions) {
  const modelsByFaction = Object.fromEntries(factions.map(f => [f, new Set()]));
  const unitsByFaction = Object.fromEntries(factions.map(f => [f, []]));

  for (const block of splitEduBlocks(eduText)) {
    const type = block.match(/^type\s+(.+)$/im)?.[1]?.trim() || '';
    const ownershipLine = block.match(/^ownership\s+(.+)$/im)?.[1] || '';
    if (!ownershipLine) continue;
    const owners = ownershipLine.split(/[,\s]+/).map(part => part.trim()).filter(Boolean);

    const refs = [];
    const soldier = block.match(/^soldier\s+([^,\n]+)/im)?.[1]?.trim();
    if (soldier) refs.push(soldier);
    for (const match of block.matchAll(/^officer\s+([^,\n]+)/gim)) {
      const officer = match[1]?.trim();
      if (officer) refs.push(officer);
    }
    const mount = block.match(/^mount\s+([^,\n]+)/im)?.[1]?.trim();
    if (mount) refs.push(MOUNT_MAP[mount.toLowerCase()] || mount);

    for (const faction of factions) {
      if (!owners.includes(faction)) continue;
      unitsByFaction[faction].push(type);
      refs.forEach(ref => modelsByFaction[faction].add(ref));
    }
  }

  return { modelsByFaction, unitsByFaction };
}

function splitDmbBlocks(text) {
  const matches = [...String(text || '').matchAll(/^type\s+.*$/gim)];
  return matches.map((match, index) => ({
    start: match.index,
    end: index + 1 < matches.length ? matches[index + 1].index : text.length,
    block: text.slice(match.index, index + 1 < matches.length ? matches[index + 1].index : text.length),
  }));
}

function dmbTypeName(block) {
  return String(block || '').match(/^type\s+(.+)$/im)?.[1]?.trim() || '';
}

function parseTextureLine(line) {
  const match = String(line || '').match(/^(\s*texture\s+)(.+)$/i);
  if (!match) return null;
  const parts = match[2].trim().split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    prefix: match[1],
    factions: parts.slice(0, -1),
    path: parts[parts.length - 1],
  };
}

export function patchDmbSlaveTextures(dmbText, eduText, factionsInput) {
  const factions = Array.isArray(factionsInput) ? factionsInput : parseFactionTargets(factionsInput);
  const { modelsByFaction, unitsByFaction } = parseEduModels(eduText, factions);

  const wanted = {};
  for (const [faction, models] of Object.entries(modelsByFaction)) {
    for (const model of models) {
      wanted[model] = wanted[model] || new Set();
      wanted[model].add(faction);
    }
  }

  const blocks = splitDmbBlocks(dmbText);
  const foundTypes = new Set(blocks.map(({ block }) => dmbTypeName(block)).filter(Boolean));
  const missingTypes = Object.keys(wanted).filter(type => !foundTypes.has(type)).sort();

  const out = [];
  const changes = [];
  let pos = 0;

  for (const { start, end, block } of blocks) {
    out.push(dmbText.slice(pos, start));
    pos = end;

    const typeName = dmbTypeName(block);
    const targetFactions = typeName && wanted[typeName]
      ? [...wanted[typeName]].sort((a, b) => factions.indexOf(a) - factions.indexOf(b))
      : [];
    if (!targetFactions.length) {
      out.push(block);
      continue;
    }

    const lines = block.split(/(?<=\n)/);
    const textureInfos = [];
    const existingFactions = new Set();
    lines.forEach((line, index) => {
      const parsed = parseTextureLine(line.replace(/\r?\n$/, ''));
      if (!parsed) return;
      parsed.factions.forEach(faction => existingFactions.add(faction));
      textureInfos.push({ ...parsed, index, raw: line.replace(/\r?\n$/, '') });
    });

    const source = textureInfos.find(info => info.factions.length === 1 && info.factions[0] === 'slave')
      || textureInfos.find(info => info.factions.includes('slave'));
    if (!source) {
      out.push(block);
      continue;
    }

    const newline = lines[source.index].endsWith('\r\n') ? '\r\n' : lines[source.index].endsWith('\n') ? '\n' : '';
    const newLines = [];
    const added = [];
    for (const faction of targetFactions) {
      if (existingFactions.has(faction)) continue;
      newLines.push(`${source.prefix}${faction}, ${source.path}${newline}`);
      added.push(faction);
    }

    if (newLines.length) {
      lines.splice(source.index + 1, 0, ...newLines);
      changes.push({ typeName, source: source.raw.trim(), added });
    }
    out.push(lines.join(''));
  }

  out.push(dmbText.slice(pos));

  const logLines = [
    'DMB slave texture duplication patch',
    `Targets: ${factions.join(', ')}`,
    '',
  ];
  for (const faction of factions) {
    logLines.push(`${faction}: ${(unitsByFaction[faction] || []).length} EDU units, ${(modelsByFaction[faction] || new Set()).size} DMB model refs`);
    logLines.push(`  Units: ${(unitsByFaction[faction] || []).join(', ')}`);
    logLines.push(`  Models: ${[...(modelsByFaction[faction] || new Set())].sort().join(', ')}`);
    logLines.push('');
  }
  logLines.push(`Changed DMB blocks: ${changes.length}`);
  for (const change of changes) {
    logLines.push(`${change.typeName}: added ${change.added.join(', ')} from [${change.source}]`);
  }
  if (missingTypes.length) {
    logLines.push('', 'Missing DMB type refs from EDU/mount map:');
    missingTypes.forEach(type => logLines.push(`  ${type}`));
  }

  return {
    text: out.join(''),
    log: `${logLines.join('\n')}\n`,
    changes,
    missingTypes,
    modelsByFaction,
    unitsByFaction,
  };
}
