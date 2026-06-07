// Landing view: the airy, typographic first impression. The composition is
// centered on a generous vertical rhythm. A single tiny bee sits high above the
// title as a quiet accent; the focal hex CTA anchors the composition. Each
// element fades + drifts in on load in a staggered sequence.
import { motion } from "motion/react";
import { HexButton } from "../components/HexButton";
import { Bee } from "../components/sprites/bees";
import { HoneyDrop } from "../components/sprites/HoneyDrop";

interface LandingProps {
  onEnter: () => void;
  onReadThesis: () => void;
}

const FADE_UP = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export function Landing({ onEnter, onReadThesis }: LandingProps): JSX.Element {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "1fr auto 1fr",
        padding: "48px 32px",
      }}
    >
      {/* tiny floating bee far above the title — a quiet accent */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "absolute",
          top: "12vh",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <Bee variant={1} pixel={4} active title="bee" />
      </motion.div>

      {/* decorative honey drop in the lower-right corner, very faint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.35 }}
        transition={{ delay: 0.9, duration: 1.2 }}
        style={{
          position: "absolute",
          bottom: "8vh",
          right: "6vw",
        }}
      >
        <HoneyDrop level={2} pixel={5} />
      </motion.div>

      {/* center stack */}
      <div />
      <section
        style={{
          display: "grid",
          justifyItems: "center",
          rowGap: 28,
          maxWidth: 880,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <motion.h1
          {...FADE_UP}
          transition={{ delay: 0.25, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="display"
          style={{
            margin: 0,
            fontSize: "clamp(56px, 9vw, 124px)",
            lineHeight: 0.98,
            fontWeight: 400,
            fontVariationSettings: '"opsz" 144',
            letterSpacing: "-0.024em",
          }}
        >
          Using the{" "}
          <em
            style={{
              fontStyle: "italic",
              color: "var(--honey-deep)",
              fontWeight: 400,
            }}
          >
            Hive
          </em>
        </motion.h1>

        <motion.p
          {...FADE_UP}
          transition={{ delay: 0.55, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="muted"
          style={{
            margin: 0,
            maxWidth: 640,
            fontSize: 17,
            lineHeight: 1.55,
            letterSpacing: "0.005em",
          }}
        >
          Using hyper small language models to simulate brain activity on
          specific prompt structure.
        </motion.p>

        <motion.button
          {...FADE_UP}
          transition={{ delay: 0.8, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          onClick={onReadThesis}
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 15,
            color: "var(--bark-soft)",
            borderBottom: "1px solid var(--line)",
            paddingBottom: 2,
            letterSpacing: "0.01em",
          }}
        >
          read the thesis &nbsp;→
        </motion.button>

        <motion.div
          {...FADE_UP}
          transition={{ delay: 1.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: 28 }}
        >
          <HexButton onClick={onEnter} size="lg">
            Try Now
          </HexButton>
        </motion.div>
      </section>

      {/* footer line — almost invisible, just for grounding */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1.0 }}
        style={{
          alignSelf: "end",
          textAlign: "center",
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          color: "var(--muted)",
          fontSize: 13,
          letterSpacing: "0.04em",
        }}
      >
        a brain-pattern data system · localhost
      </motion.footer>
    </main>
  );
}
