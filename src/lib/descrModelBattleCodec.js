/**
 * Parser and serializer for M2TW descr_model_battle.txt
 *
 * Format – each unit entry begins with "type <name>" and ends at the next
 * "type" keyword or EOF.  Semicolons start line comments.
 *
 * Recognised keywords per entry:
 *   type           <unit-type-name>
 *   skeleton       <animation-set>
 *   skeleton_horse <animation-set>           (optional)
 *   scale          <float>                   (optional, default 1.0)
 *   indiv_range    <int>                     (optional, default 40)
 *   texture        <faction>, <path>         (repeatable)
 *   pbr            <faction>, <normal>, <metalness>  (optional, repeatable)
 *   model_flexi_m  <path> <dist>             (optional, repeatable)
 *   model_flexi_c  <path> <dist>             (optional, repeatable)
 *   model_flexi    <path> <dist>             (optional, repeatable)
 *   model_stat     <path> <dist>             (optional, repeatable)
 *   model_sprite   <path> <dist>             (optional, repeatable)
 *   model_tri      <count>, <f1>, <f2>       (optional)
 *
 * Unknown / unrecognised lines are preserved verbatim in _extra[].
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

function splitPathDist(rest) {
  // Split "<path/to/file.cas> <dist>" where dist is the last whitespace token.
  const lsp = rest.lastIndexOf(' ');
  if (lsp < 0) return { path: rest.trim(), dist: 'max' };
  return { path: rest.slice(0, lsp).trim(), dist: rest.slice(lsp + 1).trim() };
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseDescrModelBattle(text) {
  const entries = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/;.*$/, '').trim();

    if (!line) continue;

    const spIdx = line.search(/\s/);
    const key  = (spIdx >= 0 ? line.slice(0, spIdx) : line).toLowerCase();
    const rest = spIdx >= 0 ? line.slice(spIdx + 1).trim() : '';

    if (key === 'type') {
      if (current) entries.push(current);
      current = {
        type: rest,
        skeleton: '',
        skeleton_horse: '',
        scale: 1.0,
        indiv_range: 40,
        textures: [],       // [{ faction, path }]
        pbr: [],            // [{ faction, normal, metalness }]
        model_flexi_m: [],  // [{ path, dist }]
        model_flexi_c: [],  // [{ path, dist }]
        model_flexi: [],    // [{ path, dist }]
        model_stat: [],     // [{ path, dist }]
        model_sprite: [],   // [{ path, dist }]
        model_tri: '',
        _extra: [],         // verbatim lines for unknown keywords
      };
      continue;
    }

    if (!current) continue;

    switch (key) {
      case 'skeleton':
        current.skeleton = rest;
        break;
      case 'skeleton_horse':
        current.skeleton_horse = rest;
        break;
      case 'scale':
        current.scale = parseFloat(rest) || 1.0;
        break;
      case 'indiv_range':
        current.indiv_range = parseInt(rest, 10) || 40;
        break;
      case 'texture': {
        const ci = rest.indexOf(',');
        if (ci >= 0) {
          current.textures.push({ faction: rest.slice(0, ci).trim(), path: rest.slice(ci + 1).trim() });
        } else {
          current.textures.push({ faction: 'all', path: rest.trim() });
        }
        break;
      }
      case 'pbr': {
        const parts = rest.split(',').map(s => s.trim());
        current.pbr.push({ faction: parts[0] || 'all', normal: parts[1] || '', metalness: parts[2] || '' });
        break;
      }
      case 'model_flexi_m':
        current.model_flexi_m.push(splitPathDist(rest));
        break;
      case 'model_flexi_c':
        current.model_flexi_c.push(splitPathDist(rest));
        break;
      case 'model_flexi':
        current.model_flexi.push(splitPathDist(rest));
        break;
      case 'model_stat':
        current.model_stat.push(splitPathDist(rest));
        break;
      case 'model_sprite':
        current.model_sprite.push(splitPathDist(rest));
        break;
      case 'model_tri':
        current.model_tri = rest;
        break;
      default:
        current._extra.push(raw);
    }
  }

  if (current) entries.push(current);

  // Build case-insensitive lookup map
  const byType = {};
  for (const e of entries) byType[e.type.toLowerCase()] = e;

  return { entries, byType };
}

// ─── Serializer ──────────────────────────────────────────────────────────────

export function serializeDescrModelBattle({ entries }) {
  const out = [];
  for (const e of entries) {
    out.push(`type\t\t\t\t${e.type}`);
    if (e.skeleton)       out.push(`skeleton\t\t\t${e.skeleton}`);
    if (e.skeleton_horse) out.push(`skeleton_horse\t\t${e.skeleton_horse}`);
    if (e.scale !== undefined && e.scale !== 1.0) out.push(`scale\t\t\t\t${e.scale}`);
    if (e.indiv_range !== undefined && e.indiv_range !== 40) out.push(`indiv_range\t\t\t${e.indiv_range}`);
    for (const t of (e.textures   || [])) out.push(`texture\t\t\t\t${t.faction}, ${t.path}`);
    for (const p of (e.pbr        || [])) {
      const parts = [p.faction, p.normal, p.metalness].filter(Boolean);
      out.push(`pbr\t\t\t\t\t${parts.join(', ')}`);
    }
    for (const m of (e.model_flexi_m || [])) out.push(`model_flexi_m\t\t${m.path} ${m.dist}`);
    for (const m of (e.model_flexi_c || [])) out.push(`model_flexi_c\t\t${m.path} ${m.dist}`);
    for (const m of (e.model_flexi   || [])) out.push(`model_flexi\t\t\t${m.path} ${m.dist}`);
    for (const m of (e.model_stat    || [])) out.push(`model_stat\t\t\t${m.path} ${m.dist}`);
    for (const m of (e.model_sprite  || [])) out.push(`model_sprite\t\t${m.path} ${m.dist}`);
    if (e.model_tri) out.push(`model_tri\t\t\t${e.model_tri}`);
    for (const ex of (e._extra || [])) out.push(ex);
    out.push(''); // blank line between entries
  }
  return out.join('\n');
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDefaultBattleModelEntry(typeName = 'new_unit_type') {
  return {
    type: typeName,
    skeleton: 'fs_swordsman',
    skeleton_horse: '',
    scale: 1.0,
    indiv_range: 40,
    textures: [{ faction: 'all', path: 'data/models_unit/textures/texture_placeholder.tga' }],
    pbr: [],
    model_flexi_m: [],
    model_flexi_c: [],
    model_flexi: [{ path: 'data/models_unit/unit_placeholder.cas', dist: 'max' }],
    model_stat: [{ path: 'data/models_unit/unit_placeholder_stat.cas', dist: 'max' }],
    model_sprite: [],
    model_tri: '400, 0.5f, 1.0f',
    _extra: [],
  };
}
