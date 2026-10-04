# Fogline: a Muni agent that tells you when to start your shower

> Product vision, not an implementation inventory. As of October 4, 2026, the code includes a guided stop map, deterministic planning, Neon/local account storage, Mastra Gateway corrections, Exa research, and optional ntfy pushes. Calls, reliable full-morning timetable coverage, learned transit risk, and verified phone automation remain future work. See [README](README.md) and [architecture](architecture.md) for current behavior. The example probabilities, schemas and framework choices below describe intended work.

Working name. Alternatives: Snooze Bus, Bus Factor, Maybe Muni.

**One-liner:** Google Maps tells you when the bus comes. Fogline tells you when to get in the shower.

## The problem

I wake up half asleep. I need a shower plus 20 to 30 minutes to get ready, and the Muni is rarely when it says it will be. So I either leave too early or watch my bus leave. Maps only helps once I am already ready to go. The problem starts at wake-up.

## What it does

When my alarm stops, my phone asks the agent for a briefing. The agent has already checked live Muni data, service alerts, and the web for incidents along my route and near my destination. It tells me:

1. When to start my shower.
2. When to leave the house, and which train to aim for.
3. My estimated chance of arriving on time, and whether leaving earlier is worth it.
4. Any reported problems along the route, and where they are.

Example (numbers are illustrative): "Start your shower at 7:34. Leave at 8:09 for the 8:15 T. About 80% chance you are there by 9:00, based on 14 similar rides plus a 6 minute current delay. Leaving at 8:01 for the 8:07 raises that to 93%. One unconfirmed report of a stalled train near Duboce, 3 stops before yours."

If I do not respond, it escalates: push notification, then a phone call (press 1 if you are up, press 2 for 5 more minutes).

## Decisions locked in (Oct 4, 11:37 AM)

- TypeScript end to end: Mastra for the agent, a React dashboard with Assistant UI and the map.
- Run on the laptop with a public tunnel today. Deploy to Fly.io only after the demo works.
- Seed ride history and simulate the delay for the demo, and say so on screen and in the video.
- Public repo from the start, with the 511 key in `.env` only.
- Map: Leaflet with free tiles (no API key, no billing). MapLibre is an optional upgrade, not a requirement.
- Front end: a mobile-first web app opened in Safari and added to the home screen (a PWA), not a native iOS app. My Mac and phone are not fully updated, and a native app would eat the afternoon. Prototype: `fogline-app.html`.

## Why it is an agent, not a script

- A loop decides when to check, when a delay is worth waking me for, and when to ask a question instead of guessing.
- It reads free-text corrections ("I need 45 min tomorrow", "skip tomorrow, working from home") and updates the plan.
- The model never does arithmetic or invents probabilities. A deterministic function computes the plan and the odds, and the model reports them.
- Every number is labeled live, scheduled, or learned, with its age. Web findings are labeled reported or unconfirmed.
- A verifier step checks that every spoken number matches the function output before anything is sent.

## Why it is hard to replace

- Maps start at departure and give everyone the same estimate. Fogline starts at wake-up.
- My own data compounds: real ride history, measured prep time, and the logged gap between scheduled and actual arrivals at my stop. A fresh tool does not have it.
- It acts without being asked, and learns from corrections.
- It says what it confirmed and what it is guessing.
- Honest limit: any big company could copy a feature. The pitch is the personal, backward-planning, data-compounding angle.

## One-time setup

Saved once in Postgres (`commute_profile`):

```yaml
line: T
board_stop: <boarding stop>
dest_stop: <destination stop>
direction: <inbound or outbound>
arrive_by: "09:00"
wake_time: "07:30"
walk_to_stop_min: 6
dest_walk_min: 5
shower_min: 10
prep_min: 25
```

Everything else is fetched or learned: scheduled departures and ride time from GTFS, live delays from 511, lateness history from logged rides, and real prep time from my taps. The profile can be filled in by form, by chatting with the agent, or by tapping home, stop, and destination on the map (see the map section).

## The planning math (plain code)

```
needed_off_bus   = arrive_by - dest_walk
latest_arrival   = needed_off_bus - lateness_buffer      # buffer = 80th percentile of logged lateness
latest_departure = latest_arrival - scheduled_ride_time  # pick the latest scheduled trip that fits
leave_home       = latest_departure - walk_to_stop
shower_start     = leave_home - prep - shower
```

