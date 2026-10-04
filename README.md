# Fogline

Fogline works backward from your arrival deadline using a saved Muni journey, real schedules, and confirmed live predictions when available.

## Run locally

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
pnpm account
pnpm dev
```

Use Node.js 22 or newer. `pnpm account` creates or shows your private account key. Set `SF511_API_KEY` in `.env`, restart the server, and open http://localhost:5173. Connect your device with the key, then choose **Set up my commute**. The key is not stored in browser storage; an HttpOnly session keeps the device connected for 30 days.

For a production build, run `pnpm build` then `pnpm start` (port 4173). Use HTTPS for remote access. Keep the server awake for background checks. Run one server process per account. Never serve the repository root, which contains private configuration and account data.

## Set up once

1. Choose a numbered or letter-led line. Numbers sort naturally before letters. Services lacking a verified schedule are shown but cannot be selected.
2. Choose a direction and destination variant, then your boarding and alighting stops. Every stop is listed in travel order, with search by name or ID. Stops without map coordinates remain selectable.
3. Set your destination name, deadline, travel days, preparation time, walking estimates, and arrival buffer. Save to see Today’s plan.

**Today** shows the next scheduled commute, preparation and departure times, trip endpoints, source labels, and check-ins. Maps, the complete stop list, upcoming departures, and spoken briefing are expandable. **My commute** edits the same saved journey and contains reminder settings. **History** shows real check-ins and preparation learning.

Earlier server preferences and ride history remain intact. Earlier browser morning preferences can be reviewed and copied during setup; demo check-ins are not imported as real trips. Direction and both stops must be selected explicitly.

## Transit data

The server imports the official SF GTFS archive through 511, including calendars, exceptions, ordered stop calls, route variants, shapes, and after-midnight trips. It caches the archive at `data/transit/sf.zip` and checks for an update daily. Downloads are parsed in a worker and validated before replacing the last good archive. Planning refuses dates beyond the feed's validity and asks for review when a saved pattern changes.

Today uses scheduled boarding and alighting times for the saved journey, including compatible direct variants with unambiguous stop order. A live prediction is used only with an exact route and trip match and a compatible direction. The map shows a bus only when its trip/date and vehicle identity match the prediction and the position is fresh. Known cancellations, skipped stops, passed boarding stops, and applicable service suspensions or stop changes invalidate the candidate. Missing or stale live data uses a labeled scheduled estimate; missing schedules report unavailability. There is no fictional timetable, demo clock, or seeded on-time percentage in Today.

The October 4 reconciliation found 68 scheduled routes and 287 patterns in the imported feed. Route 15 exactly matches the supplied 27 inbound and 28 outbound stop IDs in order. Six directory services (78X, KLM Bus, L Bus, M Bus, S, SF) lack verified schedules in this archive and appear as unavailable references. These require further schedule reconciliation before they can support planning. Event-only references do not imply that an event runs today.

Commute trip updates and positions use three-minute caches; alerts use a ten-minute cache. All 511 requests, including the static archive, share a persisted rolling-hour budget of 55 calls. Source observation timestamps determine whether evidence is fresh. Concurrent requests are coalesced. The budget survives restart; public transit endpoints share it. A filesystem lock prevents concurrent budget writes. An abandoned budget lock fails closed and requires an operator to verify no writer is running before removing that lock; never delete the ledger to bypass limits. Destination arrival is an estimate even when boarding has a live prediction. Walking times are user estimates; there is no transfer planning.

## Account and reminders

The single personal account persists in `data/account.json`, or in Neon when `DATABASE_URL` is configured. Cloud storage uses revision checks; failures do not silently switch to local storage. Back up your account data. `FOGLINE_ACCOUNT_FILE` can isolate a local test account when `DATABASE_URL` is unset. `FOGLINE_HOST` and `PORT` can bind an isolated preview to loopback and another port.

Device sessions are hashed on the server. Disconnecting revokes that device's session while preserving commute and history. Rotate `FOGLINE_ACCOUNT_TOKEN` and restart to revoke device access. Never place the account key in a URL.

Automatic checks follow saved travel days and the configured same-day wake window. Set `NTFY_TOPIC`, optional `NTFY_SERVER` (HTTPS, defaults to ntfy.sh), and optional `NTFY_TOKEN`, then restart to enable push delivery. Use a private random or protected topic and subscribe on your phone. Delivery attempts are persisted before sending to avoid replay after restart. Phone receipt remains unverified. Calls are dry-run events, not delivered calls. There is no service worker or automatic iPhone alarm installation.

An iPhone Shortcut can GET `/briefing/now` with `Authorization: Bearer YOUR_ACCOUNT_KEY` and speak the returned `speech`. Add a failure branch. Starting preparation in Today stops reminder escalation; retrieving a briefing alone does not acknowledge waking.

Existing constrained Mastra correction and Exa research endpoints remain on the server; the simplified interface does not surface them. See [DEPLOY.md](DEPLOY.md) for hosting guidance, noting that older screen names there may refer to the previous interface.

## Validation

```sh
pnpm test
pnpm build
```

Tests cover route sorting, CSV import, missing map coordinates, ordered boarding/alighting, service dates and exceptions, daylight saving and after-midnight trips, non-T planning, prediction identity, expired feeds, session persistence, atomic commute saves, preserved history, authorization, learning, notification safeguards, and shared cache budgets. Browser testing uses a separate local account with notifications disabled.

## Reliability pipeline

A separate **early boarding margin** defaults to three minutes and can be edited in My commute. It is a precaution, not a statistical arrival range. Today shows the be-at-stop target, verified stops remaining when available, source age, an earlier feasible option, and an explanation. Predictions do not silently push an existing departure recommendation later. Destination predictions are used separately when supplied.

Official SFMTA travel advisories are checked every six hours from the latest ten listed notices, matched to route and available date information. They are contextual links, not a complete closure inventory. Exact closure hours and alternate-stop instructions must be reviewed in the source. Event proximity never adds arbitrary delay minutes. Structured real-time alerts remain the planner's scoped disruption input.

During saved travel days, the running server checks from preparation time plus three hours before the arrival deadline until that deadline, independently of whether push reminders are enabled. An open app also refreshes its plan. Normalized observations and forecast snapshots are deduplicated in `data/observations/YYYY-MM-DD.jsonl`; the generated archive retains 30 days and caps each day at 2,000 records. `FOGLINE_OBSERVATIONS_DIR` isolates preview/test archives. Personal account keys and user GPS are not recorded. Keep the server running to collect evidence; there is no data collection while it is off.

```sh
pnpm reliability:report
```

The report derives **inferred passage intervals**, scores forecasts against those intervals, and evaluates a historical residual candidate using earlier service dates for training and later dates for testing. It reports insufficient samples explicitly and **never enables the model automatically**. Passage does not prove boarding, and interval-distance error is not exact arrival accuracy. Long-horizon forecasts beyond 75 minutes are excluded from these evaluation buckets. Confidence ranges remain unavailable until independent validation supports promotion.

Commute reminders distinguish preparation, leaving, and significant plan changes. They deduplicate, reject superseded pending notices, and stop after a boarded/completed check-in. The legacy non-commute escalation remains for compatibility. Real device delivery, cancellation coverage across all services, cadence over multiple service days, and trained-model accuracy still require validation.

Implementation evidence: [feed qualification](docs/reliability-feed-qualification.json), [reliability plan](docs/fogline-reliability-plan.md).
