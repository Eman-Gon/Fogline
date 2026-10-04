# Fogline product and transit audit

Reviewed October 4, 2026. This is an audit and implementation plan, not a claim that the proposed changes have been implemented.

Fogline has useful foundations, but it is not yet a complete, dependable “set up once, use every morning” app. The largest problem is that route selection, the Today demo, and the server morning are separate experiences with different state. Correcting the route picker alone will not make the selected commute drive the daily plan.

**What was checked**

- Browser walkthrough of onboarding, the route picker, stop selection, Today, Setup, Your rhythm, and the Server morning connection screen. Visual inspection used the existing narrow browser viewport.
- Source review of route/map rendering, transit adapters, planning, server preferences, persistence boundaries, and notification handling.
- Live local endpoints returned 68 route entries: 58 bus, 7 metro, and 3 cable-car entries. All three returned modes are represented by the current UI; this does not prove the upstream catalog covers every service.
- Stop responses for routes 12, 33, and 36 returned 85, 82, and 111 entries respectively: 278 total. These are route-stop entries, not necessarily unique physical stops or one direction’s stop count.
- Compared the catalog with official SFMTA route pages and consulted official 511 documentation.
- The test run passed 19 tests, and the production build passed. These checks do not cover the whole route catalog or the onboarding UI.
- No authenticated server preferences, notification deliveries, paid research, or personal location access were exercised. The connected server screen was inspected in source. Not every stop on every line was verified against an authoritative timetable.
- Backend files changed during the audit from work outside this audit. Findings are a snapshot of the inspected code and UI. This audit adds this report; it does not modify application source.

**Fix first: correctness and completeness**

| Priority | Finding and evidence | Required change |
|---|---|---|
| P0 | Choosing a route does not make Today plan that route. After selecting a stop on the 12, Today still displayed “Catch the T,” a sample timetable, and a simulated clock. `src/main.tsx:21`, `:28`, `:31`, `:53`. | Use one commute record and one real planning result for Today, spoken briefing, check-ins, and notifications. Move the example timetable into an explicitly entered demo. |
| P0 | Direction is absent from onboarding’s saved route. Server setup instead asks for an exact destination string. `src/getting-started.tsx:4`; `src/ServerMorning.tsx:59`. | Select line → direction → boarding stop, plus destination/alighting stop. Store stable source identifiers and validate that the intended trip serves both stops in the correct order. |
| P0 | “Where the 12 is” showed two buses on the 33. Both setup and Today rank vehicles from all selected lines by straight-line distance. `src/getting-started.tsx:62`, `:86`. | Match line, direction, and stop-serving trip before suggesting a vehicle. Separate other nearby services. Distance alone does not establish that a bus is approaching or boardable. |
| P1 | Lines are unsorted, with Metro before buses. The displayed bus sequence starts 30X, FBUS, 14R, 18, 19, 1X. `src/getting-started.tsx:8`, `:59`, `:67`. | Use a shared natural-order comparator. Numbered lines first, suffix variants beside their base number; all letter-led entries at the end, alphabetically. Preserve mode as a badge/filter rather than letting it override this order. |
| P1 | Catalog coverage is incomplete relative to SFMTA’s published services. The returned list lacks 78X; SFMTA identifies it as active event-only service. | Reconcile a versioned catalog with authoritative schedules and service status. Keep event/replacement services discoverable with clear availability labels. Do not fabricate live departures or assume absence from one response means a route is discontinued. |
| P1 | Only 12 of the 278 loaded stop entries were listed without a search. With location enabled, the cap is 8. There is no “show all” control. `src/getting-started.tsx:61`. | Provide “Nearby” and “All stops”; show counts and expose every valid stop through the list. Searching must support stop name and stop code. |
| P1 | Stops are sorted alphabetically or by geographic proximity, not in travel order. Repeated street names are indistinguishable in the list. The model drops direction and sequence. `server/transit.mjs:67`; `src/getting-started.tsx:60`. | Import ordered stop patterns and direction metadata. Show a linear stop list for each direction, with destination, stop code, and boarding-side information where available. Keep a separate nearby sort. |
| P1 | The setup map shows many overlapping vehicle badges, uniform stop dots, and no route path. Today passes only the selected stop to its map. `src/route-map.tsx:54`; `src/getting-started.tsx:87`. | Render authoritative route geometry; highlight the selected direction and boarding stop. Make all stops accessible in the list and individually inspectable on the map. Show labels as zoom permits; reduce badge overlap. |
| P1 | Vehicle positions load on mount/route change, with no ongoing refresh. “Refresh feeds” refreshes arrivals/schedules but not the separate vehicle component. Data shares a ten-minute cache. | Use one refresh coordinator, real feed timestamps, and explicit fresh/stale/unavailable states. Refresh within the provider budget and stop treating an old position as current. |
| P1 | Today can say “No alerts on your lines right now” when the alerts request failed, and excludes agency-wide alerts without route IDs. `src/main.tsx:30`, `:43`. | Retain relevant agency-wide notices and distinguish confirmed-empty results from stale, failed, or not-yet-loaded data. |

