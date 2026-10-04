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
2. Choose Inbound or Outbound, then choose a boarding stop and a get-off stop from two simple alphabetical lists. Boarding stops include all scheduled variants in that direction; the get-off list includes only downstream stops on a compatible direct trip. Fogline selects the matching trip variant automatically and shows a map below the selections. Stops without map coordinates remain selectable.
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

On a saved travel day, the server plans the Muni route and runs Exa research at the wake-window start when departure is within two hours, then notifies you. Ten minutes before departure it checks live 511 predictions again and repeats every three minutes until you board, you arrive, or 20 minutes after departure, notifying only when the estimate changes. It does not call Google Maps or Apple Maps. Opening Fogline still refreshes once. Set `NTFY_TOPIC`, optional `NTFY_SERVER` (HTTPS, defaults to ntfy.sh), and optional `NTFY_TOKEN`, then restart to enable push delivery. Reminders → Phone notifications shows the server and topic to copy into the ntfy iPhone or Android app, plus a test button. Use a private random or protected topic; anyone who knows an unprotected topic can read or publish to it. Delivery attempts are persisted before sending to avoid replay after restart. Provider acceptance does not confirm phone receipt; check the notification on your phone. Calls are dry-run events, not delivered calls. There is no service worker or automatic iPhone alarm installation.

An iPhone Shortcut can GET `/briefing/now` with `Authorization: Bearer YOUR_ACCOUNT_KEY` and speak the returned `speech`. Add a failure branch. Starting preparation in Today stops reminder escalation; retrieving a briefing alone does not acknowledge waking.

Existing constrained Neon AI correction and Exa research endpoints remain on the server; the simplified interface does not surface them. See [DEPLOY.md](DEPLOY.md) for hosting guidance, noting that older screen names there may refer to the previous interface.

Set `NEON_AI_GATEWAY_TOKEN` and the bare HTTPS `NEON_AI_GATEWAY_BASE_URL` on the server for AI features. `NEON_AI_MODEL` defaults to `gemini-3-flash`. Restart the server after changing configuration. Mastra credentials are no longer used.

## Ask Fogline: the adaptive morning

**Quick use** has its own Ask Fogline card below the ride plan, with no saved commute required. It can explain the ride and its route research, compare departures, add preparation time, and change the temporary arrival deadline to a time you specify. Returned changes carry into refreshes and Track this ride. This chat never writes account preferences, travel days, or notifications; leaving Quick use drops the temporary plan.

On Today, **Ask Fogline** accepts messages such as “I’m 20 minutes behind,” “Today 9:15 is fine,” or “I’m working from home today.” A model (Neon AI Gateway) chooses among five bounded tools; Fogline’s code does every calculation.

- Tools: read morning state, compare validated departures, record extra preparation for today, apply a one-day exception (a new arrive-by time, or a day off), and queue one notification.
- Limits enforced in code: at most four model rounds and three tool calls per round; a new deadline is accepted only if the user typed that exact time; a day off needs an explicit request; extra preparation is capped at 120 minutes; at most two agent notifications a day, each with Fogline-written wording. Exceptions apply to today only and never change the weekly schedule or the learned preparation time.
- The model’s reply is shown only if every detected clock time in it came from a tool result or the user’s message and it contains no percentage. The time guard preserves AM/PM and checks hour-only times. Schedule-only planning replies must include a schedule qualifier; otherwise Fogline shows its own calculated, caveated briefing. Alert text from 511 is never sent to the model.
- Morning stage (planned, unconfirmed, preparing, ready, walking, riding, arrived, skipped) is derived from check-ins and the clock. No response is “unconfirmed,” not “asleep.”
- **Firm deadline** (My commute): when no trip fits the deadline and safety buffer, code replaces the model reply with validated options, labeling late arrivals and arrivals inside the safety buffer. It asks about another route or changing today's deadline. Showing these options never changes the deadline.
- The spoken briefing states how old a live prediction is, says when only the schedule is available, and says disruption status is unknown when alerts cannot be confirmed. Fogline states no on-time percentage for a saved commute.

Not built: model-scheduled rechecks, vehicle-movement corroboration, calibrated arrival probabilities. The real Gateway model has been exercised against live 511 data in isolated test accounts. Deterministic regression tests cover omitted schedule qualifiers, unsupported times, and no-fit wording; these checks do not guarantee all model prose is correct. Each message spends Gateway credits.

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

