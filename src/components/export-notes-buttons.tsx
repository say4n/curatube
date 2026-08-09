"use client";

import { useState } from "react";
import { Download, Copy, Check, Loader2 } from "lucide-react";

type Props = {
  playlistId: string;
  playlistTitle?: string;
};

export function ExportNotesButtons({ playlistId, playlistTitle }: Props) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const exportUrl = `/api/playlists/${encodeURIComponent(playlistId)}/notes/export`;

  async function handleCopy() {
    setCopying(true);
    try {
      const response = await fetch(exportUrl);
      if (!response.ok) throw new Error("Failed to fetch notes");
      const text = await response.text();
      let copiedWithClipboard = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copiedWithClipboard = true;
        } catch {
          // Safari can expose the API but reject it outside a secure context.
        }
      }
      if (!copiedWithClipboard) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Clipboard copy is unavailable");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error(error);
      alert("Failed to copy notes to clipboard.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        disabled={copying}
        aria-label={playlistTitle ? `Copy notes for ${playlistTitle}` : "Copy notes to clipboard"}
        title="Copy notes to clipboard"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line-strong bg-surface text-ink transition hover:bg-cloud disabled:cursor-not-allowed disabled:opacity-60 sm:h-9 sm:w-9"
      >
        {copied ? (
          <Check size={16} className="text-moss" />
        ) : copying ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Copy size={16} />
        )}
      </button>
      <a
        href={exportUrl}
        download
        aria-label={playlistTitle ? `Download notes for ${playlistTitle}` : "Download notes"}
        title="Download notes"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line-strong bg-surface text-ink transition hover:bg-cloud sm:h-9 sm:w-9"
      >
        <Download size={16} />
      </a>
    </>
  );
}