Also computes the latest safe alarm time, and warns if the 7:30 alarm is too late for the plan. If I give a deadline instead of a specific bus, the agent picks the best scheduled trip each morning.

## The risk estimate (no trained model)

A simple statistical estimate over logged rides, not a trained model. It is explainable ("78% based on 14 similar rides, plus 6 min current delay") and honest about small samples.

1. Log every commute: scheduled time, actual time, delay, line, hour, weekday.
2. Bucket by line, hour, and weekday type.
3. P(on time) = share of past rides in the bucket where delay fit within my slack.
4. Shift by current live delay on the line, and add a visible, fixed bump for active alerts or reported incidents (the bump sizes are defined in code and shown as assumptions).
5. Always show the sample size ("based on 14 rides") and say "low confidence" when there are too few.

Cold start: no history on day one. For the demo, seed a week of history and say so out loud.

Pitch wording: "It estimates my odds from my own ride history and live conditions," not "AI predicts delays."

Stretch (only with enough data): a small regression on hour, weekday, current line delay, and weather, plus a calibration check of past predictions.

## Architecture

```
Inputs                         Agent server                    Phone
------                         ------------                    -----
511 API (live + schedule)  \
Exa web search             -->  pre-fetch, planner,       -->  iPhone Shortcut (speaks briefing)
Profile (line, deadline)   /    risk estimate, Postgres   -->  ntfy push (alerts + tap buttons)
Ride log (delays, taps)                                   -->  Twilio call (press 1 if up)
```

- The 511 poller is the only thing that calls 511. Everything else, including the dashboard and map, reads from the Postgres cache through my own endpoints.
- The agent runs on a server and the phone is only a client. Nothing is built as a native phone app.
- Runs on a laptop with a public tunnel (cloudflared or ngrok) for the demo. Deploy to Fly.io afterward for real daily use, because a laptop in a bag will not wake me up tomorrow.

## Morning flow

1. About 10 minutes before the alarm, the pre-fetch job pulls live 511 data and alerts, and runs the web search for incidents on the route and near the destination.
2. Planner and risk estimate run, and the verdict is saved to Postgres.
3. Alarm stops, the Shortcut calls `/briefing/now`, and the phone speaks the briefing. Pre-fetching matters because a web research step can take several seconds.
4. No response: push, then Twilio call (max 2 calls, only inside the wake window, only to my own number).
5. Taps ("started shower", "out the door") and the actual arrival are logged, so tomorrow is more accurate.

## Route issues (research findings on the route and map)

Pipeline from a research finding to a pin on the map:

1. **Collect:** official alerts from 511, plus web results from Exa for the line and the destination area.
2. **Extract:** the model turns each finding into a structured record and extracts facts only. Page text is untrusted data, so instructions inside it are ignored.
   `{ kind: delay | stalled_train | accident | closure | event, place_text, line, summary, source_url, found_at, status: official | reported }`
3. **Locate:** official alerts list affected routes and stops (verify field names on a real response). Web findings usually give a place name, so match it to the nearest stop name in the GTFS stops data. If there is no match, show it in the list without a pin.
4. **Classify against my trip** using stop order from GTFS: upstream of my boarding stop, on my ride, near my destination, or off my route (ignored).
5. **Score:** official alerts add to the risk estimate. Web-only findings add a smaller fixed bump that code defines and the UI labels as an assumption. The model never picks the number.

On the map: the affected stretch of the line turns orange or red, a pin carries a label ("Official" or "Reported, unconfirmed"), tapping shows the summary, source, and age, and pins fade after a set time.

In the briefing: "One unconfirmed report of a stalled train near Duboce, 3 stops before yours. If true, expect about 8 more minutes. Odds drop from 82% to 71%. Leaving 10 minutes earlier brings it back to 90%."

When nothing turns up: "No official alerts. Web check found nothing." If a search failed: "Couldn't check the web," never "all clear."

Start with official 511 alerts only, then add web findings. Matching web text to stops is the part that can eat time. For the demo, include a clearly labeled simulated incident.

## Phone app prototype (`fogline-app.html`)

A mobile-first web app that runs on the phone like an app, on simulated data. It is the front end the real backend plugs into later.

