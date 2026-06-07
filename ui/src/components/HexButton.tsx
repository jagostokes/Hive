// The signature CTA: a flat-topped hexagon filled with honey amber. We achieve
// the hex with clip-path (not an SVG button) so the click target is rectangular
// and the label inherits proper button semantics. On hover the honey deepens
// and the surrounding watermark glows faintly.
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useState } from "react";

interface HexButtonProps {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  size?: "lg" | "md" | "sm";
  variant?: "honey" | "outline";
  disabled?: boolean;
  type?: "button" | "submit";
}

export function HexButton({
  onClick,
  children,
  size = "lg",
  variant = "honey",
  disabled,
  type = "button",
}: HexButtonProps): JSX.Element {
  const [hover, setHover] = useState(false);

  const dims: Record<typeof size, { w: number; h: number; px: number; fz: number }> = {
    lg: { w: 240, h: 100, px: 36, fz: 18 },
    md: { w: 180, h: 76, px: 26, fz: 15 },
    sm: { w: 120, h: 52, px: 18, fz: 13 },
  };
  const d = dims[size];

  const clip = "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";

  const honeyBg = hover && !disabled ? "var(--honey-deep)" : "var(--honey)";
  const outlineBg = hover && !disabled ? "rgba(232,162,42,0.08)" : "transparent";

  const style: CSSProperties = {
    position: "relative",
    width: d.w,
    height: d.h,
    padding: `0 ${d.px}px`,
    clipPath: clip,
    WebkitClipPath: clip,
    background: variant === "honey" ? honeyBg : outlineBg,
    color: variant === "honey" ? "var(--wax)" : "var(--bark)",
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: d.fz,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    transition: "background 220ms ease, transform 220ms ease",
    transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };

  // Outline variant: render a hex outline via an underneath wrapper that uses
  // the same clip with a 2px inset.
  if (variant === "outline") {
    return (
      <div
        style={{
          width: d.w,
          height: d.h,
          background: "var(--bark)",
          clipPath: clip,
          WebkitClipPath: clip,
          padding: 1.5,
          display: "inline-block",
        }}
      >
        <button
          type={type}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={onClick}
          disabled={disabled}
          style={{
            width: "100%",
            height: "100%",
            clipPath: clip,
            WebkitClipPath: clip,
            background: "var(--wax)",
            color: "var(--bark)",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: d.fz,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            transition: "background 220ms ease",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {children}
        </button>
      </div>
    );
  }

  return (
    <button
      type={type}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}
