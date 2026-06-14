/**
 * Parser / serialiser for M2TW *.sd.xml sprite-sheet files.
 * Format:
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
 */

export function parseSdXml(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const root = doc.querySelector('root');
  if (!root) throw new Error('No <root> element found');

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

  return { version, enumName, pages, sprites };
}

export function serialiseSdXml({ version, enumName, pages, sprites }) {
  const pageLines = pages.map(p =>
    `\t\t\t<page file="${p.file}" width="${p.width}" height="${p.height}" force32bit="${p.force32bit}"/>`
  ).join('\n');

  const spriteLines = sprites.map((s, i) => {
    const idx = s.index ?? i;
    return `\t\t\t<sprite index="${idx}" name="${s.name}" page="${s.page}" left="${s.left}" right="${s.right}" top="${s.top}" bottom="${s.bottom}" x_offset="${s.x_offset ?? 0}" y_offset="${s.y_offset ?? 0}" alpha="${s.alpha ?? 1}" cursor="${s.cursor ?? 0}"/>`;
  }).join('\n');

  return `<?xml version="1.0"?>
\t<root>
\t\t<version>${version}</version>
\t\t<enumeration_name>${enumName}</enumeration_name>
\t\t<texture_pages count="${pages.length}">
${pageLines}
\t\t</texture_pages>
\t\t<sprites count="${sprites.length}">
${spriteLines}
\t\t</sprites>
\t</root>`;
}