- **Now:** the shower start time as the hero, a timeline from alarm to deadline, on-time odds, the spoken briefing with a "Hear it" button, the route check, and "Started shower" and "Out the door" buttons.
- **Map:** tap to pin home, boarding stop, and destination. Same pin dropping as `fogline-map.html`.
- **Log:** simulated ride history and my taps.
- **Setup:** alarm, deadline, walk, shower, prep, ride length, and line. The plan updates as I type.
- **Demo controls** (top bar): a pretend clock, how late the bus is, a simulated incident toggle, "jump to shower time", and reset. A "Simulated data" label is always visible.
- **Design:** the background moves from dark pre-dawn navy to pale fog as the pretend clock passes about 7:20 to 7:50 AM. One accent, bridge orange, used for the shower time. Timetable rows instead of cards. Barlow and Barlow Condensed fonts load from Google Fonts and fall back to system fonts.
- **Planner and risk math** run in the page with the same formulas as above, plus two assumptions shown on screen: the shower moves later for a late bus by that delay minus 2 minutes (predictions change), and an unconfirmed incident counts as 50% likely and adds 5 minutes if real.
- **Feedback loop works:** Started shower, move the pretend clock, Out the door. The prep estimate moves toward the measured time (weighted 3 to 1 toward the old value) and the tap is logged.
- State is saved in the browser (localStorage).

**Run it on the phone:**
1. In the folder with the file: `python3 -m http.server 3000`
2. In a second terminal: `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`)
3. Open the https URL in Safari on the phone. For an app-like icon, Share, then Add to Home Screen.
4. The page needs internet for the map library, map tiles, and fonts.

**Tested so far:**
- The planner math in Node. Default inputs give a 7:34 AM shower, 8:09 leave, the 8:15 T, and 93% odds, matching the example above. A 12 minute delay gives 0% odds, and an impossible deadline returns no plan.
- The page in headless Chrome at iPhone size with no script errors, including the tap-learning flow (a 41 minute shower plus prep moved the prep estimate from 25 to 27 minutes).
- Not tested: real iPhone Safari, the Map tab (the test environment could not load the map library), and the Barlow fonts.

**Not connected yet:** real 511 data, GTFS, Exa, real ride history, real stops, and phone calls. The plan is to replace the simulated values with responses from `/briefing/now`, `/route`, `/vehicles`, and `/incidents`, and keep demo mode as the fallback and replay.

**Why not a native app:** Xcode needs a recent macOS, and I believe a free Apple ID install expires after about a week. The wake-up already works through the Shortcut, ntfy, and calls, so a native app would only replace the dashboard.

## Map

**Built so far:** `fogline-map.html`, a standalone page with Leaflet and free CARTO light tiles (OpenStreetMap data). It opens close up on San Francisco, supports zoom, pan, and pinch, lets me tap to drop home, boarding stop, and destination pins, and lets me drag pins. It shows coordinates and straight-line distance, remembers pins in the browser, and has a "My location" button. The script passed a syntax check, but I have not tested it in a browser yet. Geolocation is often blocked on a file opened from disk and works over https or localhost.

**Not built yet:**
- Snapping pins to real Muni stops (needs the GTFS stops data)
- T line route, vehicle dots, delay coloring, incident pins (need my own `/route`, `/vehicles`, `/incidents` endpoints)
- Walking route, travel time, and the "leave by" badge (needs the planner)

