# Hive — Devin Multi-Prompt Build Plan

Feed these to Devin **one at a time**, in order. Do not paste the whole plan at once: the point is to make Devin spend real time on each layer and stop for your review before the next. After each prompt, check the **Done when** list before continuing. Every prompt assumes Devin has `hive-assets/` (with `BUILD-SPEC.md` inside) in the repo.

Golden rule to repeat to Devin: **the mock event stream is the single source of truth.** Every visual reacts to `HiveEvent`s (BUILD-SPEC 2.10). Nothing is hard-coded to a timeline. This is what lets the real backend drop in later by swapping one adapter.

---

## Prompt 0 — Scaffold, types, and the mock event bus

```
Read BUILD-SPEC.md in full before writing code. Set up the project ONLY. Do not build any UI yet.

1. Vite + React 18 + TypeScript + Tailwind. Add deps: pixi.js (v8), gsap, recharts, react-countup.
2. Load fonts Press Start 2P, Pixelify Sans, VT323 from Google Fonts.
3. Create src/types/events.ts with the exact HiveEvent union from BUILD-SPEC 2.10.
4. Create src/data/eventBus.ts: an event emitter that any component can subscribe to.
5. Create src/data/mockRun.ts: a scripted mock run that emits a realistic sequence of HiveEvents over ~12s for BOTH hives (phase, source_status x3, agent_spawned, agent_state, cell_progress, activity, dashboard_tile, cost_tick, run_complete, parity_result). The solo hive emits serial work (one agent, cells one at a time); the swarm emits parallel work (4-5 agents). Make timings/costs plausible: swarm finishes faster, costs a bit more.
6. Create src/data/adapter.ts as the ONLY place that chooses source = mockRun today, SSE later. Document the swap.

Done when: `npm run dev` boots, and a temporary debug panel logs the full event stream to the console when I click "Run". No styling needed yet.
```

**Done when:** event stream logs cleanly end to end, solo finishes slower/cheaper and swarm faster/pricier, types compile with no `any` leaks.

---

## Prompt 1 — Static layout shell and the three phases (no animation, no canvas)

```
Build the LAYOUT SKELETON only, with plain divs and placeholder boxes. No PixiJS, no charts yet.

Per BUILD-SPEC 2.2 and 2.7, create the split screen with labeled placeholder regions:
- Top bar (cost race placeholder, spans both)
- Left half = SOLO hive box; right half = SWARM hive box; each with a hive-canvas placeholder on top and an output-tray placeholder below
- A roster-strip placeholder per hive
- Bottom: activity-feed placeholder, and the command-dock placeholder beneath it
Implement the three phase states (idle / running / result) driven by the `phase` event, and reflow the layout per 2.7: idle = dock + sources large and centered, running = hives/race/feed dominant, result = dashboards dominant. Use simple CSS transitions between phases for now.

Done when: clicking Run walks idle -> running -> result and the boxes visibly reflow. Every region is present and labeled.
```

**Done when:** all regions exist, phases reflow on the real `phase` event, nothing hard-coded to a timer.

---

## Prompt 2 — The hive canvas and the bees (one hive first)

```
Build the PixiJS hive canvas for the SWARM hive only. Ignore the solo hive and honey for now.

Per BUILD-SPEC 2.1, 2.4, 2.11:
- Mount a PixiJS v8 app in the swarm hive region. Set texture scaling to NEAREST.
- Load bees/bee_spirtesheet.png as a vertical strip, 4 frames of 16x16, build an AnimatedSprite (~12fps). Bee faces up; rotate sprite toward travel direction.
- Render bees from agent_spawned events. Drive each bee through the state machine (idle/flying/working/done/error) from agent_state events.
- Bees stay INSIDE the hive bounds and move on GSAP bezier paths with slight randomized wobble. Idle = gentle hover near center.

Done when: on Run, swarm bees spawn, fly to positions, animate wings, and return to idle, all driven by events. 60fps.
```

**Done when:** bees are event-driven (not scripted in the canvas), wings animate, motion is curved and bounded, holds 60fps.

---

## Prompt 3 — Honeycomb cells and procedural honey, plus solo hive

```
Add the honeycomb work surface and honey progress, then clone the canvas to the SOLO hive.

Per BUILD-SPEC 2.3, 2.4, 2.11:
- Lay out honeycomb cells (use Kenney hexagons from world/, or draw hexes) as the work surface in each hive.
- A bee in `working` state hovers over its assigned cell (cellId). Render honey filling that cell from `cell_progress` (fill 0..1): a procedural golden fill rising from the bottom with a gloss highlight, optional drip. Do NOT use static honey images.
- On `done`, cap the cell (full honey + brief sparkle); on `error`, drain/dull it.
- Now instantiate the SOLO hive too: ONE large bee that visits cells sequentially. The swarm has many bees filling cells concurrently. The serial-vs-parallel contrast must read at a glance.

Done when: both hives run side by side; honey fills and caps per cell from events; solo is visibly serial, swarm visibly parallel.
```

