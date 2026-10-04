# Fogline

Fogline works backward from a destination deadline, checks Muni predictions, and learns how long you take to get ready.

## Run locally

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
npm run account
npm run dev
```

Use Node.js 22 or newer. The install command uses the existing pnpm lockfile without requiring a global `pnpm` command. If Corepack is unavailable, use `npm install --ignore-scripts --no-package-lock` instead; that fallback resolves dependencies from `package.json`.

`npm run account` creates a private account key in `.env` and prints it for pairing your devices. Keep it private. Open http://localhost:5173, choose **Server morning**, and enter that key. Restart the server after creating or changing the key. Re-running `npm run account` shows the existing key. The original Today demo works without an account.

For a production build:

```sh
npm run build
npm start
```

The built app runs on port 4173. Run only one Fogline server against the account file at a time. Keep the server awake for background checks. The phone must use the same server address; use HTTPS when exposing it through a tunnel. Never serve the repository root, which contains `.env` and private account data.

## What works

- Original interactive demo: backward planning, simulated 12-minute delay, manual clock, and preparation learning in browser storage.
- Guided Muni line and stop selection, a stop map, and cached vehicle positions. Server direction/headsign and morning preferences still need to be configured separately.
- Cached 511 arrivals, scheduled departures, and service alerts. Set `SF511_API_KEY` in `.env`.
- A personal server account, accessed with the same key from multiple devices. Profile, actual check-ins, learned preparation time, rides, and decisions persist in Neon when `DATABASE_URL` is set, or `data/account.json` otherwise.
- A deterministic agent loop: checks once a minute during the configured weekday window, beginning 10 minutes before it. Shares the 10-minute transit cache, combines simultaneous requests, and backs off for 10 minutes after feed failures.
- Plans from fresh predictions matching both the exact line and destination. Uses your estimated ride duration and clearly labeled seeded residual delays. Missing data produces a labeled sample fallback; a fresh matching feed with no feasible trip reports no fit.
- Authenticated `/briefing/now` returns the same structured plan and spoken wording used in the dashboard.
- ntfy push delivery when configured; otherwise push previews. Phone calls remain dry-run events. Push when preparation is due (or immediately for no feasible plan), first call five minutes after the queued push, second call at least five minutes after the first. Maximum two calls per local day, inside the wake window. Acknowledgement or starting preparation stops escalation.

## Connect a real morning

1. Use **Let’s get started** to choose Muni lines and your boarding stop. In Setup, enter your destination, deadline, preparation time, and estimated travel times; review the selected numeric stop code.
2. Connect in **Server morning**, expand **Server preferences & alarm briefing**, and select **Copy this device’s Setup preferences to the server**.
3. Enter the exact line and destination shown by the 511 arrivals panel to choose the direction. Set your timezone and weekday wake window. Save.
4. Select **Check data & revise plan**. Review its source label, feed age, and decision log.
5. Enable automatic checks to exercise escalation. A configured ntfy topic enables real pushes; otherwise pushes are previews. Calls remain previews. Times use the configured timezone, including daylight saving changes. Wake windows cannot cross midnight.
6. Use the server check-in buttons with the real clock. Valid preparation measurements are 5–180 minutes; next day's estimate blends 75% previous estimate with 25% measured time.
7. Open the same server URL on your phone and enter the same key. Account data refreshes every 30 seconds and on focus. The key stays in page memory, so reload requires reconnecting. Demo taps remain separate.

## Push notifications

Set `NTFY_TOPIC` and optionally `NTFY_SERVER` (defaults to `https://ntfy.sh`) and `NTFY_TOKEN` in `.env`, then restart. Use a long random topic or a protected topic. Subscribe to that server/topic in the ntfy phone app, allow notifications, then use the test control in **Server morning**. A provider acknowledgement is not proof that the phone displayed or sounded the alert. Verify it on the phone before relying on it.

Automatic pushes require enabled weekday checks and the configured wake window. Delivery is persisted before sending to prevent automatic replay of an uncertain send after a restart; failures require checking the phone and delivery log. This review did not send notifications or test an iPhone.

For a hosted, always-on deployment for another person, see [DEPLOY.md](DEPLOY.md).

## Alarm Shortcut integration

The server endpoint is ready; create the automation on your iPhone:

- Alarm stopped → Get Contents of URL: `https://YOUR_SERVER/briefing/now`
- HTTP method: GET. Header: `Authorization: Bearer YOUR_ACCOUNT_KEY`
- Get Dictionary Value: `speech` → Speak Text.
- Add a failure branch that tells you to check Fogline if the server is unreachable.

Use the supported action names on your phone. Retrieving a briefing does not acknowledge waking up. Tap **I’m awake** in Server morning to stop escalation. iPhone setup and alarm behavior have not been tested on a device.

## Current limits

