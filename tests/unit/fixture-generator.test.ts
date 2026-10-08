import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('native fixture freshness CLI across checkouts', () => {
  it.each(['LF', 'CRLF', 'stale'])(
    'checks %s without rewriting the bundled catalog',
    async (kind) => {
      const parent = resolve('.test-artifacts');
      await mkdir(parent, { recursive: true });
      const temporary = await mkdtemp(join(parent, 'fixture-check-'));
      if (!resolve(temporary).startsWith(parent + sep)) throw new Error('Unsafe test directory');
      try {
        const generator = await readFile(resolve('tools/desktop/generate-fixtures.mjs'), 'utf8');
        const fixture = await readFile(
          resolve('apps/desktop/src-tauri/resources/catalog-fixture.json'),
          'utf8',
        );
        const envelope = JSON.parse(fixture);
        await mkdir(join(temporary, 'tools/desktop'), { recursive: true });
        await mkdir(join(temporary, 'packages/data-access/src'), { recursive: true });
        await mkdir(join(temporary, 'apps/desktop/src-tauri/resources'), { recursive: true });
        await writeFile(join(temporary, 'tools/desktop/generate-fixtures.mjs'), generator);
        await writeFile(
          join(temporary, 'packages/data-access/src/fixtures.ts'),
          `export const fixtureCatalog = ${JSON.stringify(envelope.parts)};\n`,
        );
        const destination = join(
          temporary,
          'apps/desktop/src-tauri/resources/catalog-fixture.json',
        );
        const normalized = fixture.replaceAll('\r\n', '\n');
        const content =
          kind === 'CRLF'
            ? normalized.replaceAll('\n', '\r\n')
            : kind === 'stale'
              ? normalized.replace('2026.10.07.1', 'outdated-catalog')
              : normalized;
        await writeFile(destination, content);
        const result = spawnSync(
          process.execPath,
          [join(temporary, 'tools/desktop/generate-fixtures.mjs'), '--check'],
          { cwd: temporary, encoding: 'utf8', timeout: 10000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(kind === 'stale' ? 1 : 0);
        if (kind === 'stale') expect(result.stderr).toContain('Native bundled fixtures are stale');
        expect(await readFile(destination, 'utf8')).toBe(content);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
});
