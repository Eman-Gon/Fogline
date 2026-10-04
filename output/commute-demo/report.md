# Fogline commute demo — 8:15 wake, 9:22 work

Tested October 4, 2026. Simulated service morning: Monday October 5, 2026, America/Los_Angeles.

**Result: partially meets the need, but continuous and dependable morning guidance is not ready.**

The current implementation is materially more advanced than the earlier chat assessment. It imports real GTFS, matches realtime trips, recalculates journeys, schedules background checks, and integrates ntfy. This review evaluated that current code.

## Scenario and limits

- User supplied: route 15, Palou & Ingalls, last stop, wake/check at 08:15, work by 09:22, preparation 20–30 minutes.
- Assumed inbound downtown: Palou Ave & Ingalls St (15869) to Sutter St & Sansome St (16606).
- Walking was not supplied. Used the app defaults: 6 minutes to the boarding stop, 5 minutes from the final stop to work, 3 minutes early boarding margin, 7 minutes arrival buffer.
- Real cached official GTFS archive: version 20260829, declared validity 20260829–20270115. This establishes scheduled service, not what a bus will actually do that morning.
- Browser used an isolated account and clock. Early and late provider responses were deliberately simulated and labeled in a banner. Real phone messages and external model/research calls were disabled. No real commute/account preferences were changed.

## Exact 08:15 result

| Preparation | First reachable scheduled bus with these margins | Work arrival estimate | Deadline result |
|---|---|---|---|
| 20 min | 08:53:47 | 09:32 | 10 min late |
| 25 min | 08:53:47 | 09:32 | 10 min late |
| 30 min | 09:05:47 | 09:44 | 22 min late |

The 08:38:47 bus reaches Sutter & Sansome at 09:12 and work at 09:17 with the assumed walk. With a 20-minute preparation allowance and the default walk/boarding margin, its latest start is 08:09:47. It also falls two minutes inside the configured seven-minute arrival buffer. The 30-minute row is sensitive to seconds: the 08:53:47 bus requires starting at 08:14:47, 13 seconds before the test wake time. These strict cutoffs should not be mistaken for real-world precision.

Browser confirmation: setup accepted route 15, the two stops, 09:22, and both 20 and 30 minutes of prep. Today displayed **“No plan yet / No remaining trip fits your deadline and preparation time.”** Its start check-in was disabled. Departures showed bus times without work arrival, lateness, or whether the user could still reach them.

![20-minute preparation result](/Users/emanschool/Fogline/output/commute-demo/0815-no-fit.png)

Machine-readable calculations: [scenarios.json](/Users/emanschool/Fogline/output/commute-demo/scenarios.json).

## Controlled early/late browser checks

Moved only the isolated clock back to 07:30, keeping the route, deadline and default margins, and used 30 minutes of preparation so a feasible baseline existed.

| Feed scenario | Get ready | Leave by | Bus estimate | Work estimate |
|---|---|---|---|---|
| Real schedule baseline | 07:44 | 08:14 | 08:23 | 09:02 |
| Simulated 12-minute late bus | 07:44 | 08:14 | 08:35 | 09:14 |
| Simulated 5-minute early bus | 07:39 | 08:09 | 08:18 | 08:57 |

Times above reflect the UI display, which omits seconds. Simulated updates included both boarding and destination predictions. Refreshing the current app displayed the expected changes. A late prediction did not encourage leaving later, which helps protect against a bus recovering time. This confirms recalculation when checked, not continuous phone delivery.

[Baseline screenshot](/Users/emanschool/Fogline/output/commute-demo/0730-scheduled.png) · [Late screenshot](/Users/emanschool/Fogline/output/commute-demo/0730-delay-12.png) · [Early screenshot](/Users/emanschool/Fogline/output/commute-demo/0730-early-5.png)

## Material gaps

1. **A no-fit result stops automatic retries with reminders enabled.** After the wake check sets wakeRan, the live phase requires a finite selected leave time. The exact 08:15 no-fit scenario has none. Pure scheduler checks at 08:20 and 08:30 returned no work. A subsequent bus change therefore cannot automatically recover the plan. See [agent-schedule.mjs:20](/Users/emanschool/Fogline/server/agent-schedule.mjs:20) and [agent-schedule.mjs:36](/Users/emanschool/Fogline/server/agent-schedule.mjs:36).

2. **There is a preparation-time monitoring gap.** With reminders enabled, the server checks once at wake, then every three minutes starting ten minutes before the recommended leave time. A synthetic timing check (08:15 wake, 08:25 prep start, 08:50 leave) ran at 08:15, then 08:40/43/46. The preparation alert arrived at 08:40, fifteen minutes after its target. The browser's 30-second polling only reads stored state. The separate ten-minute collection loop runs only when reminders are disabled, and sends no reminders. See [main.tsx:44](/Users/emanschool/Fogline/src/main.tsx:44).

3. **The server assumes preparation progress without a check-in.** In [agent.ts:178](/Users/emanschool/Fogline/server/agent.ts:178), a passed recommended start is substituted for an actual start. The browser reproduced this: at 08:05, with no check-in and a 30-minute routine, it continued recommending an 08:09 leave time and showed “I’m starting now.” The pure planner correctly rejects that trip when given the actual unstarted state. It needs to ask whether preparation began or show that catchability is conditional.

   [Screenshot: unconfirmed preparation](/Users/emanschool/Fogline/output/commute-demo/0805-unconfirmed-preparation.png)

4. **The no-fit screen does not answer “which bus and how late?”** The backend computes lateOptions, but Today and Departures omit work ETA and lateness for those options. The assistant can expose options, but the main morning view requires more interpretation than the user requested. See [main.tsx:103](/Users/emanschool/Fogline/src/main.tsx:103).

5. **Prediction confidence is not validated.** There is no calibrated arrival range or on-time percentage. The planner accepts one prep duration rather than a 20–30-minute range. Provider predictions and schedule estimates cannot guarantee punctual arrival. Phone subscription and delivery were not tested; model/research responses were not exercised in this run.

## Recommended next work

- Keep checking throughout the wake-to-arrival window, including after no-fit or unavailable results; respect the existing API budget and cache.
- Schedule preparation reminders at their actual due time.
- Use confirmed prep progress, or ask and show conditional guidance.
- Show reachable bus choices with work ETA, minutes early/late, source age and the reason for choosing them.
- Validate real phone receipt and observe this route across actual service mornings before claiming dependable predictions.

Focused existing journey, reliability, scheduler, commute-selection, and notification tests passed. Additional isolated scenarios exposed the gaps above. No application implementation files were edited in this review.
