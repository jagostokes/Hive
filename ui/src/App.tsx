// App shell: holds the views and orchestrates the vertical slide transition.
// The brief asks for a feel of "scrolling down into the workspace" even though
// it's a route change — we accomplish that with motion's layout transitions: the
// landing slides up and out, the next view slides up and in.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Landing } from "./views/Landing";
import { Workspace } from "./views/Workspace";
import { Thesis } from "./views/Thesis";
import { Training } from "./views/Training";

type View = "landing" | "workspace" | "thesis" | "training";

export default function App(): JSX.Element {
  const [view, setView] = useState<View>("landing");

  return (
    <div style={{ position: "relative", overflowX: "hidden" }}>
      <AnimatePresence mode="wait">
        {view === "landing" ? (
          <motion.div
            key="landing"
            initial={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -64 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Landing onEnter={() => setView("workspace")} onReadThesis={() => setView("thesis")} onTrain={() => setView("training")} />
          </motion.div>
        ) : view === "thesis" ? (
          <motion.div
            key="thesis"
            initial={{ opacity: 0, y: 64 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 64 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <Thesis onBack={() => setView("landing")} />
          </motion.div>
        ) : view === "training" ? (
          <motion.div
            key="training"
            initial={{ opacity: 0, y: 64 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 64 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <Training onBack={() => setView("landing")} />
          </motion.div>
        ) : (
          <motion.div
            key="workspace"
            initial={{ opacity: 0, y: 64 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <Workspace />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
