# Learning with STADIUM-DT

This guide turns the repository into a self-paced course on crowd digital twins. It has five stages, from clicking around the demo to changing the model and measuring what happens. No prior knowledge of crowd science is assumed; stages 3 and 5 need basic JavaScript, and stage 4 needs basic Python with pandas.

| Stage | You will | Time |
| --- | --- | --- |
| 1. Explore the demo | learn what a digital twin shows an operator | 30 min |
| 2. Understand the concepts | connect each idea to the code that implements it | 1–2 h |
| 3. Read the code | follow one simulated second through the twelve files | 2–3 h |
| 4. Analyse the dataset | measure crowd peaks, queues and estimation error | 1–2 h |
| 5. Experiment | change the model and observe the consequences | open-ended |

Everything in this project is synthetic. Treat the numbers as a laboratory, not as facts about a real stadium.

---

## Stage 1 · Explore the demo

Start the demo (open `index.html`, or run `node tools/serve.js` and visit `http://localhost:8080/`). It opens at 19:06, 24 minutes before kick-off, while spectators are still arriving.

**MIRROR** (key `1`)
1. Find the darkest (red or coral) zone in the 3D view. Click it. Which zone is it, and what are its density and confidence?
2. Open the **Digital twin loop** panel on the left and click *01 Sensor ingest*. Switch off **CCTV**. Watch the confidence and the estimates change. Turn it back on and switch off **WiFi** instead. Which source matters more? (Answer: cameras. WiFi is noisy and up to 30 s old.)
3. Change the overlay from *Density* to *Uncertainty*. Where is the twin least sure?

**PREDICT** (key `2`)
1. Select **+5 MIN**. Which zone is predicted to reach the 3.5 people/m² bottleneck threshold first, and in how many minutes?
2. Compare the uncertainty bars in the right panel at +2 and +5 minutes. Why do they grow?

**SIMULATE** (key `3`)
1. Run **Additional Gate Opening**. How much faster do the gate queues clear? Now look at *Peak density* in the result table. What got worse?
2. Run **Concourse Restriction** on W-015 at 50% width. Clearance barely changes, but look at the zone's density. What would an operator miss if they read only the clearance time?
3. Run **Medical Response** with and without the responder lane. What does the lane cost the crowd?

**NAVIGATE** (key `4`)
1. Use the phase selector in the top bar to jump to **HALFTIME**. Ask for *Food* from different QR points. When does the crowd-aware route differ from the shortest route?
2. Switch to **Responder** and dispatch to W-014. Compare the routes with and without the service corridor.

**REPLAY** (key `5`)
1. Press *Jump to alert*. Scrub the slider and watch the density build up before the alert opens.
2. Use the timeline markers to find the operator actions you just took. This is the audit trail.

---

## Stage 2 · Understand the concepts

| Concept | What to know | Where in the code |
| --- | --- | --- |
| Digital twin | a model kept in sync with sensors, used to see, predict and test | the whole loop: `Twin.step()` in `js/04-twin-sensing-fusion.js` |
| Crowd density | people per square metre; above roughly 3.5 people/m² movement slows sharply | `DENS`, `BOTTLENECK_K`, `densLevel()` in `js/01-core.js` |
| Zones and attachments | the concourse is cut into 10 zones linked to gates, portals, stairs and amenities | `ZONES`, `ATT`, `GATES`, `AMEN` in `js/02-venue-schedule.js` |
| Arrival profile | people arrive along a skewed bell curve peaking 72 min after gates open | `arrivalShape()`, `ARR_PEAK` in `js/02-venue-schedule.js` |
| Speed–density relation | the denser the crowd, the slower people walk | `vk()` and `KJAM` in `js/02-venue-schedule.js` |
| Little's law | people in a zone = flow through it × time spent in it | `Model.step()` in `js/03-flow-model.js` |
| Queues | gates and amenities serve at a fixed rate; the rest wait and can spill into the concourse | `LANE_RATE`, `AMEN` servers and rates; queue updates in `Model.step()` |
| Sensor error | cameras undercount in dense crowds; WiFi lags and drifts | `Twin.sense()`: the `occl` line and the WiFi `ratio` |
| Sensor fusion | combine sources weighted by 1/variance, together with a model prediction | `Twin.sense()`: the `ms` list and the weighted sum |
| Uncertainty and confidence | every estimate carries a standard deviation; confidence is derived from it | `e.sig` and `e.conf` in `Twin.sense()` |
| Anomaly rules | conditions on the estimate that must persist before an alert opens | `Twin.detect()` |
| Forecasting | run the model forward from the current estimate | `Twin.forecastStart()` and `Twin.forecast()` |
| What-if scenarios | two copies of the model, one with an intervention, run in lockstep | `SCEN`, `buildScenario()`, `pairRunner()` in `js/05-scenarios.js` |
| Routing | shortest path on a graph whose edge costs include crowding | `edgeCost()`, `dijkstra()`, `planRoute()` in `js/06-walk-graph-routing.js` |
| Recommendation feedback | each route given adds expected load, so the next answer differs | `recLoad`, `noteRecommendation()`, `decayRecommendations()` |
| Privacy boundary | only aggregate numbers reach the twin, never images or IDs | `SRC_INFO` notes and the edge messages; see the README |

