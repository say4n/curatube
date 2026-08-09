"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

type Props = {
  playlistId: string;
  playlistTitle: string;
};

export function DeletePlaylistButton({ playlistId, playlistTitle }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function deletePlaylist() {
    setBusy(true);
    try {
      const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/delete`, {
        method: "DELETE"
      });
      if (!response.ok) return;

      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label={`Delete ${playlistTitle}`}
        title="Delete playlist"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-rust text-white transition hover:bg-rust/85 disabled:cursor-not-allowed disabled:opacity-60 sm:h-9 sm:w-9"
      >
        {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
      </button>

      {open
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171717]/55 px-4 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-playlist-title"
            className="max-h-full w-full max-w-md overflow-y-auto rounded-md border border-line bg-surface p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rust text-white">
                <Trash2 size={17} />
              </div>
              <div className="min-w-0">
                <h2 id="delete-playlist-title" className="text-lg font-black text-ink">
                  Delete playlist?
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  <span className="font-semibold text-ink">{playlistTitle}</span> will be deleted.
                  Notes and progress will be kept.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-bold text-ink transition hover:bg-cloud disabled:cursor-not-allowed disabled:opacity-60 sm:h-10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deletePlaylist}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-rust px-4 text-sm font-bold text-white transition hover:bg-rust/85 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10"
              >
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
        )
        : null}
    </>
  );
}
