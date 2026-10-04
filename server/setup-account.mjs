import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
const file = new URL('../.env', import.meta.url);
let env = '';
try { env = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let token = env.match(/^FOGLINE_ACCOUNT_TOKEN=(.*)$/m)?.[1]?.trim();
if (token && token.length < 32) throw new Error('Existing account key is too short. Remove it from .env and rerun.');
if (!token) {
  token = randomBytes(32).toString('hex');
  env = env.replace(/^FOGLINE_ACCOUNT_TOKEN=.*\r?\n?/gm, '');
  await writeFile(file, `${env.trimEnd()}\nFOGLINE_ACCOUNT_TOKEN=${token}\n`, { mode: 0o600 });
}
await chmod(file, 0o600);
console.log(`Personal account key (keep private):\n${token}\n\nRestart Fogline, then enter this key in Server morning on each device.\nRotating the key in .env revokes access without deleting your rides.`);
