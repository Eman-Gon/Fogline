import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import type { AccountState } from '../src/agent-types.ts';

export interface AccountStore { read(): Promise<AccountState | null>; save(state: AccountState, expectedRevision: number): Promise<void> }
export function fileStore(file: string): AccountStore {
  return {
    async read() { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; } },
    async save(state) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, file);
    },
  };
}
export function accountStore(file: string): AccountStore {
  if (!process.env.DATABASE_URL) return fileStore(file);
  const sql = neon(process.env.DATABASE_URL);
  const local = fileStore(file);
  let initialized: Promise<void> | undefined;
  const init = () => initialized ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS fogline_accounts (id text PRIMARY KEY, revision integer NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
    // Copy existing local data only when the cloud account is absent. Leave the backup untouched.
    const existing = await sql`SELECT id FROM fogline_accounts WHERE id = 'personal'`;
    if (!existing.length) {
      const saved = await local.read();
      if (saved) await sql`INSERT INTO fogline_accounts (id, revision, state) VALUES ('personal', ${saved.revision}, ${JSON.stringify(saved)}::jsonb) ON CONFLICT DO NOTHING`;
    }
  })().catch(error => { initialized = undefined; throw error; });
  return {
    async read() { await init(); const rows = await sql`SELECT state FROM fogline_accounts WHERE id = 'personal'`; return rows[0]?.state ?? null; },
    async save(state, expectedRevision) {
      await init();
      const rows = await sql`INSERT INTO fogline_accounts (id, revision, state) VALUES ('personal', ${state.revision}, ${JSON.stringify(state)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, updated_at = now()
        WHERE fogline_accounts.revision = ${expectedRevision} RETURNING id`;
      if (!rows.length) throw new Error('Account changed in another process. Refresh before retrying.');
    },
  };
}
