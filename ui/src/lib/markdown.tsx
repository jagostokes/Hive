// A small, dependency-free markdown → React renderer. Deliberately scoped to the
// constructs the thesis (docs/THESIS.md) uses: ATX headings, fenced code, hr,
// blockquotes, GFM tables, ordered/unordered lists, paragraphs, and inline
// **bold** / `code` / [links](url). Keeps the UI's tiny dep footprint (react +
// motion only) — no markdown library.
import type { ReactNode } from "react";

// --- inline: **bold**, `code`, [text](url) ---
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key++} className="md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (lm) {
        nodes.push(
          <a key={key++} href={lm[2]} target="_blank" rel="noreferrer">
            {lm[1]}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// Does this line begin a new block? Used to terminate a running paragraph.
function isBlockStart(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    t.startsWith("```") ||
    /^#{1,4}\s+/.test(t) ||
    /^---+$/.test(t) ||
    t.startsWith(">") ||
    /^[-*]\s+/.test(t) ||
    /^\d+\.\s+/.test(t) ||
    t.includes("|")
  );
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?[\s:|-]+\|?$/.test(t) && t.includes("-") && t.includes("|");
}

export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // fenced code block
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push(
        <pre key={key++} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2]);
      const cls = `md-h md-h${level}`;
      blocks.push(
        level === 1 ? (
          <h1 key={key++} className={cls}>
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={key++} className={cls}>
            {content}
          </h2>
        ) : level === 3 ? (
          <h3 key={key++} className={cls}>
            {content}
          </h3>
        ) : (
          <h4 key={key++} className={cls}>
            {content}
          </h4>
        ),
      );
      i++;
      continue;
    }

    // blockquote (consecutive > lines)
    if (line.trim().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {renderInline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // GFM table: a header row followed by a separator row
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <table key={key++} className="md-table">
          <thead>
            <tr>
              {header.map((cell, j) => (
                <th key={j}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
        // fold indented continuation lines into the current item
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i]) &&
          !/^\s*[-*]\s+/.test(lines[i])
        ) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // paragraph
    const buf: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {renderInline(buf.join(" "))}
      </p>,
    );
  }

  return blocks;
}
