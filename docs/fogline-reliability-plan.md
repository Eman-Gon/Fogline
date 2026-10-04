# Fogline reliability and preparation plan

Prepared October 4, 2026. Status: proposal for review. This request changes this document only; it does not implement the prediction system, enable data collection, or send notifications.

The product should help a rider decide when to start getting ready and leave, early enough to catch a usable bus and reach class on time. Success is measured by useful warning time and fewer missed journeys, alongside prediction accuracy. A precise-looking countdown is insufficient.

**1. Scope and current position**

Keep one primary direct Muni commute, the existing account, and Today / My commute / History. Preparation and walking estimates do not require continuous phone location. Use Route 15 as the first acceptance example, then another bus route and a loop/variant case. The implementation must remain general across supported routes.

The current build has ordered route patterns, both trip endpoints, actual service calendars, scheduled planning, persistent device sessions, real check-ins, and basic trip-matched live overlays. It does not yet have a validated arrival predictor or an arrival-observation archive.

Code review identified these prerequisites:

| Current behavior | Required change |
|---|---|
| Live feeds share a ten-minute cache (`server/transit-cache.mjs`) | Separate live freshness policies from schedules and allocate one upstream request budget |
| `RecordedAtTime` is parsed but planning checks fetch age (`server/journey.mjs`) | Track producer observation time, receipt time, and validity separately |
| Match uses route, trip string, optional direction | Add service date, stop occurrence, confirmed progress, and cancellation/skip checks |
| Current delay is carried unchanged to destination | Use downstream stop predictions or an explicitly uncertain travel-time estimate |
| Alerts preserve text and route IDs | Preserve effective periods, stop/trip scope, effects, source, and expiry |
| Planner selects only an exact saved pattern | Admit compatible variants only after verifying both stops, order, direction, service date, and boarding rules |
| Importer omits calls missing explicit arrival/departure times and discards original sequence numbers | Preserve untimed stop occurrences and original source sequence; keep interpolation, where valid, separate from observed times |
| Account is saved as a whole document | Keep frequent transit observations outside that document and its edit revision |

**2. What the rider sees**

Today should answer four questions immediately: when to prepare, when to leave, when the bus may reach the boarding stop, and when the rider may reach class. Show one current action and a short explanation of any meaningful change. Expand the map, stops remaining, evidence, earlier-trip alternative, and source timestamps on demand.

Illustrative values only: a bus scheduled for 9:40 has a validated estimated boarding-arrival range of 9:35–9:46. With a three-minute boarding margin, seven-minute walk, and 35-minute preparation estimate, recommend being at the stop by 9:32, leaving by 9:25, and starting at 8:50. This example does not establish the real range for any route. A separate destination-arrival check determines whether that bus can meet the class deadline.

Before there is enough evidence for a range, show “Scheduled 9:40; early arrival uncertainty unknown; using your precautionary boarding margin.” Do not rename an arbitrary buffer a confidence interval.

**3. Milestone A — Qualify the feeds and fix freshness**

Inspect representative SF trip updates, vehicle positions, and stop monitoring against the imported static schedule. Measure actual update intervals, prediction horizon, source timestamps, field coverage, and join success. Record anonymized/public-transit fixtures with no account key. Confirm whether the chosen feed supplies cancellation, skipped-stop, progress, and departure fields. Absence means unknown, not normal service.

