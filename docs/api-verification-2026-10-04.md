# Fogline API verification — October 4, 2026

Completed at approximately 22:24 UTC against the current local working tree and local `.env` provider configuration. This is not a deployed-host check.

## Summary

- Automated suite: **84 passed, 0 failed** (`pnpm test`). Includes authenticated account flows, sessions, commute setup, check-ins, model guardrails, provider error handling, notifications, transit parsing, and cache budgets.
- Production build: **failed** (`pnpm build`): `server/agent.ts:180`, TS18048 and TS2769. `Number.isFinite(plannedStart)` does not narrow `number | undefined` for the comparison or `new Date(plannedStart)` call.
- Live Mastra: correction interpretation, chat adapter, and `/api/agent/assist` succeeded.
- Live Exa: research endpoint succeeded with five sources.
- Neon: connection and existing account read succeeded. No database writes or schema changes were performed; cloud write/restart persistence remains unverified live.
- Live 511 GTFS realtime: 1,132 trip updates, 614 vehicle positions, 24 alerts parsed without feed errors. These counts confirm retrieval and parsing, not correctness of every prediction.
- Four public transit endpoint checks returned a feed error: **Transit hourly budget reached. Using available schedule data.** They returned HTTP 200 with error metadata; HTTP status alone would have missed the unavailable data. No quota bypass or ledger reset was attempted.
- Cached schedule: catalog returned 74 route entries (68 scheduled plus six unavailable references), validity August 29, 2026–January 15, 2027; T route returned six patterns. The static archive download was not refreshed for this audit.
- SFMTA advisories: ten cached notices returned without an error; no fresh advisory crawl was verified.
- ntfy is configured. Notification route and publishing behavior passed with mocks; **no live push was sent and phone receipt is unverified**.

## Isolation and limits

Account mutations used temporary local accounts, with the scheduler off and notification publishing disabled or mocked. Temporary accounts were removed. Existing personal account data and source files were not modified. Normal transit caching and the shared request ledger were used. Existing uncommitted project changes were preserved.

The valid commute workflow used the real cached T schedule, simulated unavailable live transit, and live AI/search integrations. Preview, save, assistant response, and acknowledgement succeeded. The ordinary `/briefing/now` smoke check used an account without a commute, so its successful response correctly reported `source: unavailable`.

## Detailed checks

- **PASS** — GET /api/agent/integrations: `{"mastra": true, "exa": true, "transit": true, "ntfy": true}`
- **PASS** — GET /api/agent/state authentication: `"Anonymous rejected; bearer accepted"`
- **FAIL** — GET /api/transit/lines: `"Transit hourly budget reached. Using available schedule data."`
- **FAIL** — GET /api/transit/stops?lines=T: `"Transit hourly budget reached. Using available schedule data."`
- **FAIL** — GET /api/transit/vehicles?lines=T: `"Transit hourly budget reached. Using available schedule data."`
- **FAIL** — GET /api/transit?stopCode=17166: `"Transit hourly budget reached. Using available schedule data."`
- **PASS** — Mastra assistant chat adapter (live): `{"validMessage": true}`
- **PASS** — POST /api/agent/research (live Exa): `{"sources": 5}`
- **PASS** — Neon connectivity and existing account read (read-only): `{"connected": true, "accountReadable": true}`
- **PASS** — GET /api/transit/catalog: `{"routes": 74, "start": "20260829", "end": "20270115"}`
- **PASS** — 511 GTFS realtime and SFMTA advisories: `{"trips": {"count": 1132, "fetchedAt": 1791152602606}, "positions": {"count": 614, "fetchedAt": 1791152598138}, "alerts": {"count": 24, "fetchedAt": 1791152598017}, "advisories": {"count": 10, "fetchedAt": 1791148834299}}`
- **PASS** — GET /api/transit/patterns?line=T: `{"patterns": 6}`
- **PASS** — POST /api/agent/correct (live Mastra): `{"interpretedMinutes": 45}`
- **PASS** — POST /api/agent/check and GET /briefing/now: `{"source": "unavailable", "speechReturned": true}`
- **PASS** — POST /api/agent/settings and conflict rejection: `"Valid save accepted; stale revision rejected"`
- **PASS** — Session, pairing code, logout: `"Session cookie and pairing code issued; logout accepted"`
- **PASS** — Validation of assist, preview, commute and checkin: `"Invalid inputs rejected; assist requires saved commute"`
- **NOT_TESTED** — Live ntfy phone delivery: `{"configured": true, "reason": "No live notification sent; publishing and failure behavior covered by automated tests."}`
- **PASS** — Valid preview, commute save, live assist, check-in, notification route: `{"previewSource": "schedule", "commuteSaved": true, "liveAssistReturned": true, "checkinAccepted": true, "notificationRoute": "mock publisher only", "transit": "simulated unavailable; real cached schedule used"}`

## Remaining verification

Re-run the four budget-blocked public transit checks when the rolling-hour budget permits. A live notification test and confirmation on the phone are still needed to establish end-to-end push delivery. Correct the optional-value type guard before a production build can succeed.