The requested ordering should look like `1, 1X, 2, 5, 5R, 6, 7, 8, 8AX, 8BX, 9, 9R, 12, 14, 14R, …, 90, 91, 714`, followed by letter-led services in alphabetical order. Gaps are legitimate where no current route exists. Do not invent missing consecutive numbers. Event routes such as 78X belong at their numeric position when included in the catalog, with their service restriction visible.

SFMTA also publishes replacement/shuttle services absent under their expected names in the returned catalog, including L Taraval Bus, M Ocean View Bus, S Shuttle, and KLM Bus. These require identifier and service-calendar reconciliation; they should not simply be added as always-running routes. [SFMTA catalog](https://www.sfmta.com/getting-around/muni/routes-stops), [78X event service](https://www.sfmta.com/routes/78x-16th-street-arena-express), [L bus](https://www.sfmta.com/routes/l-taraval-bus), [M bus](https://www.sfmta.com/routes/m-ocean-view-bus).

511 supplies ordered route patterns and static GTFS, so stop sequence should come from transit data rather than geographic guesses. Its published default allowance is 60 requests per hour per token. The newly observed cache limits 60 starts within its ten-minute TTL, which does not enforce that hourly allowance. Confirm this account’s actual allowance and use a shared hourly budget before shortening refresh intervals. [511 transit documentation](https://511.org/open-data/transit).

**Simplify the core experience**

Keep the current restrained colors, readable typography, prominent time, and clear check-in action. The visual problem is mostly information hierarchy: a large repeated introduction, map, bus-distance paragraphs, arrivals, scheduled departures, destination, plan, timeline, spoken briefing, and demo controls compete on one page. The actual “start getting ready” action comes too far down.

Use three destinations in the app:

| Screen | What belongs there |
|---|---|
| Today | Destination/deadline; prominent start and leave times; selected line/direction/boarding stop; next useful departure; one current check-in action; a short alert when action is needed. Expandable route map and explanation. |
| My commute | Saved route and direction, both ends of the journey, deadline, travel days, preparation estimate, and notification preferences. Edit individual fields without restarting onboarding. |
| History | Actual preparation measurements, learned estimate, recent completed mornings, and corrections. Keep technical decision logs behind a diagnostics disclosure. |

Initial setup should have three short stages: (1) destination, arrival deadline, and usual travel days; (2) line, direction, boarding and alighting stops, with optional location assistance; (3) preparation estimate and a preview to confirm. Offer notification setup afterward. Estimates requiring manual entry must be clearly labeled and easy to adjust.

The current two-step onboarding collects only a line and boarding stop, then assumes a destination and timing defaults. The user later encounters Setup and a second server preferences form. Remove the need to copy preferences between these forms or type raw stop codes, headsign strings, timezone names, account keys, and terminal commands in normal commuter setup. Keep necessary installation and advanced integration instructions in a separate operator/setup area.

**Make it maintainable after setup**

- Persist one canonical commute and keep Today, the map, predictions, notifications, and learning synchronized. Editing the stop code currently can leave the saved map route unchanged; server preferences can diverge again.
- Prefill the current line/stop when editing. Clear an obsolete selected stop when a line changes; disable confirmation while new stops are loading; discard responses for earlier selections. The current wizard retains `selected` across a back-to-lines transition.
- Use a durable, revocable device session suitable for repeated use. The current key lives only in page memory and must be entered after reload. Do not solve this by exposing the long-lived server secret in a URL or casually storing it in browser storage.
- Refresh the route catalog and service calendars automatically, retain the last verified version for outages, and flag removed or changed saved stops for user repair. Avoid a hand-maintained route list.
- Base an advance morning plan on the applicable schedule, then revise it with real-time predictions. The server currently considers live arrivals but otherwise falls back to the sample planner; its fetched schedule is not used by `computeBriefing`.
- Provide clear operational states: ready, service unavailable, data out of date, setup incomplete, notifications unavailable. Put provider names, raw logs, and integration health in diagnostics.
- Run the scheduler on a reliably available host with restart handling, a single active scheduler for the personal account, backups, and a tested restore procedure. A sleeping laptop cannot provide dependable morning alerts.
- Push support exists through ntfy in current source, while calls remain previews. Verify actual phone receipt, background behavior, acknowledgement, and failure handling before presenting reminders as dependable. The README still describes pushes as dry runs and needs to match the implementation.
- Preserve measured preparation learning and allow correction. Do not reset completed history when changing the commute. Do not present the 14 seeded delays as a calibrated personal on-time probability.

**What should not be done**

- Do not add more dashboard panels, transit agencies, chat features, or complex transfers before one commute works correctly end to end.
- Do not put demo clocks, reset controls, provider configuration, route research, and technical logs in the ordinary morning flow.
- Do not label every stop permanently at a city-wide zoom; that would worsen clutter. Complete data plus an ordered list and useful zoom-dependent labels meets the need better.
- Do not use proximity or alphabetical order as a substitute for trip direction and stop sequence.
- Do not treat missing predictions as proof of no service, or a failed alerts request as “all clear.”
- Do not claim automatic alarm setup or live phone calls until those integrations are implemented and tested.
- Do not add more infrastructure solely to make the app appear complete. Keep the existing deterministic planning and bounded storage approach where it works; fix state ownership and operational reliability first.

**Implementation order and completion checks**

1. Correct catalog ordering, complete stop access, direction labels, and vehicle filtering. Add targeted coverage for suffix ordering, letter-last order, duplicate stop names, all-stops access, and selection changes.
2. Introduce the canonical commute and connect it to the real planner. Verify a non-T bus and both directions, and confirm Today, spoken briefing, and notifications use the same result. Use proper scheduled service when predictions are unavailable.
3. Restructure navigation and shorten setup. A returning rider should see the next action immediately, edit one setting without repeating setup, and retain history after reload.
4. Add catalog reconciliation, data freshness handling, durable device access, and operational monitoring. Test outages, rate limits, service changes, restarts, and real phone delivery.

Before declaring “all lines fully implemented,” produce a catalog coverage report for every supported service: source identifier, public label, mode, service status/calendar, directions, ordered stops, valid coordinates, and route geometry. Every record must either pass or have an explicit unsupported/unavailable reason. Follow with representative end-to-end journeys and exception cases: local, rapid, express, Owl, rail, cable car, event-only service, and no current service. A passing build and 19 existing tests are useful checks, but not this certification.

**Follow-up: complete directory reconciliation and omissions from the first audit**

Rechecked the user-supplied SFMTA directory against the current local `/api/transit/lines` response. All 73 directory entries were compared using public route numbers and named-service aliases. The result is 67 matches, six directory services absent from the app response, and one app entry absent from the directory. That explains the 73-versus-68 difference; it is not simply five missing routes. The record-by-record comparison is saved in `docs/muni-catalog-reconciliation-2026-10-04.json`. Presence does not certify that a service runs today or that its stops are complete. [Directory source](https://www.sfmta.com/getting-around/muni/routes-stops).

| Service absent from the app response | Correct treatment |
|---|---|
| 78X | Event-only service; retain its availability restriction. |
| KLM Bus | Temporary substitute service during subway maintenance. |
| L Taraval Bus | Replacement/special service; check the applicable dates and operating periods. |
| M Ocean View Bus | Bus substitution as needed. |
| S Shuttle | Do not classify this only as a rare replacement: its page advertises weekday service as well as special events. |
| SF | Newly identified omission from the first audit. The page describes a temporary FIFA shuttle for specified June dates; it should not be offered as an ordinary October commute. |

The page-level “Active” flag alone is insufficient: SF still has that flag while its description restricts it to specific game dates. Interpret effective dates, days, and operating windows together. S advertises weekdays 7 a.m.–8:20 p.m.; KLM is explicitly marked Substitute. [SF service](https://www.sfmta.com/routes/sf), [S Shuttle](https://www.sfmta.com/routes/s-shuttle), [KLM shuttle](https://www.sfmta.com/routes/klm-bus-muni-metro-shuttle).

The app-only entry is **FBUS**. Its presence in the feed is not evidence of a bug or grounds to delete it. Investigate its relationship to F replacement service and retain a source/status distinction. Existing aliases such as LOWL, NOWL, KBUS, NBUS, TBUS, CA, PH, and PM were matched to their public names rather than falsely counted as missing. Internal source IDs and public labels should remain separate fields.

**Additional requirements that the first audit did not make explicit enough:**

1. **Trip variants, not just one stop list per line.** SFMTA's August 29 changes describe selected morning 8AX trips extending beyond Broadway. The app's returned 8AX list contains 45 stops and does not expose that northern extension. This is a variant-coverage concern requiring timetable/pattern verification, not proof that every 8AX trip should serve those stops. The ordinary route page itself is insufficient for all exceptional trips. [Official service-change notice](https://www.sfmta.com/blog/improvements-are-coming-muni-service-changes-start-aug-29%E2%80%AF).
2. **Stop-ID discrepancies need a repair path.** For 8AX, the SFMTA route page lists San Bruno & Felton as **16359**, while the app returns the same street name with **17900**. Determine whether this reflects a relocation, replacement, or lag between sources before changing saved commutes. This follow-up has not established which ID is correct for a particular trip/date. [8AX stop list](https://www.sfmta.com/routes/8ax-bayshore-express), [SFMTA stop 16359](https://www.sfmta.com/stops/san-bruno-ave-felton-st-16359).
3. **One suspected gap was ruled out.** The app already has the two Eucalyptus stops on 28R, IDs **13354** and **13355**. All **26 distinct stop IDs** on the checked SFMTA 28R page were present in the app response, with no extra IDs. This validates that route's union of stop IDs in the checked snapshots; direction, sequence, timetable, and temporary changes still need separate checks. [28R stop list](https://www.sfmta.com/routes/28r-19th-avenue-rapid).
4. **After-midnight service needs explicit scope.** Owl routes are visible in the picker, but the current planner requires predicted and scheduled departures to be on the current local date, and wake-window validation disallows a window spanning midnight. Implement service-day-aware times and midnight rollover if Owl is to be called fully supported; otherwise clearly limit the planning feature's supported hours. Merely listing an Owl route is not implementation of its overnight journeys.
5. **Stop accessibility is missing from the model.** A stop name and coordinates do not indicate whether a rider can board there. Add known accessible-boarding information, an unknown state, and relevant station/lift notices without expanding the main dashboard. F has specific accessible platforms and lifts, so a generic route-level accessibility flag is insufficient. [SFMTA streetcar access guide](https://www.sfmta.com/getting-around/accessibility/muni-accessibility/muni-access-guide/access-historic-streetcars).
6. **Temporary stop closures and substitutions need actionable display.** Route pages link to temporary-stop notices. Show an affected saved stop's closure/relocation and supported alternative when verified; do not rely only on a general line alert or continue suggesting the unchanged boarding pin. This remains a required integration, not a verified current failure at every stop.

The next correctness pass should therefore cover catalog presence, service calendars, trip variants, stop identity, direction/sequence, and exceptions as separate checks. No application source was changed in this follow-up; the audit and catalog comparison were updated.
