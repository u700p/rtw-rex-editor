/**
 * M2TW battle_models.modeldb parser & serializer
 *
 * The file is a text-based Boost serialization archive.
 * Header: "22 serialization::archive 3 0 0 0 0 <N> 0 0"
 *   where N = total number of entries.
 *
 * Each entry structure:
 *   <nameLen> <name>
 *   <scale>                          float or int (1 for infantry, 1.12 for horses)
 *   <lodCount>
 *   <pathLen> <path> <maxDist>       × lodCount   (paths may contain spaces)
 *   <mainFactionCount>
 *   for each mainFaction:
 *     <fLen> <faction>
 *     <texLen> <texture>
 *     <normLen> <normalTex>
 *     <sprLen>  <sprite>
 *   <attachFactionCount>
 *   for each attachFaction:
 *     <fLen> <faction>
 *     <texLen> <diffTex>
 *     <normLen> <normTex>
 *     0
 *   <mountTypeCount>
 *   for each mountType:
 *     <mtLen> <mountType>
 *     <psLen> <primarySkeleton>
 *     <ssLen> <secondarySkeleton>
 *     <primaryWeaponCount>
 *     <wLen> <weapon>  × primaryWeaponCount
 *     <secondaryWeaponCount>
 *     <wLen> <weapon>  × secondaryWeaponCount
 *   <torchBoneIndex>
 *   <tx> <ty> <tz> <rx> <ry> <rz>   6 floats
 *
 * NOTE: "0 0" first-time pads appear in the file but their position varies
 * across vanilla vs mod files. We handle them by detecting them around
 * count fields using a lookahead heuristic.
 */