Key question to keep asking: **is the twin's number the truth, or its estimate of the truth?** In the code, `TWIN.m.z[j]` is the simulated ground truth and `TWIN.est[j]` is what the twin believes.

---

## Stage 3 · Read the code

The twelve files in `js/` load in order and share top-level names, so read them in the same order. Recommended path:

1. **`01-core.js`.** Constants, colour ramp, the seeded random generator `mulberry32`, clock formatting, the shared UI state `S`, and `logEvent()`, which feeds the audit log.
2. **`02-venue-schedule.js`.** The physical setting: zone areas, where each gate and stair attaches (`ATT`), gate lanes, amenity servers, seating groups, the game schedule (`SCHED`, `phaseAt()`) and the speed–density relation `vk()`.
3. **`03-flow-model.js`.** The heart of the simulation. Read `class Model`: `reset()`, `init()` and especially `step(dt)`, which rebuilds the streams, loads them onto zones, updates queues and backlogs, and relaxes occupancy.
4. **`04-twin-sensing-fusion.js`.** `class Twin` wraps a `Model` as ground truth and keeps its own estimate. Follow `step()` → `sense()` (synthetic sensors and fusion, once per second) → `detect()` (rules, every 2 s) → `forecastStart()` (every 5 s).
5. **`05-scenarios.js`.** How a what-if comparison is built from a snapshot and how clearance is measured.
6. **`06-walk-graph-routing.js`.** The walkable graph, `dijkstra()`, the generalised edge cost with the `W8` weights, and the feedback that spreads recommendations.
7. **`12-main.js`.** The boot sequence and main loop: how often the twin steps, how the clock speed works, and how everything is wired together.
8. **`10-interface.js` and `11-operations.js`.** The console: modes, KPI cards, tables, the Scenario Lab, the route planner and the replay recorder.
9. **`07-scene.js`, `08-agents.js` and `09-view.js`.** The 3D presentation layer. The agents you see are *samples* of the model's flows (one agent ≈ 6 people); they do not drive the numbers.

**Try this while reading.** Open the browser's developer console on the running demo and type:

```js
TWIN.m.z[4].N        // true people in CONC-W-014 (ground truth)
TWIN.est[4].N        // the twin's estimate for the same zone
TWIN.est[4].src      // how much each source counted in that estimate
fmtClock(TWIN.m.clock)
```

---

## Stage 4 · Analyse the dataset

The dataset in `data/` was produced by this exact model; see `data/README.md` for every column. Run these from the repository root (Python 3 with pandas):

