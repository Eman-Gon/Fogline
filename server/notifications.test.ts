import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from './store.ts';
import { createAgentService, freshAccount } from './agent.ts';
import { deliverPendingPush, notificationConfig, notificationStatus, publishNotification, NotificationError } from './notifications.ts';

const keys = ['NTFY_TOPIC', 'NTFY_SERVER', 'NTFY_TOKEN'] as const;
const withEnv = async (env: Partial<Record<(typeof keys)[number], string>>, run: () => Promise<void> | void) => {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try { await run(); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const ok = (body: unknown = { id: 'abc123', event: 'message' }) => new Response(JSON.stringify(body), { status: 200 });

test('config requires a safe topic and an HTTPS server without credentials', async () => {
  await withEnv({}, () => { assert.equal(notificationConfig(), null); assert.equal(notificationStatus().configured, false); });
  await withEnv({ NTFY_TOPIC: 'my-topic_1' }, () => assert.equal(notificationConfig()!.url, 'https://ntfy.sh/my-topic_1'));
  await withEnv({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://ntfy.example.com/' }, () => assert.equal(notificationConfig()!.url, 'https://ntfy.example.com/t'));
  for (const bad of [{ NTFY_TOPIC: '../x' }, { NTFY_TOPIC: 'a b' }, { NTFY_TOPIC: 't', NTFY_SERVER: 'http://ntfy.sh' }, { NTFY_TOPIC: 't', NTFY_SERVER: 'https://u:p@ntfy.sh' }, { NTFY_TOPIC: 't', NTFY_SERVER: 'https://ntfy.sh/?x=1' }, { NTFY_TOPIC: 't', NTFY_SERVER: 'not a url' }]) {
    await withEnv(bad, () => { assert.throws(() => notificationConfig(), NotificationError); assert.equal(notificationStatus().configured, false); assert.ok(notificationStatus().error); });
  }
});

test('publish sends one POST with token and returns the provider id, never touching the network', async () => {
  await withEnv({ NTFY_TOPIC: 'topic', NTFY_TOKEN: 'secret-token' }, async () => {
    const calls: { url: string; init: any }[] = [];
    const id = await publishNotification('Leave at 7:42 ☔', (async (url: string, init: any) => { calls.push({ url, init }); return ok(); }) as any);
    assert.equal(id, 'abc123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ntfy.sh/topic');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, 'Leave at 7:42 ☔');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  });
  await withEnv({ NTFY_TOPIC: 'topic' }, async () => {
    let headers: any;
    await publishNotification('x', (async (_u: string, init: any) => { headers = init.headers; return ok(); }) as any);
    assert.equal(headers.Authorization, undefined);
  });
  await withEnv({}, async () => { await assert.rejects(publishNotification('x', (async () => { throw new Error('should not send'); }) as any), /NTFY_TOPIC/); });
});

test('publish reports HTTP errors, malformed replies and network failures without leaking the token or topic URL', async () => {
  await withEnv({ NTFY_TOPIC: 'topic', NTFY_TOKEN: 'secret-token' }, async () => {
    const failing: [string, () => Promise<Response>, RegExp][] = [
      ['403', async () => new Response('forbidden secret-token', { status: 403 }), /HTTP 403/],
      ['bad json shape', async () => ok({ hello: 'world' }), /unexpected response/],
      ['non-message event', async () => ok({ id: 'x', event: 'open' }), /unexpected response/],
      ['network', async () => { throw new TypeError('connect ECONNREFUSED https://ntfy.sh/topic secret-token'); }, /could not confirm delivery/],
      ['redirect', async () => { throw new TypeError('unexpected redirect'); }, /could not confirm delivery/],
    ];
    for (const [name, request, message] of failing) {
      const error: any = await publishNotification('x', request as any).catch(e => e);
      assert.ok(error instanceof NotificationError, name);
      assert.match(error.message, message, name);
      assert.doesNotMatch(error.message, /secret-token|ntfy\.sh\/topic/, name);
    }
  });
});

const monday = new Date('2026-10-05T14:00:00Z'); // 07:00 Pacific, inside the default wake window
const pendingState = () => {
  const state = freshAccount(); state.settings.enabled = true;
  state.events.unshift({ id: '2026-10-05:push', at: monday.toISOString(), kind: 'push', text: 'Start getting ready', dryRun: true, delivery: { status: 'pending' } });
  return state;
};

test('deliverPendingPush persists "sending" before publishing, then records sent', async () => {
  const state = pendingState(); const seen: (string | undefined)[] = [];
  await deliverPendingPush(state, monday, async () => { seen.push(state.events[0].delivery?.status); }, async text => { assert.equal(text, 'Start getting ready'); assert.equal(seen.at(-1), 'sending'); return 'id-1'; });
  assert.deepEqual(seen, ['sending', 'sent']);
  assert.equal(state.events[0].dryRun, false);
  assert.deepEqual(state.events[0].delivery, { status: 'sent', at: monday.toISOString(), providerId: 'id-1' });
});

test('failed delivery is recorded and never retried automatically', async () => {
  const state = pendingState(); let sends = 0;
  const publish = async () => { sends++; throw new NotificationError('ntfy returned HTTP 500.'); };
  await deliverPendingPush(state, monday, async () => {}, publish);
  assert.equal(state.events[0].delivery?.status, 'failed');
  assert.equal(state.events[0].dryRun, true);
  await deliverPendingPush(state, monday, async () => {}, publish);
  assert.equal(sends, 1);
});

test('a crash while sending leaves "sending", which is not replayed after restart', async () => {
  const state = pendingState(); let sends = 0;
  await assert.rejects(deliverPendingPush(state, monday, async () => { if (state.events[0].delivery?.status === 'sending') throw new Error('process died'); }, async () => { sends++; return 'x'; }), /process died/);
  assert.equal(sends, 0);
  await deliverPendingPush(state, monday, async () => {}, async () => { sends++; return 'x'; });
  assert.equal(sends, 0);
  assert.equal(state.events[0].delivery?.status, 'sending');
});

test('pushes are cancelled, not sent, once they are stale, acknowledged, started, disabled, or on a weekend', async () => {
  const cases: [string, (s: ReturnType<typeof pendingState>) => Date][] = [
    ['next day', () => new Date('2026-10-06T14:00:00Z')],
    ['after the window', () => new Date('2026-10-05T18:00:00Z')],
    ['acknowledged', s => { s.rides.push({ date: '2026-10-05', started: null, left: null, arrived: null, measured: null, nextReady: null, acknowledged: true }); return monday; }],
    ['started', s => { s.rides.push({ date: '2026-10-05', started: monday.toISOString(), left: null, arrived: null, measured: null, nextReady: null, acknowledged: true }); return monday; }],
    ['disabled', s => { s.settings.enabled = false; return monday; }],
    ['weekend', s => { s.events[0].id = '2026-10-10:push'; return new Date('2026-10-10T14:00:00Z'); }],
  ];
  for (const [name, setup] of cases) {
    const state = pendingState(); const now = setup(state); let sends = 0;
    await deliverPendingPush(state, now, async () => {}, async () => { sends++; return 'x'; });
    assert.equal(sends, 0, name);
    assert.equal(state.events[0].delivery?.status, 'cancelled', name);
  }
});

test('agent sends exactly one real push per morning through the scheduler, and previews when ntfy is off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fogline-ntfy-'));
  try {
    for (const enabled of [true, false]) {
      const file = join(dir, `${enabled}.json`);
      const store = fileStore(file);
      const seed = freshAccount(); seed.settings.enabled = true; // sample plan: preparation due at the wake window start
      await store.save(seed, 0);
      let clock = monday; const sent: string[] = [];
      const service = createAgentService({ file, token: () => 'x'.repeat(32), snapshot: async () => null, now: () => clock, store, pushEnabled: () => enabled, publish: async text => { sent.push(text); return `id-${sent.length}`; } });
      await service.tick();
      for (const minutes of [10, 20, 30, 40, 50, 60, 70, 80]) { clock = new Date(monday.getTime() + minutes * 60000); await service.tick(); }
      const state = (await store.read())!;
      const pushes = state.events.filter(e => e.kind === 'push');
      assert.equal(pushes.length, 1);
      assert.equal(sent.length, enabled ? 1 : 0);
      assert.equal(pushes[0].delivery?.status, enabled ? 'sent' : undefined);
      assert.equal(pushes[0].dryRun, !enabled);
      assert.ok(state.events.filter(e => e.kind === 'call').every(e => e.dryRun), 'calls stay previews');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
