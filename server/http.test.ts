import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error JavaScript HTTP adapter.
import { createRequestHandler } from './http.mjs';
// @ts-expect-error JavaScript transit adapter.
import { transitHandler } from './transit.mjs';

test('malformed URLs cannot stop subsequent requests; static files stay inside dist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fogline-http-'));
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'dist-private'));
  await writeFile(join(root, 'dist', 'index.html'), '<h1>Fogline</h1>');
  await writeFile(join(root, 'dist-private', 'secret'), 'private');
  await writeFile(join(root, '.env'), 'PRIVATE=secret');
  const server = createServer(createRequestHandler({ dist: join(root, 'dist'), agentHandler: () => false, transitHandler }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  // node:http preserves raw paths rather than normalizing traversal like fetch.
  const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    request({ hostname: '127.0.0.1', port, path }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    }).on('error', reject).end();
  });
  try {
    for (const path of ['/%E0%A4%A', '/%', '/%00', '/api/transit/%E0%A4%A']) {
      assert.equal((await get(path)).status, 400, path);
      assert.deepEqual(await get('/'), { status: 200, body: '<h1>Fogline</h1>' });
    }
    assert.equal((await get('/..%2fdist-private/secret')).status, 403);
    assert.equal((await get('/..%2f.env')).status, 403);
    assert.equal((await get('/.env')).body, '<h1>Fogline</h1>');
    assert.equal((await get('/some/client/route')).status, 200);
    for (const path of ['/api/transit?stopCode=abc', '/api/transit?stopCode=12345678901', '/api/transit/stops?lines=T,N,K,M,J', '/api/transit/stops?lines=..%2Fsecret', '/api/transit/vehicles?lines=']) {
      assert.equal((await get(path)).status, 400, path);
    }
    assert.equal((await get('/api/transit/unknown')).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
