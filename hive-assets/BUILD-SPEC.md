# Hive UI — Procurement Checklist + Devin Build Spec

A single handoff doc. Part 1 is what *you* gather and download. Part 2 is the brief you paste to Devin so it builds the right thing.

Theme: a living pixel-art beehive. Each agent is a bee working inside the hive, filling honeycomb cells with honey as it completes tasks. One query feeds two hives side by side: a Solo hive (one big bee = a single expensive model, working serially) racing a Swarm hive (many specialized bees, working in parallel). A live top bar races their cost and speed; a roster and activity feed track what each side is doing.

---

## Part 0 — The one decision that gates everything

Render the bees on a **WebGL canvas (PixiJS)**, and layer a **normal React dashboard (DOM)** on top. Two layers, one screen:

- **Layer A (back): the hive world.** PixiJS canvas, animated bee sprites, honeycomb background, flight paths.
- **Layer B (front): the control panel.** React + HTML for the query input, the live dashboard, and the cost meter.

Why this split: sprites moving on curved paths need canvas performance, but charts, text, and inputs are far easier and more accessible as real DOM. Do not try to build charts inside the canvas, and do not try to animate dozens of bees with CSS. Each layer does what it is good at.

---

## Part 1 — What to gather and download

Everything below is free or cheap, and the licenses are noted so Devin can ship it without legal surprises. Download into one folder (structure in Part 1.6) and hand the whole folder over.

### 1.1 Bee sprites (the agents)

You need a **sprite sheet with animation frames** (wing-flap / hover / flight), not a static PNG. Start here:

- **Bee — Pixel Art Character by sanctumpixel** — clean, ships separate PNGs *and* a packed sheet, easy engine import. https://sanctumpixel.itch.io/bee-pixel-art-character
- **Browse-and-pick (free, Pixel Art tag):** https://itch.io/game-assets/free/tag-bee/tag-pixel-art
- **Wider insect packs** (so worker bees, scout bees, and a "queen" can look different): https://itch.io/game-assets/tag-insect/tag-pixel-art

What to actually grab:
- One **base bee** with at least: idle/hover loop, flight loop. 4 to 8 frames each is plenty.
- Confirm the license on the asset page. Most itch packs are "free for commercial use, no attribution" or "attribution required." Save a screenshot of the license text next to the asset.

Plan for **3 to 4 bee color variants** to signal agent role (for example: orange = worker, yellow = scout, purple = queen/orchestrator). You will recolor these in Part 1.5, so one good base sheet is enough.

### 1.2 The hive, honeycomb, and world (CC0, zero attribution)

Kenney's packs are public domain (CC0), the safest license that exists. Grab:

- **Hexagon Tiles** (90 assets, CC0): https://kenney.nl/assets/hexagon-tiles
- **Hexagon Pack** (310 assets, CC0): https://kenney.nl/assets/hexagon-pack
- **Pixel UI / interface packs** for buttons, panels, frames: https://kenney.nl/assets (filter to UI and Pixel)

Use the hexagons to tile the honeycomb background behind the swarm. Use the UI pack for pixel-style buttons and panel borders so the control panel matches the world.

If you want a richer, more illustrated honeycomb/hive tileset, check **CraftPix** (free + paid tiers, read each license): https://craftpix.net

### 1.3 Flowers and decor (optional, sells the "alive" feel)

A couple of animated flowers or pollen motes give bees somewhere to fly to. Pull from the same itch insect/nature packs. Keep it minimal: 2 to 3 props.

### 1.4 Fonts (free, Google Fonts, nothing to manage)

- **Press Start 2P** — chunky 8-bit. Logo and section titles ONLY. It is unreadable in body text. https://fonts.google.com/specimen/Press+Start+2P
- **Pixelify Sans** — readable pixel font for labels and body. https://fonts.google.com/specimen/Pixelify+Sans
- **VT323** — terminal style. Perfect for the cost counters and the query input. https://fonts.google.com/specimen/VT323

### 1.5 Tools to create / recolor sprites (you will need this)

To make the 3 to 4 role-colored bee variants from one base sheet:

- **Aseprite** ($20, the standard, exports sheet + frame JSON): https://www.aseprite.org
- **Piskel** (free, browser, good enough for recolors): https://www.piskelapp.com
- **LibreSprite** (free desktop, open-source Aseprite fork): https://libresprite.github.io

