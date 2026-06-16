import { SETTLEMENT_TYPES, MATERIALS, SETTLEMENT_LEVELS } from './EDBParser';

export function validateEDB(edbData) {
  if (!edbData) return [];
  const issues = [];
  const buildingNames = new Set(edbData.buildings.map(b => b.name));
  const seen = new Set();
  const allLevelNames = new Set();
  edbData.buildings.forEach(b => b.levels.forEach(l => allLevelNames.add(l.name)));

  for (const building of edbData.buildings) {
    const bn = building.name;

    if (seen.has(bn)) {
      issues.push({ severity: 'error', building: bn, message: 'Duplicate building name' });
    }
    seen.add(bn);

    if (building.levels.length === 0) {
      issues.push({ severity: 'error', building: bn, message: 'No levels defined' });
      continue;
    }

    if (bn.startsWith('guild_') && building.levels.length > 3) {
      issues.push({ severity: 'warning', building: bn, message: `Guild has ${building.levels.length} levels (vanilla max is 3)` });
    }

    if (building.levels.length >= 9) {
      issues.push({ severity: 'warning', building: bn, message: `${building.levels.length} levels — vanilla Rome limit is 9.` });
    }

    if (building.levels.length > 50) {
      issues.push({ severity: 'warning', building: bn, message: `${building.levels.length} levels — far beyond vanilla Rome limits.` });
    }

    if (building.convertTo && !buildingNames.has(building.convertTo)) {
      issues.push({ severity: 'warning', building: bn, message: `convert_to "${building.convertTo}" not found in EDB` });
    }

    const levelNames = new Set(building.levels.map(l => l.name));

    // Check for orphaned levels (not reachable from any upgrade chain)
    // A level is "root" if no other level upgrades to it
    const targetedByUpgrade = new Set();
    for (const level of building.levels) {
      for (const up of (level.upgrades || [])) targetedByUpgrade.add(typeof up === 'object' ? up?.name : up);
    }
    const roots = building.levels.filter(l => !targetedByUpgrade.has(l.name));
    if (roots.length > 1) {
      issues.push({ severity: 'warning', building: bn, message: `Multiple root levels (${roots.map(r=>r.name).join(', ')}) — possible disconnected upgrade tree` });
    }

    for (const level of building.levels) {
      const ln = level.name;
      if (!SETTLEMENT_TYPES.includes(level.settlementType)) {
        issues.push({ severity: 'error', building: bn, level: ln, message: `Invalid settlement type: "${level.settlementType}"` });
      }
      if (!MATERIALS.includes(level.material)) {
        issues.push({ severity: 'warning', building: bn, level: ln, message: `Unknown material: "${level.material}"` });
      }
      if (!SETTLEMENT_LEVELS.includes(level.settlementMin)) {
        issues.push({ severity: 'warning', building: bn, level: ln, message: `Unknown settlement_min: "${level.settlementMin}"` });
      }
      if (level.cost === 0) {
        issues.push({ severity: 'info', building: bn, level: ln, message: `Cost is 0 — intentional?` });
      }
      for (const up of (level.upgrades || [])) {
        const upName = typeof up === 'object' ? up?.name : up;
        if (!levelNames.has(upName)) {
          issues.push({ severity: 'error', building: bn, level: ln, message: `Upgrade "${upName}" not found in this building` });
        }
      }
      // Level convert_to must be a number (index into the paired building tree)
      if (level.convertTo !== null && level.convertTo !== undefined && level.convertTo !== '') {
        if (isNaN(Number(level.convertTo))) {
          issues.push({ severity: 'warning', building: bn, level: ln, message: `convert_to "${level.convertTo}" should be a numeric index (0-based position in the target building)` });
        }
      }
      for (const cap of (level.capabilities || [])) {
        if (cap.type === 'recruit_pool' && !cap.unitName) {
          issues.push({ severity: 'error', building: bn, level: ln, message: 'Recruit pool entry has no unit name' });
        }
      }
    }
  }

  return issues;
}
