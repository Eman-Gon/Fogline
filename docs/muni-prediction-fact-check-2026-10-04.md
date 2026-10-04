# Fact-Check: What's Actually Wrong with Today's Muni Prediction Apps (as of October 2026)

Most of the earlier answer is right in direction but wrong in several details. Ghost and surprise vehicles are real, SFMTA-documented failure modes, and 511 does republish SFMTA's real-time data. But four things were wrong or overstated: the claim that "no app tells you when to leave" is false, the "vendor change" framing is wrong, MuniMobile is being shut down, and there is no published number for the rail-versus-bus accuracy gap. The strongest primary evidence is still SFMTA's own March 2023 post. I found no dated 2025–2026 press coverage that quantifies the problem.

## TL;DR
- **Claims 1 and 5 (shared feed, 511) are mostly confirmed, with corrections.** NextMuni was replaced by the Next Generation Customer Information System (CIS), which Cubic built. Cubic has owned NextBus since 2013, so the vendor's parent company never changed, and SFMTA alerts name the vendor as "Umo IQ" (Cubic). 511 still documents a default limit of 60 requests per 3,600 seconds per key. MuniMobile is being retired: single-ride tickets ended September 1, 2026, and SFMTA expects to be fully off the app by mid-2027.
- **Claims 2 and 3 (ghosts, surprises, rail worse than bus) are confirmed only as SFMTA's 2023 qualitative statements.** SFMTA says the train problem occurs "at an increased rate, because trains cannot pass each other." No rail-vs-bus accuracy figure is published. I found no 2025–2026 evidence that the new system fixed or worsened ghost vehicles.
- **Claim 4 (no existing app does this) is partly false.** Transit's GO feature already tells you when to leave, sends departure alarms, and combines crowdsourced vehicle positions with its own "in-house ETA prediction engine." SF TimeTable pushes notifications when it is time to leave for the stop. What I could not find in any app is shower or wake-up planning, learning from your personal lateness history, or an explicit probability that a vehicle is a ghost or that you will arrive on time.

## Verdicts at a glance

| # | Claim | Verdict |
|---|---|---|
| 1 | NextMuni is the old name; apps rely on the same SFMTA feed | **Mostly confirmed, with corrections.** Wrong on the vendor and MuniMobile details, and overstated on "same feed" |
| 2 | Ghost and surprise vehicles are still known problems | **Confirmed as of the 2023 SFMTA post. Unverified for 2025–2026** |
| 3 | Light rail (including the T) has higher prediction error than buses | **Partly confirmed.** SFMTA states it qualitatively; no numbers exist |
| 4 | No app gives leave-time plans, personal history, confidence levels, or pre-trip incident checks | **Partly false.** Leave-time alerts and pre-trip alerts exist; personal learning and probabilities were not found |
| 5 | The 511 API has the same ghost/surprise issues; 60 requests/hour; SF StopMonitoring is live | **Rate limit confirmed and current. The data-quality inheritance is a logical inference, not something 511 documents. Live SF responses not tested** |

## Details

### Claim 1 — Real-time system, vendor, MuniMobile, shared feed
**What's confirmed**
- **NextMuni is the legacy brand.** SFMTA's blog post "Changes Coming to NextMuni" (2021) says NextMuni began as a partnership with NextBus "more than twenty years ago." It also says the SFMTA Board and the Board of Supervisors approved the Next Generation CIS contract "to replace NextMuni."
- **Status of the replacement.** The SFMTA Next Generation CIS project page (last modified August 14, 2026) marks four phases "Completed":
  - Procurement (2017–2020)
  - Planning (2021–2022)
  - System startup and sign replacement (2022–2023)
  - "System Enhancements and MuniMobile App" (2023–2024)

  The page still lists the project status as "Implementation / Construction," with a capital cost of $25.4 million.
- **The prediction software cutover happened on November 13, 2022.** This comes from SFMTA's post "SFMTA Upgrades Predictions Software This Weekend!"