The main timing form shows **Work start time** and **Time to get ready**. **Optional: walking times and more** contains walking estimates, extra time, destination name, and other schedule settings; existing values still apply when collapsed. Quick use requires an explicit **Work start time today** as its arrival deadline. **Start now** or **Choose a later time** sets when preparation can begin (San Francisco time). The planner chooses the first reachable bus that meets that deadline and the arrival buffer, including the walk after getting off. A passed deadline stays a no-fit result for today; it does not roll over to tomorrow. Late or buffer-short alternatives are labeled separately. The result and Track ride prominently compare estimated destination arrival with the required arrival time. Exa research runs automatically within two hours of departure.

## Exa route research

Research opens only on the local day of the ride, two hours before leaving, and remains available until estimated arrival. Future rides, missing travel windows, and completed or skipped rides do not trigger searches; manual refresh cannot bypass this limit. Only sources with quoted evidence and explicit impact times overlapping the trip are shown. An older notice can still qualify if its disruption remains active during the ride.

With `EXA_API_KEY` configured, saved commute checks and Quick use search Exa for route disruptions, stop relocations, construction, and events for the planned service date. Quick use displays the Exa route report directly below **Refresh this ride**, including its checked time, findings, and source links. Clicking that button runs a new Exa search even when a completed report is cached. Initial checks cache successful reports for 30 minutes and failures for 10 minutes; concurrent searches for the same ride coalesce. Refreshing a temporary ride does not save it or send notifications. Saved commute reports appear under Route notices. Missing configuration or failed searches are labeled unavailable and preserve the transit plan. Search findings do not establish a closure, guarantee coverage, or change 511-derived times.

Exa route assessments use Exa Answer with structured, cited findings for the boarding-to-destination travel window. Red indicates a reported major disruption with matching quoted evidence and overlapping impact times; amber indicates a possible conflict with supported, overlapping impact times; green requires an explicit official normal-service report covering the window; gray means unconfirmed. Event-only reports never establish that a bus is canceled. Missing dates, unrelated routes, expired impact windows, and missing citations cannot produce an all-clear. The route notices menu shows the assessment; its page explains findings and links sources. Assessment cache keys include stops and travel times. Public stop names and travel times are sent to Exa for this check; personal destination labels, GPS, and credentials are not.


## Track a ride and inspect its evidence

Open **Home → Track ride**, **Today → Track this ride**, or **Quick use → Track this ride**. Explicit tracking saves a separate copy of the selected trip, report, and check-ins without replacing the weekly commute. One tracked ride can be active per account. It survives page closure and server restart; the server must remain running. Stop it before tracking another ride.

Checks run every ten minutes while more than 20 minutes from the leave-by target, every four minutes from 10–20 minutes out, and every three minutes at ten minutes or less. These thresholds refer to leaving home. The minute scheduler can add up to a minute of scheduling latency, and upstream cache freshness and request limits still apply. Tracking stays on the selected trip instead of silently switching buses, and never moves its leave-by target later. It ends on confirmed arrival, manual stop, or expiry (30 minutes beyond the latest arrival estimate, capped at four hours from activation).

Delay reports require two distinct fresh provider observations with a delay of at least two minutes. A change of at least one minute produces another report; an unchanged delay does not. Cached repeats, old observations, and outages do not establish persistence. Recovery, known cancellation/stop disruption, and missing-data status are shown separately. Enabled phone reminders plus configured ntfy deliver new delay, recovery, and disruption reports using the existing persist-before-send safeguards. Stopped, superseded, or stale notices are cancelled. While explicitly tracking the saved commute, the tracker replaces routine morning notifications with these change reports. One-time tracking does not change the saved commute’s reminder configuration.

The Exa report is checked at activation, refreshed near departure, and refreshed for a changed persistent delay or disruption, with a minimum ten-minute gap between research attempts. Longer sessions recheck every 30 minutes. The chart shows prediction delay over time. Percentage bars describe this trip’s fresh prediction snapshots, not independent rides or a probability of arriving on time. A calibrated on-time probability remains unavailable. Check-ins measure preparation, door-to-destination time, and boarding-to-destination time (including the final walk). Up to ten previous tracked sessions and 120 observations per session are retained in account storage.
