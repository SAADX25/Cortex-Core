import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureCatalog } from '../../packages/data-access/src/fixtures.ts';
const quote = (value) =>
  value === null
    ? 'null'
    : typeof value === 'boolean' || typeof value === 'number'
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const array = (value) => (value === null ? 'null' : `array[${value.map(quote).join(',')}]`);
const snake = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
let sql =
  '-- DEVELOPMENT ONLY: fictional sample hardware, generated from the validated TS fixtures.\nbegin;\n';
sql += "insert into public.manufacturers(id,name) values ('cortex-lab','Cortex Lab');\n";
for (const part of fixtureCatalog) {
  sql += `insert into public.parts(id,manufacturer_id,model,slug,category,release_date,status,is_fixture,is_public,visual,created_at,updated_at) values (${[part.id, 'cortex-lab', part.model, part.slug, part.category, part.releaseDate, part.status, true, true, JSON.stringify(part.visual), part.createdAt, part.updatedAt].map(quote).join(',')});\n`;
  for (const [field, source] of Object.entries(part.provenance))
    sql += `insert into public.part_sources(part_id,field_path,url,organization,verified_at,status,confidence) values (${[part.id, field, source.url ?? null, source.organization, source.verifiedAt, source.status, source.confidence].map(quote).join(',')});\n`;
  const specs = Object.entries(part.specs).filter(([key]) => key !== 'm2Slots');
  sql += `insert into public.${part.category}_specs(part_id,${specs.map(([key]) => snake(key)).join(',')}) values (${quote(part.id)},${specs.map(([, value]) => (Array.isArray(value) ? array(value) : quote(value))).join(',')});\n`;
  if (part.category === 'motherboard')
    for (const slot of part.specs.m2Slots)
      sql += `insert into public.m2_slots(board_id,semantic_id,key,interfaces,lengths_mm) values (${quote(part.id)},${quote(slot.id)},${quote(slot.key)},${array(slot.interfaces)},${array(slot.lengthsMm)});\n`;
}
sql += 'commit;\n';
await mkdir(new URL('../../supabase/seed/', import.meta.url), { recursive: true });
await writeFile(new URL('../../supabase/seed/development.sql', import.meta.url), sql);
console.log(`Generated development-only seed for ${fixtureCatalog.length} validated fixtures.`);
