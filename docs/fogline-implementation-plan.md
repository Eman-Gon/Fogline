# Fogline implementation plan

## Additional research constraints — October 4, 2026

The [user-supplied Muni prediction fact-check](muni-prediction-fact-check-2026-10-04.md) is retained as research input, not an independently verified source audit. Its dated findings, inferences, and unverified claims must remain distinguishable. The following constraints apply to subsequent implementation and product copy; recording them does not mean these features are implemented.

- **Positioning:** Leave-time notifications and service alerts already have competitors according to the supplied research. Focus Fogline on preparation and wake-up planning, observed personal preparation/door-to-stop timing, and useful uncertainty. Do not claim competing apps lack these capabilities without checking them; “not found” does not establish absence.
- **Evidence:** Ghost/surprise vehicles and increased rail risk are documented in the supplied research through SFMTA's 2023 statements, not current measured error rates. Do not assert a measured rail-versus-bus gap or that the T is uniquely inaccurate. Describe the CIS transition without implying a change away from the Cubic vendor family. Shared agency inputs do not imply identical app predictions. Do not depend on MuniMobile as a durable integration.
- **Prediction confidence:** Preserve source timestamps, schedule-versus-live provenance, trip/vehicle identity, and position availability. A terminal or schedule-derived countdown without corroborating fresh movement warrants caution, but missing positions alone do not prove a ghost. A missing prediction near a terminal may be expected; distinguish it from a confirmed feed failure. Service changes also warrant explicit uncertainty until observations support better estimates.
- **Calibration:** Log predictions at their original forecast horizons and compare with independently supported observed arrivals, retaining missing observations as unknown. Learn route/mode differences from those records rather than assigning an invented rail penalty. Personal timing learning requires actual check-ins. Keep transparent buffers until sufficient validation supports any numerical ghost or on-time probability; preparation check-ins alone cannot calibrate vehicle arrival accuracy.
- **Quota and freshness:** Budget every upstream request together, including TripUpdates, VehiclePositions, Service Alerts, static refreshes, and retries. At the reported default of 60 requests per hour, polling two feeds once a minute would already exceed the allowance. Evaluate agency-wide cached feeds and active commute windows, verify the actual key allowance, and request an increase if needed. Whole-agency responses reduce per-stop calls but do not remove per-feed costs. The current ten-minute cache is a freshness limitation to assess before promising minute-sensitive advice.
- **Pre-preparation alerts:** Check relevant, fresh service alerts before recommending preparation or departure. Missing or stale alert data means disruption status is unknown, not that service is clear. Validate live endpoint behavior and identity joins before relying on them.

## Existing implementation sequence

Prepared October 4, 2026. Scope: the six confirmed route, stop, planning, and setup issues from the audit. This document is a plan; application changes have not started in this request.

The target is one saved commute that consistently drives route selection, arrivals, the daily plan, check-ins, spoken briefing, and reminders. Support one primary direct journey first; retain additional favorite lines for browsing without mixing them into its predictions. Build the shared data model before replacing the separate setup screens.

| Stage | Deliverable | Completion gate |
|---|---|---|
| 1. Transit foundation and picker corrections | Natural route ordering; reconciled catalog; directions and complete ordered stop patterns | Every catalog discrepancy has a documented disposition; Route 15's two supplied sequences pass exactly |
| 2. One saved commute | A versioned commute record, migration, and shared read/save flow | Reloading or changing devices produces the same commute; no manual copying between forms |
| 3. Real planning and correct arrivals | One planner using the saved journey, schedule, real clock, and available predictions | A selected non-T route drives Today, speech, and reminders consistently |
| 4. Simple setup and daily screens | Today, My commute, and History; optional map/details | A user can finish setup, use the plan, and edit one preference without restarting |
| 5. Reliability and release checks | Coverage checks, freshness handling, migration/restore checks, and phone validation | No unsupported service is silently presented as a usable trip; all six acceptance criteria below pass |

**Stage 1 — Make routes and stops trustworthy**