The scheduled loop remains deterministic. On-demand corrections use Mastra Gateway tool calls, and on-demand route research uses Exa. This is a Gateway integration, not the Mastra agent framework. Risk still uses 14 seeded delays, and the configured ride duration is an estimate; recorded rides do not yet recalibrate transit risk. The prediction horizon can be too short to plan a full morning. Alerts are included as text, without assumed numeric delay penalties.

ntfy push delivery is implemented but phone receipt is unverified. Without a valid ntfy topic, pushes remain previews. Calls are **dry runs only**; Twilio delivery and call keypress webhooks are not connected. There is no service worker or automatic iOS alarm installation. Running the app on your laptop requires it to stay awake and online.

The server account is a single personal account with a bearer key, not a multi-user login service. Storage defaults to a local JSON file with atomic replacement and an in-process write queue. Set DATABASE_URL to switch to Neon Postgres; an existing local account is copied only if the cloud account is absent. The database uses a revision check to reject competing writes. A database failure is reported rather than silently switching storage. Ride history retains 365 local days and the latest 500 events. Back up `data/account.json`; use one server process. Rotate `FOGLINE_ACCOUNT_TOKEN` in `.env` and restart to revoke device access without deleting rides. Do not put the key in a URL.

The transit endpoints are public to support setup before account pairing. All feeds share a per-process limit of 128 cached resources, eight concurrent upstream loads, and 60 upstream loads per rolling ten minutes, including failed loads. Invalid stop/line inputs return 400. Budget exhaustion returns per-feed errors and stale data when available. These bounds protect memory and cap quota use, but a public client can still consume that shared budget and delay fresh data for the account. They reset on restart; use one server process.

## What to expect with live data (important)

- The 511 prediction window covers only the next few trips (about 30 minutes at the observed stop). If you start getting ready earlier than that, there is often no live prediction for your trip, so the plan becomes a labeled **sample plan** built from a fictional timetable. Do not rely on it for a real commute.
- The on-time percentage is computed from 14 seeded delays, not your line's history. It is a placeholder.
- Only the push is delivered. Phone calls are log entries.

## Demo replay

On Today: **Simulate 12 min delay** → **Jump to start** → **I’m starting now** → **43 min after start** → **I’m out the door** → **Jump to arrival** → **I’ve arrived** → **Try tomorrow’s plan**. The 35-minute preparation estimate becomes 37. This replay uses sample data and browser-local storage.

## Validation

```sh
npm test
npm run build
```

Tests cover planning, direction matching, changed predictions, stale feeds, preparation progress, escalation limits and acknowledgement, authorization, persistence after restart, conflicting device edits, idempotent check-ins, and next-day learning. Tests also cover malformed HTTP URLs, static path containment, transit input validation, bounded caching, request deduplication, upstream budgets, and failure backoff. No real phone push or call delivery was tested in this review.


## Sponsor API connections

- **Mastra Gateway:** `MASTRA_GATEWAY_API_KEY` enables the server-side correction endpoint. In Server morning, enter an explicit total such as “I need 45 minutes to get ready tomorrow.” The model selects a constrained tool; the server validates it, saves a next-day override, and keeps today's estimate unchanged. The model does not calculate travel times or probabilities. Unsupported requests ask for clarification. `MASTRA_MODEL` optionally overrides the default `google/gemini-2.5-flash`. An HTTP 402 requires checking Gateway credits; it leaves account preferences unchanged.
- **Exa:** `EXA_API_KEY` enables **Search recent route reports**. Search is on demand, cached for 10 minutes, limited to five results from the past two days, and labeled unconfirmed. Public line/direction are sent to Exa; home addresses and ride history are not. Search findings do not change numeric risk estimates. Empty results do not mean all clear.
- **Neon:** add the project's connection string as `DATABASE_URL` in `.env`, then restart. The driver creates `fogline_accounts` and stores the account as a JSONB document with a revision and update timestamp. It preserves profiles, check-ins, rides, pending next-day corrections, and decision history. The supplied October 4 audit reports a successful read of the configured Neon account (revision 16). This hardening pass used temporary local fixtures and did not repeat that live database check. Do not start multiple background scheduler processes against one account.
- **511:** live service alerts and arrivals both succeed. Stop `17166`, 4th St & King St, returns line `T` toward `Chinatown - Rose Pak Station` with aimed and expected times. Enter that stop, line, and destination exactly; the planner matches the destination string as 511 sends it.

All credentials stay server-side. MCP is not required. `/api/agent/integrations` is authenticated and reports configuration and provider health without returning keys. Model requests and web searches happen only when you submit their respective controls; the minute-by-minute loop does not spend model/search credits.

Local setup created the personal account key. Retrieve it privately with `npm run account` and enter it in Server morning. Emails and phone calls are not delivered. Configured ntfy pushes can be delivered.