```python
import pandas as pd

z = pd.read_csv("data/synthetic_game_day/zones.csv")

# 1. When is the concourse busiest?
total = z.groupby("time")["estimated_people"].sum()
print(total.idxmax(), total.max())                    # 19:15:00 1570

# 2. A time x zone density table around the pre-game peak
heat = z.pivot(index="time", columns="zone_id", values="density_ppm2")
print(heat.loc["19:10:00":"19:15:00"].round(2))

# 3. How wrong is the estimate, by true density?
z["true_density"] = z["true_people"] / z["area_m2"]
z["error_pct"] = (z["estimated_people"] - z["true_people"]) / z["true_people"] * 100
busy = z[z["true_people"] >= 20]
bands = pd.cut(busy["true_density"], [0, 1.5, 2.5, 3.5, 10])
print(busy.groupby(bands, observed=True).agg(minutes=("error_pct", "size"),
      mean_bias_pct=("error_pct", "mean"), confidence=("confidence", "mean")).round(2))

# 4. Minutes when the truth was HIGH but the twin did not say so
missed = z[(z["true_density"] >= 3.5) & (z["density_level"] != "HIGH")]
print(missed[["time", "zone_id", "true_density", "density_ppm2"]].round(2))

# 5. When do concession queues overflow their space?
a = pd.read_csv("data/synthetic_game_day/amenities.csv")
over = a[a["queue_people"] > a["queue_capacity"]]
print(over.groupby(["amenity", "phase"]).size())

# 6. Which forecasting method from the paper wins?
e2 = pd.read_csv("data/paper_results/E2_forecast_accuracy.csv")
print(e2[["method", "mae_2min_all", "skill_2min_vs_persistence"]])
```

What you should find:

- The bias grows from about −1.8% at low density to about −7.9% above 3.5 people/m², while confidence stays near 0.90. That is the key lesson: **a confident twin is not necessarily a correct one.**
- In seven zone-minutes the truth is HIGH but the one-minute snapshot is not, all in W-014.
- Concession queues overflow before kick-off (lingering into the first minutes of the first half) and again at halftime.

**Going further**
- Plot `total` and mark kick-off (19:30), halftime (20:52–21:12) and the final whistle (22:34).
- Build a simple forecaster (persistence: "density in 2 minutes = density now") and measure its error on `density_ppm2`. Then try a linear trend. Compare with the paper's E2 table.
- Write your own alarm rule on `estimated_people` and count how many true HIGH minutes it catches and how many false alarms it raises.
- Remember the 22:34 break: the post-game segment restarts the model (column `segment`), so do not treat the jump there as a crowd event.

---

## Stage 5 · Experiment with the model

Make a copy of the repository, change one thing at a time, reload the page and compare. To compare quantitatively, regenerate the dataset (`npm run generate-data`, written to `data/generated/`) and rerun the Stage 4 analysis.

| Experiment | Change | What to look for |
| --- | --- | --- |
| Faster security screening | `LANE_RATE` in `js/02-venue-schedule.js` (6.5 → 8) | gate queues in SIMULATE and `gates.csv` |
| A better camera | the `occl` line in `Twin.sense()` (`0.035` → `0.01`) | bias above 3.5 people/m², missed HIGH minutes |
| A worse camera | the same line (`0.035` → `0.06`) | how late HIGH DENSITY alerts fire, or whether they fire at all |
| Slower walkers | `vk()` in `js/02-venue-schedule.js` (`1.34` → `1.1`) | densities, clearance times |
| Stricter alarms | `BOTTLENECK_K` in `js/01-core.js` (3.5 → 3.0) | number of alerts in REPLAY and `events.csv` |
| Herding | `noteRecommendation()` in `js/06-walk-graph-routing.js`: comment out the load it adds | many NAVIGATE requests in a row now get the same answer |
| Cautious routing | `W8.beta` in `js/06-walk-graph-routing.js` (1.5 → 4) | how often crowd-aware routes differ from the shortest |

Questions to answer in your notes:
1. Which change had the largest effect on safety-relevant numbers (peak density, minutes above threshold)?
2. Which changes improved one metric but worsened another?
3. Which parameters would you most want to measure in a real stadium before trusting the twin?

---

## Further reading

- `docs/dataset-descriptor.pdf`: how the dataset was produced and what it shows.
- `data/paper_results/`: results of the seven experiments (E1–E7) in the STADIUM-DT research paper.
- Topics to search for: crowd digital twin; Little's law; pedestrian fundamental diagram (Weidmann); Kalman filter; data assimilation for crowds; Dijkstra's algorithm; route-choice feedback and herding.
