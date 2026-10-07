import { readFile, writeFile } from 'node:fs/promises';
import { catalogSchema } from '../../packages/part-schema/src/index.ts';
const [, , input, output] = process.argv;
if (!input) throw new Error('Usage: pnpm data:validate INPUT.json [VALIDATED.json]');
const records = catalogSchema.parse(JSON.parse(await readFile(input, 'utf8')));
if (output) await writeFile(output, JSON.stringify(records, null, 2));
console.log(
  `Validated ${records.length} hardware records. No network scraping or database writes were performed.`,
);
