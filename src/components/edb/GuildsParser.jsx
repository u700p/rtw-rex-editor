/**
 * Parser and serializer for export_descr_guilds.txt (M2TW)
 *
 * Real file format:
 *
 *   ;------------------------------------------
 *   Guild assassins_guild
 *       building guild_assassins_guild
 *       levels  100 250 500
 *
 *   ;------------------------------------------
 *   Trigger 0010_Recruit_Assassin
 *       WhenToTest AgentCreated
 *
 *       Condition TrainedAgentType = assassin
 *
 *       Guild assassins_guild s  10
 *       Guild assassins_muslim_guild s  10
 *
 * Guild definition blocks and Trigger blocks are both top-level, separated by
 * ";---" comment lines. Inside a Trigger block, "Guild <name> <scope> <amount>"
 * lines define which guilds receive points (NOT GuildPointsEffect).
 *
 * Returns: { guilds: [...], triggers: [...] }
 */

import { toCRLF } from '@/lib/lineEndings';

function stripComment(line) {
  const sc = line.indexOf(';');
  return sc >= 0 ? line.slice(0, sc) : line;
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseGuildsFile(text) {
  const lines = text.split('\n');
  const guilds = [];
  const triggers = [];

  let i = 0;

  while (i < lines.length) {
    const clean = stripComment(lines[i]).trim();
    if (!clean) { i++; continue; }

    const tokens = clean.split(/\s+/);
    const key = tokens[0].toLowerCase();

    // ── Guild definition block ────────────────────────────────────────────────
    if (key === 'guild' && tokens.length === 2) {
      // Top-level "Guild <name>" with only the name on the line = definition block
      // (as opposed to "Guild <name> <scope> <amount>" inside a trigger = effect line)
      const guild = {
        name: tokens[1] || '',
        buildingTree: '',
        pointThresholds: [],
        settlementMinLevel: '',
        factionSupport: [],
        rawLines: [],
      };
      i++;

      while (i < lines.length) {
        const innerClean = stripComment(lines[i]).trim();
        if (!innerClean) { i++; continue; }

        const innerTokens = innerClean.split(/\s+/);
        const innerKey = innerTokens[0].toLowerCase();

        // A new top-level "Guild <name>" (2 tokens) or "Trigger" = end of this block
        if (innerKey === 'trigger') break;
        if (innerKey === 'guild' && innerTokens.length === 2) break;

        if (innerKey === 'building') {
          guild.buildingTree = innerTokens[1] || '';
        } else if (innerKey === 'levels') {
          guild.pointThresholds = innerTokens.slice(1).map(Number).filter(n => !isNaN(n));
        } else if (innerKey === 'settlementminlevel') {
          guild.settlementMinLevel = innerTokens[1] || '';
        } else if (innerKey === 'factionsupport') {
          const pairs = innerTokens.slice(1);
          for (let p = 0; p + 1 < pairs.length; p += 2) {
            guild.factionSupport.push({ faction: pairs[p], value: parseInt(pairs[p + 1]) || 0 });
          }
        } else {
          guild.rawLines.push({ key: innerTokens[0], value: innerTokens.slice(1).join(' ') });
        }
        i++;
      }

      guilds.push(guild);

    // ── Trigger block ─────────────────────────────────────────────────────────
    } else if (key === 'trigger') {
      const trigger = {
        name: tokens[1] || '',
        whenToTest: '',
        conditions: [],
        pointsEffects: [], // { building (guild name), scope, amount }
      };
      i++;

      while (i < lines.length) {
        const innerClean = stripComment(lines[i]).trim();
        if (!innerClean) { i++; continue; }

        const innerTokens = innerClean.split(/\s+/);
        const innerKey = innerTokens[0].toLowerCase();

        // Next top-level block starts
        if (innerKey === 'trigger') break;
        if (innerKey === 'guild' && innerTokens.length === 2) break;

        if (innerKey === 'whentotest') {
          trigger.whenToTest = innerTokens[1] || '';
        } else if (innerKey === 'condition' || innerKey === 'and' || innerKey === 'or') {
          trigger.conditions.push(innerClean);
        } else if (innerKey === 'guild' && innerTokens.length >= 4) {
          // "Guild <guildName> <scope> <amount>" — point effect line inside trigger
          trigger.pointsEffects.push({
            building: innerTokens[1] || '',
            scope: innerTokens[2] || 'o',
            amount: parseInt(innerTokens[3]) || 0,
          });
        }
        i++;
      }

      triggers.push(trigger);

    } else {
      i++;
    }
  }

  return { guilds, triggers };
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeTrigger(trigger) {
  const lines = [];
  lines.push(`Trigger ${trigger.name}`);
  lines.push(`    WhenToTest ${trigger.whenToTest}`);
  lines.push('');
  for (const cond of trigger.conditions) {
    lines.push(`    ${cond}`);
  }
  if (trigger.conditions.length > 0) lines.push('');
  for (const eff of trigger.pointsEffects) {
    lines.push(`    Guild ${eff.building} ${eff.scope}  ${eff.amount}`);
  }
  return toCRLF(lines.join('\n'));
}

export function serializeGuildsFile(data) {
  // Support both { guilds, triggers } and legacy plain array
  const guilds = Array.isArray(data) ? data : (data.guilds || []);
  const triggers = Array.isArray(data) ? [] : (data.triggers || []);

  const separator = ';------------------------------------------';
  const out = [];

  for (const guild of guilds) {
    out.push(separator);
    out.push(`Guild ${guild.name}`);
    if (guild.buildingTree) out.push(`    building ${guild.buildingTree}`);
    if (guild.pointThresholds?.length) out.push(`    levels  ${guild.pointThresholds.join(' ')}`);
    if (guild.settlementMinLevel) out.push(`    SettlementMinLevel  ${guild.settlementMinLevel}`);
    if (guild.factionSupport?.length) {
      const pairs = guild.factionSupport.map(f => `${f.faction} ${f.value}`).join('  ');
      out.push(`    FactionSupport      ${pairs}`);
    }
    for (const raw of guild.rawLines || []) {
      out.push(`    ${raw.key}${raw.value ? '  ' + raw.value : ''}`);
    }
    out.push('');
  }

  for (const trigger of triggers) {
    out.push(separator);
    out.push(serializeTrigger(trigger));
    out.push('');
  }

  return toCRLF(out.join('\n'));
}

export function getGuildBuildingPrefix(guildBuildingTree) {
  return guildBuildingTree;
}