To pack loose frames into a single optimized sheet + JSON that PixiJS loads directly:

- **TexturePacker** (has a PixiJS v8 export preset; free tier works): https://www.codeandweb.com/texturepacker

### 1.6 Sound (optional, high payoff)

A soft buzzing ambient loop plus a "task complete" chime makes the hive feel alive more than extra sprites do. Pull CC0 / CC-BY clips from **Freesound** (check each clip's license): https://freesound.org . Search "bee buzz loop" and "soft chime."

### 1.7 Hand Devin this folder layout

```
hive-assets/
  bees/            base bee sheet + JSON, plus recolored variants
  world/           honeycomb hex tiles, hive structure
  ui/              pixel buttons, panels, frames
  decor/           flowers, pollen
  audio/           buzz-loop, complete-chime
  LICENSES.md      paste each asset's license + source URL here
```

`LICENSES.md` matters: one line per asset with its source URL and license. Ten minutes now saves a headache later.

---

## Part 2 — The brief to paste to Devin

> Build a single-page web app called **Hive**: a pixel-art beehive where AI agents are animated bees. Use the assets in `hive-assets/`. Stack and behavior below are fixed unless I say otherwise.

### 2.1 Stack (use these exact choices)

- **React 18 + TypeScript + Vite**
- **PixiJS v8** (current stable, v8.x) for the bee/hive canvas layer. Use `AnimatedSprite` + `Spritesheet` for frame animation, and `ParticleContainer` if bee count goes high.
- **GSAP** for bee flight paths (tween along bezier curves) and UI motion.
- **Tailwind CSS** for the control-panel styling.
- **Recharts** for the dashboard that builds in realtime.
- **react-countup** (or a simple animated odometer) for the cost meters.

### 2.2 Layout — two hives racing, side by side (the core view)

The default screen is a **split screen, NOT tabs.** One query feeds two approaches running at the same time, so the user watches them race:

- **Left half — Solo hive.** The single expensive model is rendered as **one large lone bee** that works every honeycomb cell itself, one at a time (serial).
- **Right half — Swarm hive.** The specialized agent team is **many small role-colored bees** filling cells at the same time (parallel). The serial-vs-parallel contrast is the demo.
- **Both hives share the same honeycomb interior.** Bees stay INSIDE the hive, flying cell to cell. No flying off to flowers, no outdoor scenes.
- **Top bar (spans both):** the Cost & Speed race (2.6).
- **Each hive, top of its half:** the hive animation. **Directly below it, an output tray** where finished dashboard tiles appear as honey cells cap (2.9).
- **Each hive also has a roster strip** (2.5) listing its bees and what each is doing right now.
- **Bottom bar (spans both):** the shared activity feed (2.5), and beneath it the **command dock**: the data-source picker plus the natural-language query input (2.8).

The layout is not static. It shifts across **three run phases** (2.7) so each element is large when it matters and small when it does not.

**Why not tabs:** tabs hide one side, which kills the comparison. The payoff moment is seeing the swarm finish while the solo bee is still grinding, and you only get that if both are visible at once. Keep tabs only as an optional **focus mode**: click either hive to expand it fullscreen and inspect its agents in detail, then collapse back to the race. Default = split. Focus = drill-down.

### 2.3 The hive interior and honey-as-progress

- Bees live inside the hive. The honeycomb (Kenney hexagons) is the **work surface**. Each task is a honeycomb cell.
- **Progress = honey, rendered procedurally (do NOT use static honey PNGs).** As a task progresses, its cell fills with honey: a golden fill rising from the bottom of the cell with a lighter gloss highlight, optional drip. A fully capped honey cell = task done.
- This makes honey a live progress meter, not decoration. At a glance, "how much honey is in the comb" reads as "how much of the dashboard is built." It also lets you compare the two hives by how fast each comb fills.
- No flowers, no pollen-gathering trips. Pollen motes, if used at all, are in-engine particles for ambiance only.

### 2.4 Agent-to-bee state machine

Each agent is one bee. Its animation, position, and the honey in its cell reflect live task state:

| State     | Visual                                                                 |
|-----------|------------------------------------------------------------------------|
| `idle`    | hovers near the center of the hive, idle/hover frames                  |
| `flying`  | flies to its assigned cell on a bezier path, faster wing loop          |
| `working` | hovers over its cell, fast wing loop, **cell fills with honey (0→1)**   |
| `done`    | cell caps with honey + brief sparkle, bee returns to center, goes idle  |
| `error`   | red tint flash + wobble, cell honey drains/dulls, bee returns to center |

Solo hive: ONE big bee cycles through cells sequentially. Swarm hive: many bees work different cells concurrently. Bee color = role.

### 2.5 Tracking what each side is doing (roster + activity feed)

Two mechanisms, both always visible in split view:

- **Per-hive roster strip.** Lists each agent with a live status dot. Swarm entries show name + specialty (e.g. Fetcher, Charter, QA, Orchestrator), current action, and tokens used. The solo hive's roster is a single entry: the model name and its current sequential step (e.g. "writing query 3 of 9").
- **Shared activity feed (bottom bar).** Interleaved, timestamped, color-coded by hive. Example lines: `[swarm] Charter built revenue line chart` · `[solo] model writing query 3 of 9`. This is where the user literally reads the play-by-play of both approaches.

### 2.6 Cost & Speed race (top bar, the punchline)

Two columns, one per hive, both updating live as `cost_tick` events arrive:

- **Solo:** running USD + token total for the single model.
- **Swarm:** running USD + token total summed across all agents.

Show per hive: a VT323 odometer for cost, a thin elapsed/progress bar, and a live **delta** between them ("Swarm: +$0.042 / -3.1s vs Solo"). On `run_complete` for both, freeze the totals and show a clear, labeled verdict. Keep it honest: state plainly which hive was cheaper and which was faster. The swarm is often faster but pricier, and that tradeoff is the story, not something to hide.

### 2.7 Three run phases (the layout shifts)

The screen reallocates space across the lifecycle of a run so nothing is permanently cramped:

- **Idle (before a query):** the data-source picker and the query input are the focus, centered and large. Both hives idle with gentle bee hover.
- **Running (during):** the hives, the cost race, the honey fill, and the activity feed take over. Output trays fill tile by tile. The command dock shrinks to the bottom.
- **Result (after both finish):** the two completed dashboards expand to full size, side by side, with the verdict and the parity check (2.9) on top. Hives shrink to a header strip.

Animate the transitions between phases; never hard-cut.

### 2.8 The command dock: query input + data sources

A persistent bar pinned bottom-center, feeding BOTH hives from one input.

- **Query input:** VT323 font, pixel-framed, placeholder "Ask your data...". Enter submits to both hives at once. Stays docked during a run so follow-ups are possible.
- **Source chips (row directly above the input):** one chip per available database, e.g. `[▣ Postgres ✓] [▣ Stripe ✓] [▢ Snowflake] [+ Browse]`. The checkbox includes that DB in the query. A status dot shows connection health: green connected, amber available, grey offline.
- **Data catalog (opens from the `Browse` chip):** a panel listing every available database, its tables, and connection status, so the user can see what they can pull from before asking. The catalog is discovery; the chips are selection.
- **Theme:** render each database as a **honey jar / reserve** the hive draws from. Connected jars glow gold, offline ones look empty. Keeps the metaphor intact now that bees stay inside the hive.

### 2.9 Output trays + parity check (how each team's result is shown)

This hooks directly into the honey mechanic.

- **Causal link:** when a bee caps a honey cell (task done), a **finished dashboard tile drops into that hive's output tray** below it. Honey completing literally produces output.
- **During the run:** each tray shows compact tiles popping in as cells cap (KPI numbers, small charts, table stubs). The user watches each dashboard assemble in miniature.
- **On completion or focus:** the tray **expands to a full, readable dashboard** (Recharts). In the result phase both dashboards sit side by side at full size.
- **Parity check (result phase):** compare the two teams' outputs and show a badge: do they produce the same tiles and the same numbers? For example `outputs match ✓` or `3 tiles differ`. This answers the real question, which is not only "is the swarm cheaper" but "is the cheaper swarm just as correct as the expensive model." When tiles differ, let the user click the badge to see which.

### 2.10 Data contract (build to this shape; mock it now, wire SSE later)

Consume a **stream of events**, not a single response. Use **Server-Sent Events (SSE)** or WebSockets. Today, feed it from a mock emitter on a timer so the UI is fully demoable without a backend; swapping in the real endpoint should touch one adapter file only. Every event carries a `hive` tag so it routes to the correct side.

```ts
type Hive = "solo" | "swarm";

type HiveEvent =
  | { type: "phase";         phase: "idle"|"running"|"result" }
  | { type: "source_status"; sourceId: string; name: string; status: "connected"|"available"|"offline"; tables?: string[] }
  | { type: "agent_spawned"; hive: Hive; agentId: string; role: "solo"|"fetcher"|"charter"|"qa"|"orchestrator"; label: string }
  | { type: "agent_state";   hive: Hive; agentId: string; cellId?: string; state: "idle"|"flying"|"working"|"done"|"error" }
  | { type: "cell_progress"; hive: Hive; cellId: string; fill: number /* 0..1 honey level */ }
  | { type: "activity";      hive: Hive; agentId: string; text: string; ts: number }
  | { type: "dashboard_tile";hive: Hive; tileId: string; kind: "kpi"|"line"|"bar"|"table"; data: unknown }
  | { type: "cost_tick";     hive: Hive; usd: number; tokens: number; model: string }
  | { type: "run_complete";  hive: Hive; totalUsd: number; ms: number }
  | { type: "parity_result"; tilesMatched: number; tilesDiffered: number; diffs?: { tileId: string; note: string }[] };
```

- `phase` drives the idle → running → result layout shift.
- `source_status` populates the data-source chips and the catalog (connection health + tables).
- `agent_*` + `cell_progress` drive the bees and honey in each hive.
- `activity` populates the feed and roster.
- `dashboard_tile` drops a tile into that hive's output tray (compact in split view, full on completion/focus).
- `cost_tick` / `run_complete` drive the race.
- `parity_result` drives the result-phase parity badge.

### 2.11 Animation specs

- Bees move on **bezier curves**, not straight lines, with slight randomized wobble so no two paths look identical.
- The solo bee moves cell to cell one at a time; swarm bees move concurrently. Read serial vs parallel at a glance.
- Honey fill is procedural (animated 0→1 height per cell), with a gloss highlight and optional drip. No static honey art.
- Sprite frames cycle via PixiJS `AnimatedSprite`. Bee faces "up"; rotate the sprite toward its travel direction.
- Keep it crisp: set texture scaling to **nearest-neighbor** (`PIXI.SCALE_MODES.NEAREST`) so pixels stay sharp, never blurred.
- Target 60fps with 20+ bees per hive. If it drops, move bees into a `ParticleContainer`.

### 2.12 Acceptance criteria

- In the idle phase, the data-source picker and query input are front and center; source chips reflect live connection status and the catalog is browsable.
- Submitting a query shifts to the running phase, starts BOTH hives at once, and both cost columns begin climbing.
- The solo hive shows one bee working cells serially; the swarm shows many bees working concurrently.
- Honeycomb cells fill with honey as tasks progress and cap when done; capping a cell drops a tile into that hive's output tray.
- The roster and activity feed correctly show what each side is doing in realtime.
- Clicking a hive opens focus mode; collapsing returns to the split race.
- When both finish, the result phase expands both dashboards side by side, shows a frozen, labeled cheaper/faster verdict, and shows a parity badge comparing the two outputs.
- Phase transitions animate, never hard-cut. Pixels are sharp at all sizes. Runs at 60fps. Swapping mock data for a real SSE endpoint touches only the adapter file.

---

## Your pre-handoff checklist

- [ ] One base bee sprite sheet downloaded, license saved (1.1)
- [ ] 3 to 4 recolored bee variants made in Aseprite/Piskel (1.5)
- [ ] Kenney hexagon tiles + UI pack downloaded (1.2)
- [ ] Optional flowers/decor + buzz audio (1.3, 1.6)
- [ ] Frames packed with TexturePacker into sheet + JSON (1.5)
- [ ] Fonts confirmed (just names, Devin pulls from Google Fonts) (1.4)
- [ ] `hive-assets/` folder assembled with `LICENSES.md` (1.7)
- [ ] Part 2 pasted to Devin

Hand Devin the folder plus Part 2, and you will get the hive you described.
