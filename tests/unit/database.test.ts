import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { catalogSchema } from '@cortex/part-schema';
import { fixtureCatalog } from '@cortex/data-access';

describe('PostgreSQL migration, projection, constraints and RLS', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('create role anon; create role authenticated;');
    await db.exec(await readFile('supabase/migrations/202610070001_foundation.sql', 'utf8'));
    await db.exec(await readFile('supabase/seed/development.sql', 'utf8'));
    await db.exec(
      "insert into public.parts select 'private-cpu', manufacturer_id, model, 'private-cpu', category, release_date, status, is_fixture, false, visual, created_at, updated_at from public.parts where category = 'cpu'; insert into public.cpu_specs select 'private-cpu', category, socket, family, cores, tdp_watts from public.cpu_specs limit 1;",
    );
  }, 30000);
  beforeEach(async () => {
    await db.exec('reset role;');
  });
  afterAll(async () => {
    await db?.close();
  });
  it('projects the normalized public records into the exact domain schema', async () => {
    await db.exec('set role anon;');
    const { rows } = await db.query<{ record: unknown }>(
      'select record from public.catalog_records order by id',
    );
    const parts = catalogSchema.parse(rows.map((row) => row.record));
    expect(parts).toHaveLength(fixtureCatalog.length);
    expect(parts.find((part) => part.category === 'motherboard')?.specs).toEqual(
      fixtureCatalog.find((part) => part.category === 'motherboard')?.specs,
    );
  });
  it.each(['anon', 'authenticated'])(
    'hides private records and their specifications from %s',
    async (role) => {
      await db.exec(`set role ${role};`);
      expect(
        (await db.query("select * from public.parts where id = 'private-cpu'")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.cpu_specs where part_id = 'private-cpu'")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.catalog_records where id = 'private-cpu'")).rows,
      ).toHaveLength(0);
    },
  );
  it('denies frontend writes and preserves source records', async () => {
    await db.exec('set role anon;');
    await expect(db.exec("update public.parts set model = 'tampered'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.exec('delete from public.part_sources')).rejects.toThrow(/permission denied/);
    await db.exec('set role authenticated;');
    await expect(
      db.exec("insert into public.manufacturers values ('untrusted', 'Untrusted')"),
    ).rejects.toThrow(/permission denied/);
  });
  it('rejects category-specific specs assigned to the wrong part', async () => {
    await expect(
      db.exec("insert into public.cpu_specs(part_id) values ('fixture-board-atx')"),
    ).rejects.toThrow(/foreign key/);
  });
  it('rejects invalid capacities and non-development fixture labels', async () => {
    await expect(db.exec('update public.ram_specs set capacity_gb = -1')).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      db.exec("update public.parts set status = 'active' where is_fixture"),
    ).rejects.toThrow(/check constraint/);
  });
  it('rejects duplicate slugs and invalid source confidence', async () => {
    await expect(
      db.exec("update public.parts set slug = 'sample-eight-core' where category = 'ram'"),
    ).rejects.toThrow(/unique constraint/);
    await expect(db.exec('update public.part_sources set confidence = 2')).rejects.toThrow(
      /check constraint/,
    );
  });
  it('requires a source URL for non-fixture provenance', async () => {
    await expect(
      db.exec("update public.part_sources set status = 'verified', url = null"),
    ).rejects.toThrow(/check constraint/);
  });
  it('enables RLS on every domain table and uses a security invoker view', async () => {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::integer as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity",
    );
    expect(rows[0]?.count).toBe(9);
    const view = await db.query<{ reloptions: string[] }>(
      "select reloptions from pg_class where oid = 'public.catalog_records'::regclass",
    );
    expect(view.rows[0]?.reloptions).toContain('security_invoker=true');
  });
});
