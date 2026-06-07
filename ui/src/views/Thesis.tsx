// Thesis view: loads docs/THESIS.md from the API and renders it in-app with the
// hive palette. Reached from the Landing "read the thesis →" link.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { fetchThesis } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

interface ThesisProps {
  onBack: () => void;
}

export function Thesis({ onBack }: ThesisProps): JSX.Element {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchThesis()
      .then((text) => alive && setMd(text))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: "32px 24px 96px",
      }}
    >
      <motion.button
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        onClick={onBack}
        style={{
          position: "sticky",
          top: 0,
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 15,
          color: "var(--bark-soft)",
          borderBottom: "1px solid var(--line)",
          paddingBottom: 2,
          marginBottom: 28,
          zIndex: 2,
        }}
      >
        ←&nbsp; back
      </motion.button>

      <motion.article
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="md-doc"
      >
        {error ? (
          <p className="md-p" style={{ color: "var(--honey-deep)" }}>
            Couldn’t load the thesis ({error}). Make sure the API server is running.
          </p>
        ) : md === null ? (
          <p className="md-p muted">Loading the thesis…</p>
        ) : (
          renderMarkdown(md)
        )}
      </motion.article>
    </main>
  );
}
