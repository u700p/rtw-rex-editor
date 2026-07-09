/**
 * Parser / serialiser for M2TW *.sd.xml sprite-sheet files.
 * Supports both original M2TW format and REX modified format.
 * 
 * Original M2TW Format:
 *   <root>
 *     <version>6</version>
 *     <enumeration_name>STRATEGY_SPRITES</enumeration_name>
 *     <texture_pages count="N">
 *       <page file="..." width="..." height="..." force32bit="0"/>
 *     </texture_pages>
 *     <sprites count="N">
 *       <sprite index="0" name="..." page="0" left="..." right="..." top="..." bottom="..."
 *               x_offset="0" y_offset="0" alpha="1" cursor="0"/>
 *     </sprites>
 *   </root>
 * 
 * REX Modified Format:
 *   <sprite_definitions version="7">
 *     <page file="battlepage_01.tga" w="512" h="512">
 *       <sprite name="BATTLE_HUD_LEFT" x="0" y="0" w="512" h="181" alpha="1" cursor="0" hotspot_x="0" hotspot_y="0"/>
 *     </page>
 *   </sprite_definitions>
 */

const LEGACY_REX_FORMAT = ['m', '2ex'].join('');

function isRexFormat(format) {
  return format === 'rex' || format === LEGACY_REX_FORMAT;
}

export function parseSdXml(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  
  // Detect format by root element
  const spriteDefs = doc.querySelector('sprite_definitions');
  const root = doc.querySelector('root');
  
  if (spriteDefs) {
    // REX modified format
    const version = spriteDefs.getAttribute('version') ?? '7';
    
    const pages = [];
    const sprites = [];
    let spriteIndex = 0;
    
    Array.from(spriteDefs.querySelectorAll('page')).forEach((page, pageIndex) => {
      const file = page.getAttribute('file') ?? '';
      const width = parseInt(page.getAttribute('w') ?? '512');
      const height = parseInt(page.getAttribute('h') ?? '512');
      
      pages.push({ file, width, height });
      
      Array.from(page.querySelectorAll('sprite')).forEach(sprite => {
        const x = parseInt(sprite.getAttribute('x') ?? '0');
        const y = parseInt(sprite.getAttribute('y') ?? '0');
        const w = parseInt(sprite.getAttribute('w') ?? '0');
        const h = parseInt(sprite.getAttribute('h') ?? '0');
        
        sprites.push({
          index: spriteIndex++,
          name: sprite.getAttribute('name') ?? '',
          page: pageIndex,
          left: x,
          top: y,
          right: x + w,
          bottom: y + h,
          x_offset: parseInt(sprite.getAttribute('hotspot_x') ?? '0'),
          y_offset: parseInt(sprite.getAttribute('hotspot_y') ?? '0'),
          alpha: sprite.getAttribute('alpha') ?? '1',
          cursor: sprite.getAttribute('cursor') ?? '0',
        });
      });
    });
    
    return { 
      format: 'rex',
      version, 
      enumName: '', 
      pages, 
      sprites 
    };
  }
  else if (root) {
    // Original M2TW format
    const version = root.querySelector('version')?.textContent?.trim() ?? '6';
    const enumName = root.querySelector('enumeration_name')?.textContent?.trim() ?? '';

    const pages = Array.from(root.querySelectorAll('texture_pages > page')).map(p => ({
      file: p.getAttribute('file') ?? '',
      width: parseInt(p.getAttribute('width') ?? '512'),
      height: parseInt(p.getAttribute('height') ?? '512'),
      force32bit: p.getAttribute('force32bit') ?? '0',
    }));

    const sprites = Array.from(root.querySelectorAll('sprites > sprite')).map(s => ({
      index: parseInt(s.getAttribute('index') ?? '0'),
      name: s.getAttribute('name') ?? '',
      page: parseInt(s.getAttribute('page') ?? '0'),
      left: parseInt(s.getAttribute('left') ?? '0'),
      right: parseInt(s.getAttribute('right') ?? '0'),
      top: parseInt(s.getAttribute('top') ?? '0'),
      bottom: parseInt(s.getAttribute('bottom') ?? '0'),
      x_offset: parseInt(s.getAttribute('x_offset') ?? '0'),
      y_offset: parseInt(s.getAttribute('y_offset') ?? '0'),
      alpha: s.getAttribute('alpha') ?? '1',
      cursor: s.getAttribute('cursor') ?? '0',
    }));

    return { 
      format: 'm2tw',
      version, 
      enumName, 
      pages, 
      sprites 
    };
  }
  else {
    throw new Error('No valid root element found (expected <root> or <sprite_definitions>)');
  }
}

export function serialiseSdXml({ format, version, enumName, pages, sprites }) {
  if (isRexFormat(format)) {
    // REX format output
    const pageLines = pages.map((p, pageIndex) => {
      const pageSprites = sprites.filter(s => s.page === pageIndex);
      const spriteLines = pageSprites.map(s => {
        const w = s.right - s.left;
        const h = s.bottom - s.top;
        return `\t\t<sprite name="${s.name}" x="${s.left}" y="${s.top}" w="${w}" h="${h}" alpha="${s.alpha ?? '1'}" cursor="${s.cursor ?? '0'}" hotspot_x="${s.x_offset ?? 0}" hotspot_y="${s.y_offset ?? 0}"/>`;
      }).join('\n');
      
      return `\t<page file="${p.file}" w="${p.width}" h="${p.height}">\n${spriteLines}\n\t</page>`;
    }).join('\n');

    return `<?xml version="1.0"?>
<sprite_definitions version="${version ?? '7'}">
${pageLines}
</sprite_definitions>`;
  } else {
    // M2TW format output
    const pageLines = pages.map(p =>
      `\t\t\t<page file="${p.file}" width="${p.width}" height="${p.height}" force32bit="${p.force32bit ?? '0'}"/>`
    ).join('\n');

    const spriteLines = sprites.map((s, i) => {
      const idx = s.index ?? i;
      return `\t\t\t<sprite index="${idx}" name="${s.name}" page="${s.page}" left="${s.left}" right="${s.right}" top="${s.top}" bottom="${s.bottom}" x_offset="${s.x_offset ?? 0}" y_offset="${s.y_offset ?? 0}" alpha="${s.alpha ?? 1}" cursor="${s.cursor ?? 0}"/>`;
    }).join('\n');

    return `<?xml version="1.0"?>
\t<root>
\t\t<version>${version ?? '6'}</version>
\t\t<enumeration_name>${enumName ?? ''}</enumeration_name>
\t\t<texture_pages count="${pages.length}">
${pageLines}
\t\t</texture_pages>
\t\t<sprites count="${sprites.length}">
${spriteLines}
\t\t</sprites>
\t</root>`;
  }
}
