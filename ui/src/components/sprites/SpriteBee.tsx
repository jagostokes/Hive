// SpriteBee: renders one of the hive-assets bee sprites with proper sprite-strip
// animation (vertical strip, 4 frames, ~12 fps loop, nearest-neighbor scaling).
//
// Each sprite file is a vertical strip: frameCount x frameHeight tall, frameWidth
// wide. We render a div sized to ONE frame and animate background-position-y in
// `steps(frameCount)` so each step snaps to the next frame.
//
// When active=false, animation pauses on frame 0 and the sprite is dimmed.
// When done=true, animation pauses but stays full-saturation/crisp.
import type { CSSProperties } from "react";

export type BeeRole =
  | "orchestrator"
  | "fetcher"
  | "charter"
  | "qa"
  | "planner"
  | "writer"
  | "solo";

// Native frame dimensions per sprite (matches hive-assets/bees/bees.json).
const FRAMES: Record<BeeRole, { w: number; h: number; count: number; file: string }> = {
  orchestrator: { w: 32, h: 32, count: 4, file: "/assets/bees/bee-orchestrator.png" },
  fetcher: { w: 16, h: 16, count: 4, file: "/assets/bees/bee-fetcher.png" },
  charter: { w: 16, h: 16, count: 4, file: "/assets/bees/bee-charter.png" },
  qa: { w: 16, h: 16, count: 4, file: "/assets/bees/bee-qa.png" },
  planner: { w: 16, h: 16, count: 4, file: "/assets/bees/bee-planner.png" },
  writer: { w: 16, h: 16, count: 4, file: "/assets/bees/bee-writer.png" },
  solo: { w: 64, h: 64, count: 4, file: "/assets/bees/bee-solo.png" },
};

const FPS = 12;

export interface SpriteBeeProps {
  role: BeeRole;
  /** Display size of ONE frame, in CSS px (width). Height scales proportionally. */
  size?: number;
  active?: boolean;
  done?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function SpriteBee({
  role,
  size,
  active,
  done,
  className,
  style,
  title,
}: SpriteBeeProps): JSX.Element {
  const frame = FRAMES[role];
  // Default display size: nudge small bees up so they read at glanceable size
  // while keeping pixel proportions exact (multiples of frame size avoid blur).
  const displayW = size ?? (frame.w === 64 ? 96 : frame.w === 32 ? 48 : 36);
  const scale = displayW / frame.w;
  const displayH = frame.h * scale;
  const stripH = displayH * frame.count;

  // Each step shifts the background by displayH pixels (one frame).
  const duration = frame.count / FPS;

  const animState = active ? "running" : "paused";
  const opacity = active || done ? 1 : 0.55;
  const filter = active ? "none" : done ? "saturate(1)" : "saturate(0.55)";

  // Animate background-position-y from 0 to -(stripH - displayH) in `count`
  // steps so each step is exactly one frame. We use a CSS var so a single shared
  // keyframe (in global.css) works for any frame size.
  const endY = -(stripH - displayH);
  return (
    <span
      className={className}
      role="img"
      aria-label={title ?? `bee-${role}`}
      style={{
        display: "inline-block",
        width: displayW,
        height: displayH,
        backgroundImage: `url(${frame.file})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${displayW}px ${stripH}px`,
        backgroundPosition: "0 0",
        imageRendering: "pixelated",
        opacity,
        filter,
        animation: `sprite-strip ${duration}s steps(${frame.count - 1}) infinite`,
        animationPlayState: animState,
        ["--sprite-end-y" as string]: `${endY}px`,
        transition: "opacity 280ms ease, filter 280ms ease",
        ...style,
      }}
    />
  );
}