**What's wrong or needs correcting**
- **There was no vendor change away from Cubic.**
  - The SFMTA Board staff report (June 16, 2020) awarded Contract 2019-01 for the Next Generation CIS to Cubic Transportation Systems.
  - Cubic announced the award on October 1, 2020, in a Business Wire release.
  - Cubic had already bought NextBus in January 2013.
  - An SFMTA Muni Alerts message (undated, seen in search results) says arrival predictions "may be intermittent as our vender, Umo IQ, will be performing some system maintenace." Umo IQ is Cubic's rebrand of NextBus.
  - So the predictions engine changed, but the vendor family did not. A research pass found no evidence that SFMTA contracted Swiftly or another prediction vendor.
- **MuniMobile is not a durable successor.**
  - A new MuniMobile launched on December 4, 2023 (SFMTA blog; SF Chronicle). Per the Chronicle, it came from a different vendor than the original and cost an estimated $1.3 million.
  - SFMTA's MuniMobile page (August 2026 update) says the agency plans "to sunset the MuniMobile standalone app." Single-ride tickets ended September 1, 2026, and SFMTA expects "to completely transition away from MuniMobile by mid-2027." The page says this will save an estimated $3 million over two fiscal years amid "the largest financial crisis in our agency's history." SFMTA's budget page warns that "Without adequate funding, the SFMTA will be forced to make significant cuts to Muni services and programs beginning in FY 27-28." GrowSF (April 22, 2026), citing the SF Chronicle, reports that the budget plan relies partly on a $200 million state loan.
  - Any plan that treats MuniMobile as a long-term data source or competitor is out of date.
- **"Same underlying feed" is overstated.**
  - SFMTA's own explanation (March 13, 2023) is that "The SFMTA and its vendor generate data and share it openly," and that third-party apps "like Transit, Google and Waze… each have their own way of taking in and making use of the data."
  - Transit says it uses agency data plus "GO crowdsourcing data and our in-house ETA prediction engine" (Transit App Store listing, 2026).
  - SFMTA spokesperson Erica Kato told the SF Chronicle (December 2023) that Google Maps "does not provide official predictions or other SFMTA information."
  - The accurate framing: all of these apps start from the same SFMTA/Cubic vehicle data, but they do not all show the same predictions.
- **Google and Apple use of the 511 feed is not verified.**
  - 511 publishes SFMTA GTFS-Realtime data: trip updates, vehicle positions and alerts (511 Transit Data page, 2026).
  - Interline and MTC say SFMTA is included in the Regional GTFS-Realtime feed.
  - Google's BusTr paper (arXiv, 2020) confirms that Google Maps is generally built on GTFS and GTFS-Realtime.
  - I found no source stating whether Google, Apple or Transit pull SFMTA data from 511 or from SFMTA/Cubic directly. Treat "they use 511" as unverified.
- **Routesy still exists.** Its App Store listing says it covers Muni with real-time predictions.

### Claim 2 — Ghost and surprise vehicles
**Confirmed as SFMTA's own taxonomy.** SFMTA's "Tech Talk: Muni Predictions 101" (Christopher Ward, March 13, 2023) names "the two main problems with predictions":
- **Surprise vehicles.** Vehicles "in service but not showing up," caused by "damaged equipment, a vehicle not signed into the system when it departs the division, or when changes are not entered into the system." The result is that wait times "appear longer than they actually will be."
- **Ghost vehicles.** These usually occur "at stops close to the start of the line." In SFMTA's words, "When the count gets to zero, no vehicle appears! The current system can't adjust when a vehicle is delayed leaving its terminal, so the countdown relies on the vehicle schedule."

Note that this 2023 post describes the Next Generation CIS, not old NextMuni. So the ghost problem survived the 2022 cutover, at least as of March 2023.

**The 2014 post is accurately cited.** "NextMuni, Ghost Buses & Trains, Oh My!" (Sabrina Suzuki, November 24, 2014) says predictions from a terminal "are based on scheduled departure times until the train starts moving." If the vehicle doesn't depart, NextMuni drops the predictions after a few minutes.

**A nuance the earlier answer missed: SFMTA has traded ghosts for blanks before.** In 2020, SFMTA changed the software to "disregard any scheduled times and instead rely only on the vehicle's location." Its post "A New Way Of Generating Prediction Times" says the change eliminated "the dreaded 'ghost bus'" but means riders near route starts "may see 'No Prediction Available.'" The 2021 post says the same for headway-managed routes. So near a terminal, the failure can look like either a ghost or a blank, depending on the route and the era.

