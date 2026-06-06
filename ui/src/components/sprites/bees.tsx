// Six pixel-art bee variants — one per brain agent role. Each is a 16x12 grid;
// chars: . = transparent, W = wing (translucent grey), B = body honey, K = bark
// stripes, E = eye, R = red/accent, A = antenna, L = legs.
//
// The variants differ subtly: stripe count, wing posture, accent color, so the
// row of six reads as a swarm of individuals rather than copy-paste. Restraint:
// they're small accents, not the focal element.
import { PixelSprite } from "./PixelSprite";
import type { CSSProperties } from "react";

export type BeeVariant = 1 | 2 | 3 | 4 | 5 | 6;

const PALETTE = {
  ".": "transparent",
  W: "rgba(70, 53, 38, 0.18)", // translucent bark wings
  w: "rgba(70, 53, 38, 0.32)",
  B: "#e8a22a", // honey body
  H: "#c97a12", // honey shadow
  K: "#2b2017", // bark stripes
  E: "#2b2017", // eye
  A: "#2b2017", // antenna
  L: "#2b2017", // legs
  R: "#a82c1a", // crimson accent (rare)
  G: "#5b6b3a", // moss accent (rare)
  C: "#3a5a78", // cobalt accent (rare)
} as const;

// All bees share a base silhouette; we swap a few cells for variant flavor.
// Grid is 16 wide x 12 tall, bee oriented to the right.
const BASE: string[] = [
  "................",
  ".....A.....A....",
  "....A.....A.....",
  ".....BHBHB......",
  "....BKBKBKB.....",
  "...wWBKBKBKB....",
  "..WWWBKBKBKBE...",
  "...wWBKBKBKB....",
  "....BBBBBBB.....",
  ".....L.L.L......",
  "................",
  "................",
];

function withAccent(grid: string[], accent: string): string[] {
  // Replace the eye-row body cell adjacent to the eye with the accent color.
  // Subtle individuation only.
  const out = grid.slice();
  out[6] = out[6].replace("BKBKBKBE", "BKBKBKB" + "E");
  // accent collar (col 12 row 6 maps from BE to accent)
  if (accent !== "B") {
    out[5] = out[5].replace("BKBKBKB", "BKBKB" + accent + "B");
  }
  return out;
}

function withWingPosture(grid: string[], posture: "up" | "flat" | "down"): string[] {
  const out = grid.slice();
  if (posture === "up") {
    out[3] = "..wW.BHBHB......";
    out[4] = ".WWWWBKBKBKB....";
    out[5] = "..wWWBKBKBKB....";
    out[6] = "...wWBKBKBKBE...";
  } else if (posture === "down") {
    out[5] = "....BBKBKBKB....";
    out[6] = "...wWBKBKBKBE...";
    out[7] = "..WWWBKBKBKB....";
    out[8] = "...wWBBBBBBB....";
  }
  return out;
}

function withStripes(grid: string[], count: 2 | 3): string[] {
  if (count === 3) return grid;
  // 2-stripe = drop the middle stripe (replace KBK with BKB-ish smoothing)
  const out = grid.slice();
  for (let i = 5; i <= 7; i++) {
    out[i] = out[i].replace("BKBKBKB", "BKBBBKB");
  }
  return out;
}

const VARIANT_GRIDS: Record<BeeVariant, string[]> = {
  1: withAccent(withWingPosture(withStripes(BASE, 3), "flat"), "B"),
  2: withAccent(withWingPosture(withStripes(BASE, 2), "up"), "R"),
  3: withAccent(withWingPosture(withStripes(BASE, 3), "down"), "G"),
  4: withAccent(withWingPosture(withStripes(BASE, 2), "flat"), "C"),
  5: withAccent(withWingPosture(withStripes(BASE, 3), "up"), "B"),
  6: withAccent(withWingPosture(withStripes(BASE, 3), "flat"), "R"),
};

export interface BeeProps {
  variant: BeeVariant;
  pixel?: number;
  active?: boolean;
  done?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Bee({ variant, pixel = 5, active, done, className, style, title }: BeeProps): JSX.Element {
  const animStyle: CSSProperties = active
    ? {
        animation: "hive-flutter 1.1s ease-in-out infinite",
        transformOrigin: "50% 60%",
      }
    : done
      ? { transform: "translateY(0)", filter: "saturate(1)" }
      : { opacity: 0.55, filter: "saturate(0.6)" };
  return (
    <PixelSprite
      grid={VARIANT_GRIDS[variant]}
      palette={PALETTE}
      pixel={pixel}
      className={className}
      style={{ ...animStyle, ...style }}
      title={title}
    />
  );
}
