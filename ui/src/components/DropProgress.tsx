// The honey-drop progress + download control. While running, the drop fills as
// progress increases (level 0→3). When the run completes, it fills to level 4
// AND becomes the download trigger for the lane's rendered dashboard HTML.
import { motion } from "motion/react";
import { HoneyDrop, type DropLevel } from "./sprites/HoneyDrop";

interface DropProgressProps {
  level: DropLevel;
  ready: boolean;
  downloadUrl?: string | null;
  filename?: string;
  caption?: string;
}

export function DropProgress({
  level,
  ready,
  downloadUrl,
  filename,
  caption,
}: DropProgressProps): JSX.Element {
  const drop = (
    <motion.div
      key={level}
      initial={{ scale: 0.95, opacity: 0.7 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{
        filter: ready ? "drop-shadow(0 4px 12px rgba(232,162,42,0.35))" : "none",
        transition: "filter 320ms ease",
      }}
    >
      <HoneyDrop level={level} pixel={5} />
    </motion.div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        rowGap: 6,
        padding: "4px 0",
      }}
    >
      {ready && downloadUrl ? (
        <a
          href={downloadUrl}
          download={filename ?? "dashboard.html"}
          aria-label="Download dashboard"
          style={{ display: "inline-block", cursor: "pointer" }}
        >
          {drop}
        </a>
      ) : (
        drop
      )}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 11.5,
          color: "var(--muted)",
          textAlign: "center",
          maxWidth: 240,
          lineHeight: 1.35,
        }}
      >
        {caption ?? (ready ? "Tap the drop to download your dashboard" : "Filling…")}
      </div>
    </div>
  );
}
