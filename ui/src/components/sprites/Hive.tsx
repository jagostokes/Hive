// A single pixel-art hive — the right-panel motif representing the monolithic
// baseline model. Larger than a bee, with honeycomb cells visible inside.
import { PixelSprite } from "./PixelSprite";
import type { CSSProperties } from "react";

// 22 wide x 20 tall. The stacked rows of hexagonal cells read as honeycomb at
// pixel scale.
const GRID: string[] = [
  "......oooooooooo......",
  ".....o..........o.....",
  "....ooBBBBBBBBBBoo....",
  "...oBBBhhBBhhBBhhBo...",
  "..oBBhh..hh..hh..BBo..",
  "..oBhh.KK.KK.KK.hhBo..",
  ".oBBh.K..K.K..K.hBBo..",
  ".oBhh..K.K.K.K..hhBo..",
  ".oBhh.KK.KK.KK.hhBo...",
  ".oBBhh..hh..hh..BBo...",
  ".oBhh.KK.KK.KK.hhBo...",
  ".oBhh..K.K.K.K..hhBo..",
  ".oBBh.K..K.K..K.hBBo..",
  ".oBhh.KK.KK.KK.hhBo...",
  ".oBhh..hh..hh..hhBo...",
  ".oBBBBBBBBBBBBBBBBo...",
  "..oBBBBBBBBBBBBBBo....",
  "...ooBBBBBBBBBBoo.....",
  ".....oooooooooo.......",
  "......................",
];

const PALETTE: Record<string, string> = {
  ".": "transparent",
  o: "#2b2017", // bark outline
  B: "#e8a22a", // honey body
  h: "#ffd07a", // highlight
  K: "#c97a12", // cell shadow (honeycomb interior)
};

export interface HiveSpriteProps {
  pixel?: number;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function HiveSprite({ pixel = 7, active, className, style }: HiveSpriteProps): JSX.Element {
  return (
    <PixelSprite
      grid={GRID}
      palette={PALETTE}
      pixel={pixel}
      className={className}
      style={{
        ...(active
          ? { animation: "hive-drift 2.4s ease-in-out infinite" }
          : { opacity: 0.85 }),
        ...style,
      }}
      title="hive"
    />
  );
}
