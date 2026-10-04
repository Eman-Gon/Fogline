import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function createRequestHandler({ dist, agentHandler, transitHandler }) {
  const directory = resolve(dist);
  return async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end('Invalid URL'); return; }
    if (pathname.includes('\0')) { res.writeHead(400).end('Invalid URL'); return; }
    try {
      if (agentHandler(req, res) || transitHandler(req, res)) return;
      let file = resolve(directory, `.${pathname}`);
      const local = relative(directory, file);
      if (local === '..' || local.startsWith('../') || isAbsolute(local)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
      catch { file = join(directory, 'index.html'); }
      let content;
      try { content = await readFile(file); }
      catch { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
      res.end(content);
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end('Request failed');
    }
  };
}
