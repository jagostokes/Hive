// Pixel renderer. Each sprite is a 2D char grid (one char per pixel) plus a
// palette mapping that maps each char to a color. SVG rect-per-cell with
// shape-rendering:crispEdges keeps the pixels sharp at any zoom. This beats
// raster PNGs for crispness and lets us encode 6 bee variants in <500 lines.
import { CSSProperties } from "react";

export interface PixelSpriteProps {
  grid: string[];
  palette: Record<string, string>;
  pixel?: number; // size of each pixel in CSS px
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function PixelSprite({
  grid,
  palette,
  pixel = 5,
  className,
  style,
  title,
}: PixelSpriteProps): JSX.Element {
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  const w = cols * pixel;
  const h = rows * pixel;

  const rects: JSX.Element[] = [];
  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const color = palette[ch];
      if (!color) continue;
      rects.push(
        <rect
          key={`${x}-${y}`}
          x={x * pixel}
          y={y * pixel}
          width={pixel}
          height={pixel}
          fill={color}
        />,
      );
    }
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {rects}
    </svg>
  );
}
