# Reliability build status

October 4, 2026. Implemented locally; no production deployment or real phone notification test was performed.

| Area | Delivered | Evidence / remaining gate |
|---|---|---|
| Feed identity | Agency-wide GTFS Realtime trip updates, vehicle positions, and scoped alerts | Sample: 1,188/1,188 updates joined exact active schedule trips; cadence and coverage still need multi-day observation |
| Freshness and budget | Three-minute trip/position caches, producer timestamp checks, shared persistent 55-request/hour budget including schedules | Restart and concurrent-budget tests; UI reports old evidence rather than refreshing its label |
| Correct bus | Trip/date/direction/stop-occurrence matching; known canceled, skipped, and passed stops rejected; stops remaining only with matched progress | Wrong-line/date/direction/passed/skip fixtures pass; missing fields remain unknown |
| Ordered stops | Untimed calls retained, original GTFS sequence retained, compatible direct variants checked | Untimed-stop and variant fixtures pass; untimed boarding/alighting cannot invent a timetable |
| Disruptions | Scoped effective-period service alerts invalidate affected candidates; official SFMTA notices appear as sourced context | Latest ten advisory pages parsed and route/date matched; no claim of exhaustive closure coverage or exact web-notice hours |
| Morning plan | Separate configurable boarding margin; be-at-stop target; downstream predictions; earlier alternative; existing departure target protected from silent postponement | Early/delay-recovery and source separation tests; no statistical arrival range claimed |
| Collection | Bounded, deduplicated, 30-day JSONL archive separate from account; background commute-window checks independent of push setting | Restart deduplication tested; preview archive successfully received real normalized observations |
| Evaluation | Passage intervals, forecast scoring by horizon, chronological historical residual candidate, insufficient-evidence reporting | `pnpm reliability:report`; all candidates remain shadow-only; passage is not verified boarding or exact arrival |
| Reminders | Prepare/leave/material-change categories, boarded check-in, deduplication and superseded-message rejection | Policy tested without sending; actual device receipt and offline pilot remain unverified |
| Editing | Configuration revision separate from background plan revisions | Save after a background check succeeds; a competing configuration edit conflicts |

Validation: 56 tests passed; TypeScript and production build passed. Live source sampling and official-advisory parsing succeeded. Browser preview retains the saved Route 15 commute and shows the separate three-minute boarding margin and explicit uncalibrated status.

Still required before claiming dependable prediction: collect independent journeys across service days, qualify observed outcome quality, evaluate coverage and early-bound failures, validate actionable warning time and class-arrival results, and perform an authorized real-phone pilot. The model is not promoted automatically, even when the offline minimum counts are reached. Current data collection requires the server to stay awake; the request does not create a Codex automation.

Operational limitations: event scraping is bounded to the latest ten official notices; date extraction is an advisory filter, not verification of exact closure hours or recurring weekdays. Six previously identified special services still lack verified schedules. The ledger fails closed if its lock is abandoned; operators must confirm no writer is active before removing an orphan lock. Do not remove the budget ledger to bypass upstream limits.