**Done when:** honey is procedural and event-driven, both hives populated, serial/parallel contrast obvious.

---

## Prompt 4 — Command dock: query input + data sources + catalog

```
Build the command dock (BUILD-SPEC 2.8). DOM/React, not canvas.

- Persistent bar pinned bottom-center feeding both hives. Query input in VT323, placeholder "Ask your data...", Enter submits (dispatch a "run" that triggers the adapter).
- Source chips row above the input, one per `source_status` event: checkbox to include, status dot (green connected / amber available / grey offline). Theme each source as a honey jar (connected jars glow gold, offline empty).
- A "Browse" chip opens a Data Catalog panel listing every source, its tables, and status. Catalog = discovery, chips = selection.
- In idle phase the dock + sources are large/centered; in running they dock small at the bottom (respect the phase from Prompt 1).

Done when: sources render from events with correct status styling, catalog opens and lists tables, typing + Enter starts a run.
```

**Done when:** chips reflect `source_status`, catalog browsable, submit triggers the run, honey-jar theme present.

---

## Prompt 5 — Cost & speed race, roster strips, activity feed

```
Build the live tracking UI (BUILD-SPEC 2.5, 2.6). DOM/React.

- Top bar: two columns (Solo, Swarm). Running USD odometer (react-countup, VT323) and token total from `cost_tick`, a thin elapsed/progress bar, and a live delta between hives. Freeze on `run_complete`.
- Roster strip per hive from agent_spawned/agent_state/activity: each agent with specialty, current action, tokens, status dot. Solo roster = one entry showing the model's current sequential step.
- Activity feed (bottom): interleaved, timestamped, color-coded by hive, from `activity` events. Auto-scroll.

Done when: all three update live and correctly during a run and freeze sensibly at the end.
```

**Done when:** cost/roster/feed are all live and event-driven, totals freeze on completion, honest delta shown.

---

## Prompt 6 — Output trays (tiles drop as honey caps)

```
Build the per-hive output tray (BUILD-SPEC 2.9), the link between honey and output.

- When a cell caps (agent `done` / its tile arrives via `dashboard_tile`), animate a compact tile dropping into that hive's tray below the canvas. Tiles: kpi number, small line, small bar, table stub, rendered with Recharts.
- Tiles appear progressively as the run proceeds, not all at once. Each tile maps to a tileId.

Done when: during a run, each hive's tray fills tile by tile in sync with cells capping, in miniature.
```

**Done when:** tiles are tied to cell completion, render in Recharts, appear progressively per hive.

---

## Prompt 7 — Result phase: full dashboards + parity check + verdict

```
Build the result phase (BUILD-SPEC 2.7, 2.9, 2.6).

- On `phase: "result"`, expand both output trays into full, readable dashboards side by side; shrink the hives to a header strip.
- Show the verdict from the frozen race: which hive was cheaper, which was faster, with the numbers. Honest framing (swarm often faster but pricier).
- Parity check from `parity_result`: a badge ("outputs match" / "N tiles differ"). If tiles differ, clicking the badge highlights which tiles differ and the note for each.

Done when: a finished run lands on two full dashboards, a clear verdict, and a working parity badge with drill-down.
```

**Done when:** result phase reads clearly, verdict is accurate to the data, parity drill-down works.

---

## Prompt 8 — Focus mode

```
Add focus mode (BUILD-SPEC 2.2). Clicking either hive (in running or result) expands it fullscreen to inspect that hive's bees, cells, roster, and full dashboard; a collapse control returns to the split view. Animate the expand/collapse with GSAP. Default view stays the split race.

Done when: I can drill into one hive and back out without losing run state, smoothly.
```

**Done when:** expand/collapse is smooth, state is preserved, split remains the default.

---

## Prompt 9 — Audio, polish, performance, final acceptance

```
Final pass.

- Audio: loop audio/buzz-loop.wav quietly during running phase (with a mute toggle); play a soft chime on each cell cap and on run_complete. Compress the WAV to mp3/ogg for the web.
- Performance: confirm 60fps with 20+ bees per hive; if needed move bees to a PixiJS ParticleContainer. Keep NEAREST scaling everywhere.
- Polish: tune phase transition animations (no hard cuts), pixel-font hierarchy (Press Start 2P titles only), honey gloss, bee wobble.
- Run through every item in BUILD-SPEC 2.12 Acceptance Criteria and fix anything failing.

Done when: every acceptance criterion in 2.12 passes, audio works with a mute, and it holds 60fps.
```

**Done when:** BUILD-SPEC 2.12 fully passes, audio + mute work, performance target met.

---

## How to run this with Devin

- Paste one prompt, let it finish, then verify against **Done when** yourself before the next.
- If a prompt's output drifts, correct it in place before moving on. Each layer is a dependency for the next, so do not advance on a shaky foundation.
- Keep the mock event bus untouched as you go; if you need richer demo data, edit `mockRun.ts` only.
- When the real multi-agent backend is ready, point `adapter.ts` at the SSE endpoint. No UI prompt needed.
```
