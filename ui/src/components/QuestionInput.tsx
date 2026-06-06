// Question input for each panel — a soft underline-style input that fits the
// editorial typography. Pressing Enter (or the small hex Send) submits.
import { useState, KeyboardEvent } from "react";
import { HexButton } from "./HexButton";

interface QuestionInputProps {
  onSubmit: (q: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function QuestionInput({ onSubmit, disabled, placeholder }: QuestionInputProps): JSX.Element {
  const [value, setValue] = useState("");

  const send = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "stretch",
        columnGap: 14,
      }}
    >
      <textarea
        rows={2}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? "Ask a data-analytics question…"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--line)",
          padding: "14px 4px",
          fontFamily: "var(--font-display)",
          fontSize: 19,
          lineHeight: 1.35,
          fontVariationSettings: '"opsz" 36',
          color: "var(--bark)",
          outline: "none",
          resize: "none",
          width: "100%",
          fontStyle: "italic",
          opacity: disabled ? 0.55 : 1,
        }}
      />
      <div style={{ display: "flex", alignItems: "center" }}>
        <HexButton onClick={send} size="sm" disabled={disabled || !value.trim()}>
          Ask
        </HexButton>
      </div>
    </div>
  );
}
