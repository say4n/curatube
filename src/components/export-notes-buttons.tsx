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
      await navigator.clipboard.writeText(text);
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud disabled:cursor-not-allowed disabled:opacity-60"
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud"
      >
        <Download size={16} />
      </a>
    </>
  );
}