**2025–2026 persistence is unverified.** A dedicated research pass found no dated 2025–2026 article from SF Standard, SF Chronicle, Mission Local, SFGate or SF Examiner on Muni prediction accuracy. Reddit was not reachable in this research. The most recent rider quote found is in the SF Standard (October 18, 2022), where a rider said NextBus "is mostly nonfunctional now, and I think it makes people anxious."

Two weaker signals:
- The undated Umo IQ maintenance alert said "Arrival time predictions are currently not available," which shows feed outages still happen.
- An app-review aggregator (mwm.ai, undated, low reliability) summarizes MuniMobile reviews as "overwhelmingly negative," citing "inaccurate real-time information."

Bottom line: "still a known problem" rests on SFMTA's 2023 statement and structural reasons (terminal departures, unlogged vehicles). It does not rest on 2025–2026 measurements.

**Comparison point.** The Chicago Transit Authority (CTA) began publishing canceled-trip data in 2025, which Transit shows as struck-through times (WBEZ, August 4, 2025). I found no evidence that SFMTA publishes canceled-trip data the same way.

### Claim 3 — Light rail vs. bus error
- **Confirmed qualitatively.** SFMTA (March 2023) says the ghost problem "occurs with trains as with buses but at an increased rate, because trains cannot pass each other." It adds that control-center "service adjustments… to manage gaps… result in inaccurate predictions."
- **Subway predictions come from a different source.** SFMTA's 2014 post says that in the subway, NextMuni predictions are based on the Automatic Train Control System (ATCS).
- **No published rail-vs-bus accuracy numbers.** Neither my searches nor the research pass found any SFMTA metric comparing the two modes. The only accuracy figures are old, mostly about buses, or from vendors:
  - Umo IQ's help page (undated) claims error under one minute for predictions of five minutes or less, and under two minutes for ten-minute predictions. SFMTA's Moving SF blog made the same claim earlier (quoted by SF Weekly): "the margin of error overall is less than one minute for predictions of five-minutes or less. For 10-minute predictions, the margin of error is less than two minutes."
  - Swyft analyzed NextBus predictions from August 2015, as reported by SF Examiner and Muni Diaries (December 3, 2015): "When a vehicle's within five minutes of a stop, NextBus is accurate 91 percent of the time. When predictions are 25-30 minutes out, NextBus accuracy drops to 59 percent." A prediction counted as accurate if the vehicle arrived between "30 seconds earlier and 4 minutes later" than predicted. Overall accuracy within 30 minutes was 70% (SFGate), and the least accurate routes were the 82X, 28, Metro Bus Shuttle, 81X and 39.
- **The T Third is not specifically documented as worse for predictions.** It is documented as delay-prone. SFMTA is retiming signals and transit signal priority (TSP) at the most-delayed T Third intersections starting in fall 2025, with Phase 3 planned for the second half of 2026.
- **Structural fix is years away.** SFMTA signed a train-control contract with Hitachi Rail in January 2025. Passenger service on the new communications-based train control (CBTC) system is expected between 2028 and 2034 (Railway News, June 12, 2025). SFMTA Director of Transit Brent Jones said in August 2025 that installation begins in 2026 and full systemwide installation is expected between 2032 and 2034.

### Claim 4 — "No app does personalized plans, history, confidence, or incident checks"
| Feature | Exists? | Evidence |
|---|---|---|
| "When to leave" alerts | **Yes — the claim is false** | Transit GO "will recommend when to leave to board" and offers "departure alarms." SF TimeTable (Muni-specific iOS app) sends "push notifications when it's time to leave for the stop" |
| Pre-trip incident/alert check | **Yes, partly** | Transit: "Disrupted service? Find out before you leave… subscribe to receive push notifications." MuniMobile lists "notifications for frequent trips and service alerts" (while it lasts) |
| Better-than-agency ETAs | **Yes** | Transit's crowdsourced GO positions plus its in-house ETA engine. Google's machine-learning bus-delay model (Google Research, 2019), though that targets cities *without* agency real-time data |
| Learns *your* lateness history | **Not found** | No source describes per-user learning of how late you personally run |
| Shower or wake-up plan | **Not found** | No source found |
| Probability of a ghost, or of on-time arrival | **Not found** | A Transit App Store review complains that "if a bus isn't coming, the app lets you think the bus left," which supports the gap |

