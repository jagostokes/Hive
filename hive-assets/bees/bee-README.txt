BEE SPRITES — AGENT ROSTER
==========================
Every bee is the SAME animation, recolored. Each file is a vertical sprite
strip: 4 frames stacked top to bottom, ~12 fps, loop. Bee faces "up" (north);
rotate the sprite toward travel direction in-engine. Render with
nearest-neighbor scaling (no smoothing).

Machine-readable mapping lives in bees.json (use that in the engine).

SOLO HIVE (1 big lone bee = the single expensive model, works serially)
-----------------------------------------------------------------------
  bee-solo.png               gray/silver   64x64 per frame (4x native)

SWARM HIVE (specialized agents, work in parallel)
-------------------------------------------------
  bee-orchestrator.png       amber         32x32 (2x)  coordinates the swarm
  bee-fetcher.png            yellow/gold   16x16
  bee-charter.png            orange        16x16
  bee-qa.png                 green         16x16
  bee-planner.png            blue          16x16
  bee-writer.png             red           16x16

BASE
----
  bee_spirtesheet.png        amber         16x16   original base sheet, source
                             of all recolors. Referenced by DEVIN-PROMPT-PLAN.md.

source/                      the original uploaded color-named PNGs, kept for
                             re-export / recolor reference.

NOTES
-----
- One orchestrator bee: the amber 2x bee. The purple recolor is unused and
  parked in source/ (bee_purple.png) if you want it for a future role.
- The two large bees are pre-rendered (solo at 4x, orchestrator at 2x);
  do not scale them again in-engine.

source: <paste itch URL>
license: <paste license text>