import { toCRLF } from '@/lib/lineEndings';

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------
function makeReader(text) {
  const tokens = text.trim().split(/[ \t\r\n]+/).filter(Boolean);
  let pos = 0;

  return {
    peek:    ()  => tokens[pos],
    peekAt:  (n) => tokens[pos + n],
    getPos:  ()  => pos,
    setPos:  (p) => { pos = p; },
    tokens,
    readInt() {
      if (pos >= tokens.length) throw new Error(`EOF at pos ${pos} (readInt)`);
      const v = parseInt(tokens[pos++], 10);
      if (isNaN(v)) throw new Error(`Expected int, got "${tokens[pos-1]}" at pos ${pos-1}`);
      return v;
    },
    readFloat() {
      if (pos >= tokens.length) throw new Error(`EOF at pos ${pos} (readFloat)`);
      const v = parseFloat(tokens[pos++]);
      if (isNaN(v)) throw new Error(`Expected float, got "${tokens[pos-1]}" at pos ${pos-1}`);
      return v;
    },
    // Read a length-prefixed string. The length is the CHARACTER count,
    // but because M2TW paths/names never contain spaces in practice,
    // we just read the length then one token and trust the length field.
    // For paths with spaces we fall back to consuming multiple tokens.
    readStr() {
      const len = this.readInt();
      if (len === 0) return '';
      let str = tokens[pos++];
      while (str.length < len) {
        if (pos >= tokens.length) break;
        str += ' ' + tokens[pos++];
      }
      return str;
    },
    // Consume a "0 0" first-time pad if present at current position.
    // Returns true if consumed.
    tryReadPad() {
      if (pos + 1 < tokens.length && tokens[pos] === '0' && tokens[pos + 1] === '0') {
        pos += 2;
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
export function parseModeldb(text) {
  const r = makeReader(text);

  // Header: "22 serialization::archive 3 0 0 0 0 N 0 0"
  r.readStr();                                        // "serialization::archive"
  r.readInt(); r.readInt(); r.readInt(); r.readInt(); // 3 0 0 0
  r.readInt();                                        // 0
  const totalEntries = r.readInt();
  r.tryReadPad();                                     // trailing "0 0" on header

  const entries = [];

  function parseEntry() {
    const name = r.readStr();

    // Scale: float like "1.12" contains a dot; plain "1" is integer scale
    const scaleRaw = r.peek();
    let scale = 1;
    if (scaleRaw !== undefined) {
      if (scaleRaw.includes('.')) {
        scale = r.readFloat();
      } else {
        r.readInt(); // consume integer scale (always 1)
        scale = 1;
      }
    }

    // LODs — optional leading pad
    r.tryReadPad();
    const lodCount = r.readInt();
    r.tryReadPad();
    const meshes = [];
    for (let i = 0; i < lodCount; i++) {
      const path = r.readStr();
      const dist = r.readInt();
      meshes.push({ path, dist });
    }

    // Main factions — optional leading pad
    r.tryReadPad();
    const mainFactionCount = r.readInt();
    r.tryReadPad();
    const factions = [];
    for (let i = 0; i < mainFactionCount; i++) {
      const faction   = r.readStr();
      const texture   = r.readStr();
      const normalTex = r.readStr();
      const sprite    = r.readStr();
      factions.push({ faction, texture, normalTex, sprite });
    }

    // Attach factions
    r.tryReadPad();
    const attachCount = r.readInt();
    r.tryReadPad();
    const attachFactions = [];
    for (let i = 0; i < attachCount; i++) {
      const faction = r.readStr();
      const diffTex = r.readStr();
      const normTex = r.readStr();
      r.readInt(); // trailing 0
      attachFactions.push({ faction, diffTex, normTex });
    }

    // Mount types
    r.tryReadPad();
    const mountTypeCount = r.readInt();
    r.tryReadPad();
    const mountTypes = [];
    for (let i = 0; i < mountTypeCount; i++) {
      const mountType         = r.readStr();
      const primarySkeleton   = r.readStr();
      const secondarySkeleton = r.readStr();
      r.tryReadPad();
      const primaryWeaponCount = r.readInt();
      const primaryWeapons = [];
      for (let w = 0; w < primaryWeaponCount; w++) primaryWeapons.push(r.readStr());
      const secondaryWeaponCount = r.readInt();
      const secondaryWeapons = [];
      for (let w = 0; w < secondaryWeaponCount; w++) secondaryWeapons.push(r.readStr());
      mountTypes.push({ mountType, primarySkeleton, secondarySkeleton, primaryWeapons, secondaryWeapons });
    }

    // Torch
    r.tryReadPad();
    const torchBoneIndex = r.readInt();
    r.tryReadPad();
    const torchTx = r.readFloat();
    const torchTy = r.readFloat();
    const torchTz = r.readFloat();
    const torchRx = r.readFloat();
    const torchRy = r.readFloat();
    const torchRz = r.readFloat();

    return {
      name, scale, meshes, factions, attachFactions, mountTypes,
      torchBoneIndex,
      torch: [torchTx, torchTy, torchTz, torchRx, torchRy, torchRz],
    };
  }

  // Heuristic to skip to the start of the next valid entry after a parse error.
  // An entry starts with <nameLen> <name> where name matches /^[a-zA-Z]\w*$/.
  function findNextEntry(fromPos) {
    const tokens = r.tokens;
    for (let p = fromPos; p < tokens.length - 2; p++) {
      const len = parseInt(tokens[p], 10);
      if (isNaN(len) || len < 2 || len > 100) continue;
      const name = tokens[p + 1];
      if (!name || name.length !== len) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) continue;
      // Quick sanity: token after name should be a number (scale or int 1)
      const after = tokens[p + 2];
      if (!after || isNaN(parseFloat(after))) continue;
      return p;
    }
    return tokens.length;
  }

  for (let e = 0; e < totalEntries && r.getPos() < r.tokens.length - 3; e++) {
    const savedPos = r.getPos();
    try {
      entries.push(parseEntry());
    } catch (err) {
      console.warn(`modeldb: parse error at entry ${e} (pos ${savedPos}):`, err.message);
      const next = findNextEntry(savedPos + 1);
      if (next >= r.tokens.length - 3) break;
      r.setPos(next);
      // Don't increment e — retry this slot at the new position
      e--;
    }
  }

  // Build case-insensitive lookup
  const byName = {};
  for (const entry of entries) {
    byName[entry.name.toLowerCase()] = entry;
  }

  return { totalEntries, entries, byName };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------
function ws(s) { return `${s.length} ${s}`; }
function wf(f)  { return Number.isInteger(f) ? String(f) : String(f); }

function serializeEntry(entry) {
  const lines = [];

  lines.push(ws(entry.name));
  lines.push(wf(entry.scale ?? 1));

  // LODs
  lines.push(String(entry.meshes.length));
  for (const m of entry.meshes) {
    lines.push(`${m.path.length} ${m.path} ${m.dist}`);
  }

  // Main factions
  lines.push(String(entry.factions.length));
  for (const f of entry.factions) {
    lines.push(ws(f.faction));
    lines.push(ws(f.texture));
    lines.push(ws(f.normalTex));
    lines.push(ws(f.sprite));
  }

  // Attach factions
  const attachFactions = entry.attachFactions || [];
  lines.push(String(attachFactions.length));
  for (const f of attachFactions) {
    lines.push(ws(f.faction));
    lines.push(ws(f.diffTex));
    lines.push(ws(f.normTex));
    lines.push('0');
  }

  // Mount types
  const mountTypes = entry.mountTypes || [];
  lines.push(String(mountTypes.length));
  for (const mt of mountTypes) {
    lines.push(ws(mt.mountType));
    lines.push(ws(mt.primarySkeleton));
    lines.push(ws(mt.secondarySkeleton || ''));
    lines.push(String((mt.primaryWeapons || []).length));
    for (const w of (mt.primaryWeapons || [])) lines.push(ws(w));
    lines.push(String((mt.secondaryWeapons || []).length));
    for (const w of (mt.secondaryWeapons || [])) lines.push(ws(w));
  }

  // Torch
  lines.push(String(entry.torchBoneIndex ?? -1));
  const torch = entry.torch || [0, 0, 0, 0, 0, 0];
  lines.push(torch.map(wf).join(' '));

  return toCRLF(lines.join('\n'));
}

export function serializeModeldb(parsed) {
  const hdr = 'serialization::archive';
  const parts = [`${hdr.length} ${hdr} 3 0 0 0 0 ${parsed.entries.length} 0 0`];
  for (const entry of parsed.entries) parts.push(serializeEntry(entry));
  return toCRLF(parts.join('\n'));
}
