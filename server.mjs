import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitHandler } from './server/transit.mjs';
import { createAgentService } from './server/agent.ts';
import { createRequestHandler } from './server/http.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
try {
  const env = await readFile(join(root, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const agent = createAgentService({ file: process.env.FOGLINE_ACCOUNT_FILE || join(root, 'data', 'account.json'), token: () => process.env.FOGLINE_ACCOUNT_TOKEN });
agent.start();
const server = createServer(createRequestHandler({ dist: join(root, 'dist'), agentHandler: agent.handler, transitHandler }));
const port = Number(process.env.PORT || 4173);
server.listen(port, process.env.FOGLINE_HOST || '0.0.0.0', () => console.log(`Fogline listening on http://localhost:${port}`));