- Add one shared route sorter: numeric prefix ascending, base route before suffix variants, letter-led entries alphabetically after all numbered routes. Keep numeric variants together (`8, 8AX, 8BX`). Use mode badges or optional filters without overriding the default order.
- Reconcile the six directory-only entries (78X, KLM Bus, L Bus, M Bus, S, SF) and feed-only FBUS. Store public labels separately from verified source IDs, aliases, service restrictions, and effective dates. Discoverable catalog entries need not be currently running; an unresolved entry must explain its limitation and must not create a fictional departure.
- Use a cached static GTFS dataset for routes, trips, service calendars, stop times, and geometry; normalize real-time data against it. Inspect representative feed fields before locking the adapter. Use 511 Patterns where needed to confirm route patterns/direction labels. Do not permanently hardcode the pasted Route 15 table as runtime truth.
- Represent each ordered stop occurrence within its route pattern. A physical stop may belong to multiple directions or appear more than once in a trip. Do not infer sequence by alphabet, distance, or reversal.
- Make the entire selected direction's stop list accessible, with search by name or ID and a separate Nearby option. Include stop IDs to distinguish opposite-side stops. Switching line/direction clears incompatible selections and ignores superseded fetch responses.
- Retain valid stop records when coordinates are missing. Mark their map position unavailable instead of removing them from the full list, as the current `readStops` filter does. Validate coordinate ranges before rendering a pin.
- Use the saved Route 15 reference as a regression example: 27 inbound entries, 28 outbound entries, 46 unique IDs, and the shared neighborhood loop retaining its order in both directions. Reconcile the label for stop 17324 without duplicating its ID.

511 documents static GTFS, ordered route patterns, and schedule APIs. Its default quota is 60 requests per hour, so schedule downloads and real-time requests must share a budget compatible with the account's actual allowance. Cache static and real-time data separately; do not shorten polling blindly. [511 documentation](https://511.org/open-data/transit).

Likely work: `server/transit.mjs`, `server/transit-cache.mjs`, new normalized transit types/catalog adapter, `src/getting-started.tsx`, `src/route-map.tsx`.

**Stage 2 — Replace fragmented preferences with one commute**

Create a versioned commute record containing agency/route identity, direction, boarding and alighting stops, destination label, arrival deadline, travel days, timezone, preparation estimate, walking estimates, and reminder preferences. Include pattern constraints when needed, while allowing compatible trips that serve both stops in order. Keep actual ride history separate from editable commute settings.

The authenticated server account is the authoritative saved record for real use. Browser state is a cached view and an unsaved form draft; demo data stays separate. A save updates the whole validated commute atomically with a revision check, then invalidates the previous plan. Preserve existing persistence and conflict protection instead of adding a new storage service just for this change.

Migrate existing account and browser preferences without deleting history or silently replacing a configured server commute. Import compatible local values when no server commute exists; where records conflict, present their meaningful differences for a one-time choice. Missing direction/alighting information requires completion once, not an inferred value. Preserve a recoverable pre-migration snapshot and allow rollback.

For repeated use, replace per-reload bearer-key entry with revocable device sessions: bootstrap against the existing personal account, use an HttpOnly same-origin cookie (Secure on HTTPS), enforce origin/CSRF protections on writes, and provide sign-out/revocation. Keep permanent server credentials out of browser storage and URLs. Device pairing should sit outside the ordinary commute form.

Likely work: `src/agent-types.ts`, `server/agent.ts`, `server/store.ts`, `src/main.tsx`, `src/ServerMorning.tsx`, shared client state/API helpers.

**Stage 3 — Make the selected journey drive the plan**

- Start from scheduled trips serving the saved boarding and alighting stops in order on the applicable service date. Overlay matching real-time predictions. Calculate preparation, walking, boarding, and estimated arrival from the same result.
- Use actual dates/times, including service-day rollover and daylight-saving transitions. Remove the hardcoded T wording and manual demo clock from normal Today.
- Distinguish live prediction, scheduled estimate, stale data, unavailable data, no service, and no feasible journey. Missing predictions may permit a labeled scheduled estimate; they must never trigger the sample timetable in real use.
- Prefer scheduled/predicted arrival at the alighting stop. If only a manual ride estimate is available, label it explicitly. Keep preparation learning; replace seeded on-time percentages in ordinary use with a transparent buffer until risk is calibrated.
- Suggest a bus only when its route, direction/trip, and future call at the boarding stop are established. Preserve trip/vehicle IDs in the adapter so prediction rows can be linked to map vehicles where possible. An unmatchable vehicle may be shown as contextual information, but must not be called the user's approaching bus. Straight-line distance is not arrival time.
- Feed Today, spoken briefing, and reminders from one revision-tagged plan. Refresh arrivals and map data through one coordinator; cancel obsolete results when the commute changes. Use actual source age and retain relevant system-wide and stop-level alerts.

