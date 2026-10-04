import { defineConfig, loadEnv, type Plugin } from 'vite';
import { transitHandler } from './server/transit.mjs';
import { createAgentService } from './server/agent';
import { resolve } from 'node:path';

function transitApi(): Plugin {
  return {
    name: 'fogline-transit-api',
    configureServer(server) {
      const agent = createAgentService({ file: resolve('data/account.json'), token: () => process.env.FOGLINE_ACCOUNT_TOKEN });
      const stop = agent.start();
      server.httpServer?.once('close', stop);
      server.middlewares.use((req, res, next) => agent.handler(req, res) || next());
      server.middlewares.use((req, res, next) => transitHandler(req, res) || next());
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [transitApi()], server: { host: '0.0.0.0' } };
});
