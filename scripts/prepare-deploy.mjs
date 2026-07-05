import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const indexPath = join(distDir, 'index.html');

await copyFile(indexPath, join(distDir, '404.html'));
await writeFile(join(distDir, '.nojekyll'), '');

console.log('Prepared deploy fallback files: dist/404.html, dist/.nojekyll');