Likely work: `src/planner.ts`, `server/agent.ts`, `server/transit.mjs`, `src/main.tsx`, `src/getting-started.tsx`, and related planning tests.

**Stage 4 — Make setup and daily use simple**

Use three short setup stages: destination/deadline/travel days; line/direction/boarding and alighting stops; preparation estimate and a plan preview. Provide editable walking estimates without requiring location permission. Offer reminders after the first useful plan is visible.

Today begins with start and leave times, selected service and destination, the next useful departure, and one current check-in action. Show an alert prominently only when it affects the commute. The map, complete stop list, and plan explanation expand on demand. Use route geometry and selected-stop emphasis without labeling every stop at city-wide zoom.

My commute edits the same saved record and prefills existing choices. History shows actual mornings and preparation learning. Move demo controls into a separate demo entry, and place account/integration configuration and diagnostics in settings. Preserve clear keyboard navigation, focus, selected state, and accessible alternatives to the map.

**Stage 5 — Verify completion and maintenance**

| Original issue | Required evidence before calling it fixed |
|---|---|
| Lines out of order | Unit examples cover numeric variants and letter-last sorting; browser picker matches that ordering with and without search |
| Coverage gaps | Every supported catalog entry has verified IDs, source/version, status, directions/patterns and service dates, or an explicit unsupported reason; temporary entries are not offered outside valid service |
| Hidden/disordered stops | Every valid stop occurrence is reachable by list/keyboard; Route 15 reference order passes in both directions; no opposite-side stops are collapsed by name |
| Wrong bus suggestions | Mixed-line, opposite-direction, shared-loop, passed-stop, and unknown-trip fixtures cannot produce a false recommended bus |
| Today ignores chosen route | Route 15 and another non-T route produce matching Today/briefing/reminder outputs from a real clock; outage handling uses schedule/unknown states, never a demo trip |
| Fragmented setup | Editing the commute updates all surfaces, survives restart/reload, syncs across paired devices, rejects conflicting edits, and preserves history |

Automate catalog refresh and retain the last validated snapshot. Check newly removed/renamed stops against saved commutes and ask only for repairs that affect the user. Test weekday/weekend, event-only, overnight, rapid/express, rail/cable, short-turn, and closure cases. Add stop accessibility metadata with an explicit unknown state; do not claim verified accessible boarding from coordinates alone.

Use the audit's 73-directory/68-feed comparison as a dated reconciliation example, not a permanent route-count requirement. Completeness is measured against the applicable validated source version and service date.

Run targeted unit/integration checks, then `pnpm test` and `pnpm build`. Perform browser walkthroughs on phone-sized and desktop layouts. Validate actual push receipt, acknowledgement, scheduler restart, data backup/restore, and session revocation before relying on reminders. Never send test pushes without the user's authorization for that test.

The first demonstration should be one complete Route 15 commute in both directions using the common data pipeline. Expand validation across the catalog afterward; do not build a Route-15-only implementation. Keep multi-leg route search, new agencies, new AI panels, and real phone-call escalation outside this scope.

**Main dependency and delivery approach**

Sorting and exposing loaded stops are small changes. The substantial work is obtaining reliable pattern/trip/calendar joins and migrating the separate saved states. Validate those joins in Stage 1 before estimating the rest tightly. Stage 1's independent sorting work can proceed alongside adapter inspection; Stage 2 can proceed once normalized identity types are agreed. Stage 3 depends on both, and Stage 4 should consume their shared model. Release through reviewed stages with migration rollback rather than replacing all screens and storage in one step.
