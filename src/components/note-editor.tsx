"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Eye, Pencil, Save } from "lucide-react";
import { parseTimestamp } from "@/lib/time";

type Props = {
  videoId: string;
  initialNote: string;
  onSeek: (seconds: number) => void;
};

const timestampPattern = /(^|[\s([>])(\d{1,2}:\d{2}(?::\d{2})?)(?=($|[\s)\].,;!?<]))/g;

function linkifyTimestamps(markdown: string) {
  return markdown.replace(timestampPattern, (match, prefix: string, timestamp: string) => {
    const seconds = parseTimestamp(timestamp);
    if (seconds === null) return match;
    return `${prefix}[${timestamp}](curatube-seek:${seconds})`;
  });
}

export function NoteEditor({ videoId, initialNote, onSeek }: Props) {
  const [body, setBody] = useState(initialNote);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setBody(initialNote);
    setSaved(true);
    setPreview(false);
  }, [initialNote, videoId]);

  useEffect(() => {
    if (saved) return;

    const timeout = window.setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/notes/${encodeURIComponent(videoId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body })
        });
        setSaved(true);
      } finally {
        setSaving(false);
      }
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [body, saved, videoId]);

  const renderedBody = useMemo(() => linkifyTimestamps(body), [body]);

  return (
    <aside className="h-full min-h-0 border-t border-[#d8d1c3] bg-[#fffdf8] xl:border-l xl:border-t-0">
      <div className="flex h-full min-h-[320px] flex-col sm:min-h-[380px] xl:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-[#d8d1c3] px-4 py-3">
          <h2 className="text-base font-black text-ink">Notes</h2>
          <div className="flex items-center gap-2">
            <span className="min-w-16 text-right text-xs font-semibold text-[#6c6257]">
              {saving ? "Saving" : saved ? "Saved" : "Unsaved"}
            </span>
            <button
              type="button"
              onClick={() => setPreview((value) => !value)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud sm:h-9 sm:w-9"
              aria-label={preview ? "Edit note" : "Preview note"}
            >
              {preview ? <Pencil size={17} /> : <Eye size={17} />}
            </button>
            <button
              type="button"
              onClick={() => setSaved(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white transition hover:bg-moss sm:h-9 sm:w-9"
              aria-label="Save note"
            >
              <Save size={17} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {preview ? (
            <div className="hover-scrollbar prose-note h-full overflow-auto px-4 py-3 text-[#312c27]">
              {body.trim() ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    a({ href, children }) {
                      if (href?.startsWith("curatube-seek:")) {
                        const seconds = Number.parseInt(href.replace("curatube-seek:", ""), 10);
                        return (
                          <button
                            type="button"
                            onClick={() => onSeek(seconds)}
                            className="rounded bg-cloud px-1.5 py-0.5 font-mono text-sm font-bold text-rust underline-offset-2 hover:underline"
                          >
                            {children}
                          </button>
                        );
                      }

                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-moss underline underline-offset-2"
                        >
                          {children}
                        </a>
                      );
                    }
                  }}
                >
                  {renderedBody}
                </ReactMarkdown>
              ) : (
                <p className="text-sm font-semibold text-[#6c6257]">
                  Write Markdown notes with math like $E = mc^2$ and timestamps like 2:36.
                </p>
              )}
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setSaved(false);
              }}
              spellCheck
              placeholder={"Markdown notes...\n\nUse $x^2$ or $$\\int_0^1 x dx$$ for math.\nType 2:36 to create a clickable timestamp in preview."}
              className="hover-scrollbar h-full min-h-0 w-full resize-none border-0 bg-[#fffdf8] px-4 py-3 font-mono text-base leading-6 text-ink outline-none placeholder:text-[#8a8175] sm:text-sm"
            />
          )}
        </div>
      </div>
    </aside>
  );
}
