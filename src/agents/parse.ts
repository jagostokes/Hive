// agents/parse: small shared helpers for turning loose model text into the
// runnable artifact each agent needs. Pure string work — no model calls.

/**
 * Strip a Markdown code fence if present (```lang ... ```), returning the inner
 * code. Falls back to the trimmed input when there is no fence. Cheap models
 * frequently wrap "code only" / "JSON only" answers in fences anyway.
 */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const fence = t.match(/```[a-zA-Z0-9]*\s*\n?([\s\S]*?)```/);
  return (fence ? fence[1] : t).trim();
}

/**
 * Extract and parse the first JSON object from model output. Throws if none is
 * found or it does not parse — callers surface that as a verified failure so the
 * agent can self-correct.
 */
export function extractJsonObject(text: string): unknown {
  const stripped = stripCodeFence(text);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in output");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}