511 offers static schedules, trip updates, vehicle positions, and service alerts. Its documented default is 60 requests per token per 3,600 seconds; the actual token allowance still needs confirmation. Three feeds every minute would require 180 requests per hour. Bulk feeds should be fetched once server-side and shared by all screens and paired devices. [511 documentation](https://511.org/open-data/transit)

Use one scheduler and rolling budget for archive refreshes, all live calls, retries, diagnostics, and browsing. Honor throttling and backoff, reserve capacity, and avoid a restart creating a new unbounded request burst. Remove redundant stop-timetable requests when the static archive already answers them. Do not put upstream fetches inside the account write queue.

Choose polling after measuring provider cadence and quota. A possible budget illustration is 20 trip-update, 20 position, six alert, and one archive request per hour, totaling 47 before retries. This is an accounting example, not an assertion that three-minute observations are sufficient for close boarding decisions. Faster updates near departure require available budget, a richer combined feed, or a higher allowance. Public endpoints must not starve the saved commute's updates.

The UI must distinguish “received recently” from “vehicle observed recently.” Unknown, old, contradictory, or future-dated timestamps reduce data quality. A locally animated countdown does not refresh the evidence.

Completion gate: a replayable feed report shows supported fields, join rates, actual ages, prediction horizons, and request costs. Repeated old source data cannot become “live” after refetching. The required freshness must be achievable under the confirmed allowance before close-arrival guidance is released.

**4. Milestone B — Establish whether this bus will serve this stop**

Introduce a normalized trip instance keyed by agency, source trip ID, service date, and start time where required. Associate the schedule version and route pattern. Keep the original GTFS stop sequence as well as the UI occurrence index; loops and repeated stops must stay distinguishable. Do not join unrelated feeds by stripping arbitrary ID suffixes or matching headsign text.

For a recommended vehicle, verify the trip serves the boarding and alighting occurrences in order, boarding/alighting is allowed, the boarding occurrence has not already been passed, and no applicable cancellation or skip is known. Missing direction can be resolved from a uniquely joined trip; otherwise the match remains unknown.

Prefer explicit current-stop sequence/status. If unavailable, map-match successive observations to the route shape with continuity and direction constraints. One nearby GPS point cannot prove that a bus is approaching or stopping. Label inferred progress; show “stops remaining unavailable” when it is ambiguous. A vehicle change or disappearing prediction does not by itself prove cancellation.

Retain arrival and departure predictions separately. Waiting for arrival is different from predicting the last opportunity to board. If departure or door-close evidence is unavailable, use conservative arrival-based guidance and state the limitation. Seats, capacity, and successful boarding remain unconfirmed unless supported by fresh evidence.

GTFS Realtime defines timestamps, canceled trips, and skipped-stop states; the local feed must still be checked for their presence and correct interpretation. [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/)

Completion gate: mixed lines, opposite directions, shared loops, repeated stop IDs, untimed intermediate stops, different service dates, short turns, passed stops, canceled trips, and skipped stops all fail safely in fixtures. A verified matching trip can expose progress without inventing it.

**5. Milestone C — Collect evidence and detect disruptions**

Start observational collection as soon as A and B pass, while the remaining product work proceeds. Limit initial collection to relevant routes and time windows; this cannot yield a citywide reliability claim. Keep collection health independent from whether the rider has enabled phone reminders.

Persist five separate record types:

| Record | Essential contents |
|---|---|
| Transit observation | Source and observation timestamps, receipt time, trip instance, vehicle, stop occurrence/progress, predictions, positions, and quality flags |
| Stop outcome | Arrival/departure time or time interval, observation method, quality, and unresolved/canceled/skipped status |
| Forecast | Creation time, 5/15/30/45/60-minute lead bucket, input references, model version, range, and data-quality reasons |
| Disruption | Source URL/ID, publication/update time, effective interval, affected direction/routes/stops, effect, alternatives, and evidence strength |
| Plan revision | Target trip, boarding and destination estimates, preparation/leave recommendation, explanation, and notification state |

A prediction must never be stored as the actual arrival simply because it became due or disappeared. Prefer explicitly documented actual events if available. Otherwise use consecutive verified vehicle observations to infer a bounded passage interval. GPS passing a stop does not prove passenger boarding. User “I boarded” taps are useful secondary evidence; current “I arrived at class” check-ins are not bus-arrival labels. Preserve uncertain intervals and missing outcomes rather than filling gaps with forecasts.

Use official scoped alerts first, followed by SFMTA travel advisories and stop-relocation notices. Link event impact to the actual route segment, stop, direction, and travel time. Match street closure times separately from festival opening times. Distinguish a closed stop, reroute, expected crowding, and a nearby event with no confirmed transit effect.

For example, SFMTA's October 4 Castro Street Fair advisory lists route/direction-specific service periods, missed stops, and alternate boarding locations. That is the information Fogline should extract, rather than just a festival name. [Official example](https://www.sfmta.com/travel-updates/castro-street-fair-sunday-october-4-2026)

Confirmed closure invalidates the affected candidate. A usable alternative requires verified stop identity/service and updated walking time; never silently change the saved commute. Uncertain event information may produce a sourced caution but must not add an invented number of delay minutes. Text extraction can assist, but ambiguous notices remain advisories until validated.

Keep bulk transit observations out of the personal account JSON and omit user GPS and secrets. Use a separate append-only store with indexes/partitions and bounded retention. Proposed retention starts at 30 days of raw snapshots and 180 days of compact quality-scored outcomes and forecasts, subject to measured storage cost. Feed-version provenance must survive aggregation. Preserve the account's existing migration and backup approach.

Completion gate: collection survives restart without duplicate observations or account revision conflicts. Canceled/no-data/passed events remain distinct. A known closure changes the recommendation; an irrelevant or expired festival does not.

**6. Milestone D — Deliver useful preparation guidance before a learned model**

Ship a clearly labeled baseline using official schedules, verified provider predictions, disruption rules, and separate boarding/class buffers. Preserve the current precaution of not postponing departure automatically merely because a bus is predicted late.

For every valid candidate, calculate two risks separately: missing boarding and reaching class late. Prefer downstream stop predictions for the alighting time; otherwise label the travel-time assumption and its uncertainty. A bus may be easy to catch but too late for class.

Once a defensible early boarding-arrival bound exists, calculate:

```text
be_at_stop_by = early_arrival_bound - boarding_margin
leave_by     = be_at_stop_by - conservative_walk_duration
start_by     = leave_by - conservative_remaining_preparation
class_check  = later_destination_arrival_bound + destination_walk + class_buffer
```

The early bound is a chosen lower quantile, not an absolute earliest possible time. A proposed starting policy is a 5th-percentile boarding bound and 95th-percentile destination bound, validated separately. These two marginal targets do not imply 95% overall journey success. When there is no calibrated bound, use scheduled time plus an explicit precautionary margin and do not show a probability.

Show an earlier compatible departure if the preferred one looks risky. If none fits, say the deadline is at risk. When a rider has already started preparation, use remaining preparation rather than moving the original start time. When already walking, prioritize reachability and next feasible trips rather than a new shower/preparation instruction. A delayed bus can recover time, so delaying an already-communicated departure needs stronger evidence and an explicit rider choice.

Completion gate: the same plan revision drives Today, speech, and reminders. Replays cover early arrival, delay recovery, insufficient preparation time, already walking, canceled service, and a class deadline that no remaining trip can meet.

**7. Milestone E — Add a model only where it improves decisions**

Establish three benchmarks: schedule with a fixed precautionary margin, current official predictions, and an empirical model grouped by route/pattern, stop, weekday, time band, and forecast horizon. Compare them on the same known outcomes.

Start with conditional historical error distributions and segment/dwell times. When exact-stop data is sparse, broaden cautiously to comparable segments and increase uncertainty; do not assign confidence simply because many rows exist elsewhere. With sufficient independent trips, assess a quantile regression model using progress, recent segment speeds, scheduled travel time, time/day, source age, and validated disruption flags. A language model should not generate numeric arrival times.

Forecasts made 45 minutes before boarding need different evidence and uncertainty from forecasts made five minutes before boarding. Before a vehicle starts or has a verified assignment, rely on schedule/history and explicitly show that live progress is unavailable. Predict destination arrival separately; do not blindly add the same delay to every later stop.

Evaluate on later, held-out service dates. All observations of one trip stay in the same split. Features must use only information available at forecast time, including the publication time of event notices. Freeze and retain the forecast before scoring it. Repeated polls of one trip are not independent samples.

Measure interval coverage AND width, early-bound failures, error by lead time, actionable warning lead time, unnecessary early waiting, alert count, and how often the advice would have missed boarding or class. For uncertain observed outcomes, use interval-aware scoring or exclude them from exact-time error metrics and disclose exclusions.

Proposed promotion rule: a nominal 90% displayed arrival interval should show roughly that coverage on sufficiently independent held-out journeys in the relevant horizon/route groups, with useful width; lower-bound failures should be consistent with the chosen boarding target; the complete plan should improve missed-bus risk over benchmarks without unacceptable extra waiting. Report sample counts and statistical uncertainty. Final minimum sample counts and tolerances are selected from the pilot's coverage, not invented today. Do not promote a model on average error alone or on a few successful mornings.

Completion gate: publish a reproducible evaluation report, retain the previous version for rollback, and expose model estimates only for route/horizon groups that pass. Others continue with transparent baseline guidance.

**8. Milestone F — Reminders, pilot, and maintenance**

Use durable journey states: planned, preparing, walking, boarded, completed, and abandoned. Add optional “I boarded” feedback. Deduplicate preparation, leave, earlier-arrival risk, closure, and missed-trip notifications by journey and plan revision. Avoid tiny ETA-change alerts. Start with a configurable three-minute material-change threshold, while confirmed closure/cancellation and crossing the leave-now threshold bypass ordinary suppression. Tune this using replay and rider feedback.

Acknowledge/quiet controls must not hide the on-screen warning. Discard notifications whose underlying plan was superseded. A server-provider receipt is not proof the phone displayed the notification. Test actual delivery, permission state, offline recovery, and restart without repeated alerts during an explicitly authorized phone test. Keep reminders off by default for a test account.

Run new forecasts in shadow mode first: store and score them while the rider still sees the baseline. Move to a labeled personal pilot, then promote only passed route/horizon groups. Data collection time depends on independent usable journeys and missingness; implementation completion alone cannot establish model readiness.

Routine maintenance should require no daily rider setup. Refresh schedules automatically, check saved stops after feed changes, expire old advisories, monitor missing observations and request budget, and track errors by route/time/horizon. Retraining produces a candidate that must pass the same evaluation; it does not replace production automatically. If data or model quality drops, widen uncertainty or return to the labeled baseline. Retain backups and test restoration.

**9. Delivery sequence and boundaries**

| Delivery | Concrete reviewable result |
|---|---|
| A | Feed capability report, freshness policy, and shared quota design |
| B | Correct trip/stop/progress adapter and adversarial fixtures |
| C | Separate observation archive plus official disruption handling |
| D | Preparation/leave planner, explicit uncertainty, and simple Today view |
| E | Historical baseline, optional improved model, and held-out evaluation |
| F | Consistent notifications, authorized device test, shadow/pilot report, and maintenance controls |

Collection begins after feed qualification and continues while C/D are built. D provides useful labeled guidance before E is ready. C's disruption parsing and D's UI can progress in parallel once the normalized data contract exists. Do not attach a promised accuracy or launch date to a model before the data gates pass.

Keep citywide predictive-coverage claims, transfer routing, other agencies, speculative festival-delay penalties, automatic calling, always-on personal location collection, and new AI dashboards outside this first release. Unsupported special services remain visible with their limitations. Prioritize a dependable direct commute over extra panels.

**10. Implementation map**

Extend `server/transit.mjs` and `server/transit-cache.mjs` for normalized live inputs, freshness, and scheduling. Extend `server/gtfs.mjs` for stable stop-sequence/service provenance. Add separate observation, disruption, forecasting, and replay-evaluation modules. Extend `server/journey.mjs` for arrival bounds and candidate choice; `server/agent.ts` and `server/notifications.ts` for one durable plan and delivery decisions; `src/commute-types.ts` for provenance/uncertainty; and `src/main.tsx` / `src/CommuteSetup.tsx` for the four primary answers and simple settings.

Use a single versioned plan response containing trip instance, boarding/alighting stop occurrences, schedule and estimated ranges, source ages, quality reasons, start/leave targets, alternative trip, applicable disruptions, and model version. Store the evidence references needed to explain and replay it. No screen should calculate its own independent ETA.
