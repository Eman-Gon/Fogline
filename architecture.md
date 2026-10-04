# Fogline architecture

The React client now has two independent flows: the browser-local demo and a personal server morning. Numeric planning stays in code.

## Components

| File | Responsibility |
|---|---|
| `src/main.tsx` | Original Today, Your rhythm, Setup, and demo state |
| `src/planner.ts` | Demo planning, seeded residuals, preparation learning, time formatting |
| `src/ServerMorning.tsx` | Server account connection, actual check-ins, configuration, briefing, ride history, decision log |
| `src/agent-types.ts` | Account, profile, briefing, ride, and event interfaces |
| `server/agent.ts` | Authentication, serialized persistence, weekday scheduling, live trip selection, briefing and escalation |
| `server/notifications.ts` | ntfy delivery, persisted delivery status and duplicate-send prevention |
| `src/getting-started.tsx`, `src/route-map.tsx` | Guided line/stop selection and Leaflet map |
| `server/store.ts` | Neon Postgres or local-file account storage |
| `server/transit.mjs`, `server/transit-cache.mjs` | Validated 511 inputs, bounded shared cache, upstream budget, deduplication and failure backoff |
| `server/setup-account.mjs` | Generates or displays the personal account key in `.env` |
| `server.mjs`, `server/http.mjs` | Production API and static `dist` server; malformed URLs return 400 |
| `vite.config.ts` | Same API and recurring scheduler during local development |

```
511 → shared 10-minute cache → deterministic server loop
                                      ↕
                              Neon or data/account.json
                                      ↕
                         authenticated API + briefing
                           ↙                    ↘
                    React dashboard       alarm Shortcut
```

## Server account and state

One personal account per server. `FOGLINE_ACCOUNT_TOKEN` is generated with 32 random bytes by `npm run account`. Requests authenticate with a Bearer header and a constant-time token comparison. The key never appears in API response bodies or URL parameters. The UI keeps it in memory until reload; the same key connects another device to the same account.

`data/account.json` stores a versioned state with a revision, profile, agent settings, current briefing, up to 365 daily ride records, and the latest 500 events. Writes run through one in-process queue and replace the file atomically. A malformed existing file produces an error instead of replacing it with defaults. File permissions are private. When `DATABASE_URL` is set, `server/store.ts` uses Neon Postgres instead, stores the account as JSONB, and checks revisions on writes. The supplied October 4 audit reports a successful Neon account read. Run one scheduler process per account; database revisions do not coordinate competing schedulers.

Preference updates require the current revision. Conflicting updates return 409 and ask the client to refresh. Check-in actions merge against current server state and are idempotent for the same local day. Timestamps come from the server, not client-submitted times. The client polls every 30 seconds and on window focus.

## Loop and trip selection

With automatic checks enabled, the loop runs every minute on weekdays, starting 10 minutes before the configured wake window and stopping at its end. The manual check and briefing endpoint can run any time. A sleeping or stopped server cannot check conditions.

The 511 adapter caches requests for 10 minutes, combines in-flight requests for the same resource, and backs off for 10 minutes on failure. Successful, failed and pending resources share a 128-entry LRU limit. At most eight upstream loads run concurrently, and at most 60 may start per rolling ten minutes. Budget exhaustion returns per-feed errors, with stale data when available. Public traffic can consume the shared budget; limits reset on restart. The agent requires an exact line and destination match so opposite directions are not mixed. It uses only same-day predictions with valid aimed and expected timestamps, fetched within 10 minutes and without stale/error status.

The latest feasible matched trip is chosen. Departure from home is the earlier of aimed/predicted boarding time, minus walking time. Estimated destination arrival uses predicted boarding time, configured ride duration, and destination walk. The 80th percentile of the seeded residual delays is held as a buffer. Preparation already completed is deducted from remaining preparation time. The briefing reports seeded odds and estimated ride duration explicitly.

Missing or stale matching data leads to a labeled sample plan. A fresh, valid matching feed with no feasible candidate leads to no plan, not a sample substitute. Official alert text is included but does not invent a numeric delay penalty. Each change in chosen trip, timing, source, reason, or alerts adds a decision event. After departure the briefing asks for arrival feedback instead of replanning the morning.

## Check-ins and learning

Actions are `acknowledge`, `start`, `leave`, and `arrive`. Leaving requires starting; arriving requires leaving. A preparation duration outside 5–180 minutes is rejected. Learning is `round((old * 3 + measured) / 4)` and applies on a subsequent local day. Explicitly saved preferences supersede older unapplied learning while preserving its historical record. Changing preferences during an active ride is rejected; timezone is fixed after the first check-in to preserve day boundaries.

The demo uses a separate localStorage key (`fogline-v1`) and manual clock. Its taps never create server rides. Setup preferences transfer to the server only through the explicit copy checkbox.

## Briefing and escalation

`GET /briefing/now` checks data, saves the decision, and returns `{ speech, plan, source, checkedAt, sourceAt, reason, alerts }`. Wording is rendered directly from calculated fields, with no LLM arithmetic. An alarm-stopped Shortcut can fetch it using the Authorization header and speak `speech`.

Escalation persists events; a valid ntfy configuration enables real push attempts, while calls remain dry runs. At preparation time inside the wake window it queues a push; a missing feasible plan also triggers the preview. Preparation times that move earlier remain the alert target for that morning. The first call is eligible five minutes after the actual queued push; the second is eligible five minutes after the first. Daily event identifiers prevent duplicates after restart, with a two-call maximum. Acknowledgement or starting preparation suppresses further escalation. Catching up after a paused process does not queue two calls together. The ntfy publisher records a sending claim before the HTTP request, then records success or failure. An uncertain send is not automatically replayed after restart. Phone receipt remains unverified. No phone calls are sent.

## API

Every endpoint below requires `Authorization: Bearer <account key>`. Mutations require JSON.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agent/state` | Current saved account |
| POST | `/api/agent/settings` | `{ revision, profile, settings }` with validation and revision conflict checking |
| POST | `/api/agent/check` | Recheck data and revise the plan |
| POST | `/api/agent/checkin` | `{ action }`, using server timestamps |
| GET | `/briefing/now` | Structured briefing for the phone |
| GET | `/api/agent/integrations` | Provider configuration and recorded health |
| POST | `/api/agent/correct` | Interpret a next-day preparation correction through Neon AI Gateway |
| POST | `/api/agent/research` | On-demand Exa route reports |
| POST | `/api/agent/notifications/test` | Send an ntfy test push |

`/api/transit?stopCode=...`, `/api/transit/lines`, `/api/transit/stops?lines=T,N`, and `/api/transit/vehicles?lines=T,N` are public feed APIs used before pairing. Stop codes accept up to ten digits and line queries accept one to four bounded identifiers. It does not expose account state. Production serves static files only from `dist`.

## Still to connect

Phone verification for ntfy, actual call delivery and provider acknowledgement callbacks, iPhone alarm automation, an always-on app host and backups, wider schedule coverage, and personal transit-risk calibration. Neon storage, Neon AI Gateway corrections and Exa research are implemented; their configuration and verification are described in README and api.md. This slice provides a working server loop and account while preserving the labeled demo.
