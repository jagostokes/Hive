// Honey drop in 4 fill levels. Single shape, varying interior fill height.
// Level 0 = empty outline (run not started), level 1-3 = partial, level 4 = full.
import { PixelSprite } from "./PixelSprite";
import type { CSSProperties } from "react";

export type DropLevel = 0 | 1 | 2 | 3 | 4;

// 14 wide x 18 tall — outline (o), shadow (s), fill (f), highlight (h).
// We compose the grid procedurally so the fill rises with the level.
function dropGrid(level: DropLevel): string[] {
  // base outline (level 0): just the silhouette
  const W = 14;
  const H = 18;
  // mapping of full silhouette interior cells (1 = inside, 0 = outside, x = outline)
  const SHAPE: string[] = [
    "......xx......",
    ".....x11x.....",
    ".....x11x.....",
    "....x1111x....",
    "....x1111x....",
    "...x111111x...",
    "...x111111x...",
    "..x11111111x..",
    "..x11111111x..",
    "..x11111111x..",
    ".x1111111111x.",
    ".x1111111111x.",
    ".x1111111111x.",
    ".x1111111111x.",
    "..x11111111x..",
    "..x11111111x..",
    "...xxxxxxxx...",
    "..............",
  ];

  // fill threshold: rows below this index are filled. levels: 0=none, 1=bottom
  // 25%, 2=50%, 3=75%, 4=full. We compute fill row cutoff so it visibly steps.
  const cutoffs = { 0: H, 1: 12, 2: 9, 3: 6, 4: 1 } as const;
  const cutoff = cutoffs[level];

  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    const row = SHAPE[y];
    let line = "";
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (ch === "x") line += "o";
      else if (ch === "1") {
        // Interior cell: fill if at/below cutoff, else show empty (faint wax).
        if (y >= cutoff) {
          // highlight stripe at top of fill for a touch of dimension
          if (y === cutoff && x > 2 && x < 6 && level > 1) line += "h";
          else line += "f";
        } else {
          line += "e"; // empty interior
        }
      } else line += ".";
    }
    out.push(line);
  }
  return out;
}

const PALETTE: Record<string, string> = {
  ".": "transparent",
  o: "#2b2017", // bark outline
  f: "#e8a22a", // honey
  h: "#ffd07a", // highlight
  e: "#f5edda", // empty wax interior
};

export interface HoneyDropProps {
  level: DropLevel;
  pixel?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function HoneyDrop({ level, pixel = 6, className, style, title }: HoneyDropProps): JSX.Element {
  return (
    <PixelSprite
      grid={dropGrid(level)}
      palette={PALETTE}
      pixel={pixel}
      className={className}
      style={{ transition: "filter 320ms ease", ...style }}
      title={title ?? `honey drop level ${level}`}
    />
  );
}
