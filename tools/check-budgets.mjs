import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const directory = new URL('../apps/web/dist/assets/', import.meta.url);
const files = await readdir(directory);
const rows = await Promise.all(
  files
    .filter((name) => /\.(js|css)$/.test(name))
    .map(async (name) => {
      const data = await readFile(new URL(name, directory));
      const type = name.startsWith('renderer-')
        ? 'renderer'
        : name.startsWith('Explorer-') || name.startsWith('DetectedViewer-')
          ? 'explorer'
          : name.endsWith('.css')
            ? 'styles'
            : name.startsWith('supabase-')
              ? 'supabase'
              : 'entry';
      return { name, type, bytes: data.length, gzipBytes: gzipSync(data).length };
    }),
);
const budgets = {
  entry: 150000,
  renderer: 320000,
  explorer: 30000,
  styles: 15000,
  supabase: 80000,
};
const totals = rows.reduce((sum, row) => {
  sum[row.type] = (sum[row.type] ?? 0) + row.gzipBytes;
  return sum;
}, {});
for (const [type, total] of Object.entries(totals))
  if (total > budgets[type])
    throw new Error(`${type} gzip budget exceeded: ${total} > ${budgets[type]}`);
const entry = rows.find((row) => row.type === 'entry');
if (!entry) throw new Error('Entry bundle missing');
const code = await readFile(new URL(entry.name, directory), 'utf8');
if (code.includes('WebGLRenderer') || code.includes('THREE.Clock'))
  throw new Error('Three.js leaked into the landing entry');
await writeFile(
  new URL('../apps/web/dist/budget-report.json', import.meta.url),
  JSON.stringify({ totals, budgets, files: rows }, null, 2),
);
console.log(
  'Gzip bundle budgets passed:',
  Object.entries(totals)
    .map(([type, size]) => `${type} ${(size / 1024).toFixed(1)} KiB`)
    .join(', '),
);