**Tiers to add, in order of value:**
1. Cheap: route polyline and stops from GTFS `shapes.txt` and `stops.txt`, vehicle dots colored by delay with an "updated X ago" label, boarding stop highlighted with the next train ETA, "leave by" badge on the home pin.
2. Medium: line from the approaching train to my stop with a live ETA, incident pins, replay slider (labeled as a replay).
3. Harder, only if ahead: risk coloring per segment (needs per-stop delay data, and Muni's downstream predictions may not be complete), real walking route (needs a routing service).

**Rules:**
- The browser never calls 511. The map reads only from my own endpoints.
- Do not animate trains smoothly as if live. 511 polls are at best one or two a minute, so label interpolated positions as estimated.
- Check the tile provider's usage terms before deploying publicly.
- I did not verify licenses for any map project. Leaflet and react-leaflet are the libraries to use, and the map layer is original code.

## iPhone Shortcut

Automation tab, new Personal Automation, Alarm, "Is Stopped", Run Immediately (turn off "Ask Before Running"). Then: Get Contents of URL (`/briefing/now?token=...`), Get Dictionary Value (`speech`), Speak Text. Add an If step that speaks a fallback ("Couldn't reach the agent. Check your phone for the push.") when the request fails. Have the server return the full sentence so the Shortcut stays three steps. Action names vary by iOS version, so verify on the phone. Test by setting an alarm 2 minutes out and stopping it.

Phone-side alarm trigger fires only when scheduled, so use the briefing as the baseline and the push and call for changes after that.

## Testing from the phone

- The phone cannot reach `localhost`. Use a tunnel (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) to get a public https URL, and test over cellular once.
- The same-Wi-Fi local IP works only for the dashboard, and event Wi-Fi often blocks it.
- Free tunnel URLs change on restart. Keep the tunnel running, and update the Twilio webhook and the Shortcut if it restarts.
- The URL is public, so every endpoint needs a secret token.
- Add a "simulate" endpoint or button that fakes a delay and sets shower time to 2 minutes from now, make wake windows and escalation timings config values, and keep a dry-run flag that logs instead of sending.
- Test order: push alert, dashboard on the phone, simulated delay triggers a push, Twilio call and keypress, Shortcut alarm last.
- Things that quietly break phone tests: Do Not Disturb and Sleep focus (allow ntfy and the Twilio number), "Ask Before Running" on the automation, Low Power Mode delaying background automations. Twilio trial accounts only call verified numbers and play a short trial message first.

## Feature list

**Core**
- Backward planning from the deadline
- Live arrivals and alerts from 511 with confidence labels
- Risk estimate with sample size
- Route check with Exa, labeled reported or unconfirmed
- Alarm-stopped briefing, push alerts with tap buttons

**Feedback loop**
- One-tap "started shower" and "out the door"
- "Did you take the T today?" check-in
- Free-text corrections
- Nightly postmortem and weekly pattern digest

**Alerts**
- Escalation ladder: push, urgent push, phone call
- Missed-bus recovery with the next best option
- Running-late draft message

**Honesty and trust**
- Live, scheduled, learned labels with age
- Source-health strip (last successful call, calls left this hour, stale warning)
- Verifier step and a visible decision log

**Map (Best UI)**
- See the map section for what is built and the tiers to add

**San Francisco touches**
- Local voice and a name, optional Spanish alerts
- Fog and microclimate forecast by neighborhood, rain adds walk time
- Hill-adjusted walk times, bunching detection, subway vs surface handling
- Event disruptions via Exa

**Stretch**
- Calendar-aware deadlines, iOS alarm automation, inbound phone line (needs speech in and out each turn, so skip today)

## 511 API notes

- Free key at 511.org/open-data/token. Default limit is 60 requests per hour per key. Request an increase by email (do not include the key in the message).
- Muni agency code is `SF`. Useful endpoints: StopMonitoring, VehicleMonitoring, GTFS-realtime trip updates, vehicle positions, and service alerts, plus static GTFS and stops. Verify field names (for example aimed vs expected arrival) on a real response.
- Budget: alerts every 5 minutes, arrivals every 2 to 3 minutes only during the commute window, keep a reserve for the demo. Poll once, cache in Postgres, never call 511 from the browser. Download static GTFS once.
- Going over the limit returns HTTP 429, not a documented ban, but stay under it. On a 429, back off and serve cached data labeled stale. Never retry in a tight loop.
- Predictions are not always accurate. A bus can be far away while its expected arrival has not updated, which is why Fogline logs real lateness and labels uncertainty.
- Keep the API key in `.env`, never in the repo, especially since the repo is public.
- The T is a Muni Metro line. Confirm that live predictions appear for the exact boarding stop code before building on it. This is the biggest early risk.
- Pre-warm the cache and record a real response before the video, and have replay mode ready as a backup.

## Build order (updated 11:37 AM)

Hacking runs 10:30 to 1:00 and 1:45 to 4:30. Lunch is 1:00 to 1:45.

| Time | Task | Done when |
|---|---|---|
| 11:36 to 12:15 | Keys (511, Neon, Exa), claim credits, Mastra scaffold, Postgres tables, test that 511 returns live predictions for my exact T stop | One real response in hand |
| 12:15 to 1:00 | GTFS load for my stop, planner function with my numbers, poller writing to `arrival_log` | Planner prints a correct shower time, rows accumulating |
| 1:45 to 2:20 | Seeded history, risk estimate, `/briefing/now` returning the spoken sentence | `curl` returns a briefing |
| 2:20 to 2:50 | iPhone Shortcut on alarm stop, ntfy push with the two tap buttons, over the tunnel | Stopping an alarm makes the phone speak the plan |
| 2:50 to 3:20 | Exa route check, labeled reported or unconfirmed, folded into the briefing and the risk | Briefing mentions an incident or says "none found" |
| 3:15 to 3:40 | Wire `fogline-app.html` to the real endpoints: replace simulated values with `/briefing/now`, add the source-health strip, map route and pins, keep the "simulate delay" controls | One phone screen shows the whole story |
| 3:40 to 4:00 | Freeze features, record the 3 minute video, label seeded and simulated parts | Video recorded |
| 4:00 to 4:20 | README, `.env.example`, public repo, upload, submit | Submitted with a 10 minute buffer |

**Gate at 12:15:** if live T predictions do not appear for my stop, switch to scheduled times plus logged lateness and label it that way. Do not spend an hour debugging the feed.

**If ahead, add in this order:** incident pins and delay-colored vehicles on the map, Twilio call with keypress, SF voice and fog forecast, AgentMail evening email, Fly.io deploy.

**Cut order if behind:** Twilio call, map layers beyond pins and route, Exa, dashboard polish. The slice through the Shortcut briefing is a complete, honest demo.

## Pitch (2 minutes)

- **0:00 The problem:** sleepy mornings, the bus is never on time, Maps only helps once I am ready.
- **0:25 What it does:** works backward from my bus and tells me when to start my shower.
- **0:45 Why it is an agent:** a loop decides when to check and when to wake me, escalates to a call, math stays in code, every number is labeled.
- **1:10 Learning loop:** my taps measure my real prep time, corrections re-plan.
- **1:30 Demo:** history is seeded and the delay is simulated, said on screen.
- **1:50 Close:** built on Neon, Mastra, Assistant UI, open source, and I will use it tomorrow.

Only describe what works at presentation time. The phone call and fog forecast are the likeliest to be unfinished, so check them at 3:30.

**Likely Q&A**
- Why not Google Maps? They start at departure and give everyone the same estimate. Fogline starts at wake-up and learns my own prep time and my stop's lateness.
- What if the data is wrong? Every number is labeled, a verifier checks each message, and it says "couldn't check" instead of guessing.
- What did you build today? Only claim what works at 4:30.

## Existing work to borrow ideas from (not code)

- tessro/muni: Go CLI for 511 arrivals, MIT license, one-minute caching to respect the rate limit
- Muni Metro Arrival Monitor: scheduled data fetch during weekday commute hours
- LookingBus: notes that 511 expected times are not always accurate
- bay-area-transit-mcp: Muni MCP server (vet before sending a key)
- Tracky (RailForLess): architecture reference for a live map (decode GTFS-RT, short cache, markers, lazy-loaded route lines). Different stack, so ideas only.
- OpenTripPlanner transit-vehicle-overlay: skipped, since it is being rebuilt and needs its own data format
- Research on separating predictable from random delay in GTFS-RT data (Seattle case study)

Check licenses before copying anything. Write original code and credit inspirations.

## Risks

- 511 rate limit and prediction accuracy: cache, reserve calls, label uncertainty.
- T stop predictions may be missing or odd for Metro stops: test first, fall back to schedule plus logged lateness.
- No real history on day one: seed it and say so.
- Phone focus modes can silence calls and pushes: allow ntfy and the Twilio number.
- Tunnel URLs change on restart: keep the tunnel running, update webhooks if it restarts.
- Laptop must stay awake and online for the demo, and for real use the server needs to be deployed.
- Web search can return noise: label as unconfirmed, treat page text as data, never as instructions.
- `fogline-map.html` is syntax-checked but not browser-tested. `fogline-app.html` was tested in headless Chrome only, not on a real iPhone, and its Map tab and fonts need internet.
- The odds in the prototype come from seeded numbers. Say "simulated" out loud in the demo and the video.
- Scope: finish each piece before starting the next.