Not verified: Citymapper and Moovit features, Muni-specific open-source agents, and alarm-linked commute agents. The search budget ran out before I could check them, so the "not found" rows mean not found, not proven absent.

### Claim 5 — 511 Open Data
- **The rate limit is confirmed and current.** The 511 Transit Data page (2026, with 2026-dated spec documents) says: "The default rate limit per API token is 60 requests per 3600 seconds." The 511 Open Data FAQ says the same and says increases are granted "based on the need and use case."
  - There is a minor conflict on where to request an increase: the Transit page says 511sfbaydeveloperresources@googlegroups.com, while the FAQ says transitdata@511.org.
  - The developer group shows increases being granted as of September and December 2025.
- **The relevant endpoints exist:**
  - StopMonitoring ("expected arrival and departure times of vehicles at a stop"), queried as `agency=[operatorID]` with an optional `stopcode`
  - VehicleMonitoring
  - GTFS-RT TripUpdates and VehiclePositions, including a regional "RG" feed
  - I did not test a live `agency=SF` call, so "returns live predictions for Muni" is documented by 511 but not independently verified here.
- **On data quality, 511 documents nothing about ghosts or surprises.** Because 511 republishes the SFMTA/Cubic output, it is reasonable to infer that the same artifacts carry through. That is an inference, though, not a documented fact. SFMTA's own data license provides data "as is" with no warranty of accuracy.

## What I got wrong or overstated
1. **The "vendor change from NextBus/Cubic."** There wasn't one. The Next Generation CIS is Cubic's, and the alerts call the vendor Umo IQ.
2. **"Apps mostly rely on the same feed."** They share the input data, but Transit and Google run their own prediction layers, so the predictions they show can differ.
3. **"No app tells you when to leave."** False. Transit GO and SF TimeTable both do this.
4. **"Trains have higher prediction error" stated as if measured.** It is SFMTA's qualitative claim with no published numbers.
5. **Treating ghosts and surprises as currently measured.** The newest primary source is from 2023, and I found no 2025–2026 quantification.
6. **MuniMobile as a current successor.** Omitted: it is being sunset by mid-2027.

## What this means for Fogline
- **Differentiate on what's actually missing.** That means a personal plan (when to start the shower, when to leave), learning from your own door-to-stop timing and lateness history, and an explicit on-time probability. Don't pitch "leave-time alerts" as new, because Transit GO already does that.
- **Model ghosts explicitly.**
  - Treat a schedule-based or terminal-proximate prediction with no live vehicle position behind it as low-confidence.
  - Raise ghost risk when a countdown isn't backed by a moving vehicle in VehiclePositions.
  - Treat "no prediction" near terminals as normal behavior, not an outage.
- **Add rail-specific uncertainty for the T and other Metro lines.** SFMTA confirms this risk but gives no number, so learn the rail and bus error distributions from your own logged predictions versus observed arrivals.
- **Budget the 511 quota.** At 60 requests per hour, one key supports about one request per minute. Use the GTFS-RT TripUpdates and VehiclePositions feeds (one call returns the whole agency) instead of per-stop StopMonitoring polling, poll only during the pre-departure window, and request a quota increase early.
- **Check incidents through GTFS-RT Service Alerts before the shower decision.** Remember that the SFMTA alerts web page itself was showing "We are unable to display alerts at this time" during this research.
- **Expect worse predictions for a few days after service changes.** SFMTA said in 2021 that predictions take "a few days" to become accurate on new or restored routes. On June 21, 2025, Muni cut weekday service on the 5 Fulton, 9 San Bruno and 31 Balboa to turn back at Market Street, and merged the 6 and 21 into a new 6 Hayes-Parnassus (SFMTA travel update). Its budget page (modified July 20, 2026) says "we face a budget deficit of $307 million that will grow to $430 million by 2030," so more service changes are plausible.
- **Don't build on MuniMobile.**

## Caveats
- I could not reach Reddit, and I found no dated 2025–2026 news on prediction accuracy. The "recent complaints" part of the request remains thinly evidenced.
- The Umo IQ alert text is undated.
- Some SFMTA pages carry 2026 "last modified" metadata, but their content is older: the Predictions 101 post is dated March 13, 2023.
- Source names and dates are given inline throughout, in place of a separate list.