"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock,
  Github,
  Loader2,
  Plus,
  Search,
  ArrowUpDown,
  X
} from "lucide-react";
import type { ImportJob, Playlist } from "@/lib/db";
import { ExportNotesButtons } from "./export-notes-buttons";

type Props = {
  initialPlaylists: Playlist[];
  initialJobs: ImportJob[];
  buildCommit: string | null;
};

type PlaylistSort = "last-watched" | "date-added";

function parseDate(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function HomePage({ initialPlaylists, initialJobs, buildCommit }: Props) {
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sortBy, setSortBy] = useState<PlaylistSort>("last-watched");
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );

  const sortedPlaylists = useMemo(() => {
    const sorted = [...initialPlaylists];

    sorted.sort((left, right) => {
      if (sortBy === "date-added") {
        const createdDifference =
          parseDate(right.created_at) - parseDate(left.created_at);
        if (createdDifference !== 0) return createdDifference;
      } else {
        const watchedDifference =
          parseDate(right.last_watched_at) - parseDate(left.last_watched_at);
        if (watchedDifference !== 0) return watchedDifference;
      }

      const fallbackDifference = parseDate(right.created_at) - parseDate(left.created_at);
      if (fallbackDifference !== 0) return fallbackDifference;

      return left.title.localeCompare(right.title);
    });

    return sorted;
  }, [initialPlaylists, sortBy]);

  const playlists = useMemo(() => {
    const query = playlistSearch.trim().toLowerCase();
    if (!query) return sortedPlaylists;

    return sortedPlaylists.filter((playlist) =>
      [playlist.title, playlist.channel, playlist.source_url]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [playlistSearch, sortedPlaylists]);

  useEffect(() => {
    if (activeJobs.length === 0) return;

    const interval = window.setInterval(async () => {
      const updates = await Promise.all(
        activeJobs.map(async (job) => {
          const response = await fetch(`/api/import-jobs/${job.id}`, { cache: "no-store" });
          if (!response.ok) return job;
          const data = (await response.json()) as { job: ImportJob };
          return data.job;
        })
      );

      setJobs((current) =>
        current.map((job) => updates.find((update) => update.id === job.id) ?? job)
      );

      if (updates.some((job) => job.status === "complete")) {
        window.location.reload();
      }
    }, 1800);

    return () => window.clearInterval(interval);
  }, [activeJobs]);

  useEffect(() => {
    if (!sortMenuOpen) return;

    function closeSortMenu(event: MouseEvent) {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    }

    function closeSortMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSortMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeSortMenu);
    document.addEventListener("keydown", closeSortMenuOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeSortMenu);
      document.removeEventListener("keydown", closeSortMenuOnEscape);
    };
  }, [sortMenuOpen]);

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = (await response.json()) as { job?: ImportJob; error?: string };

      if (!response.ok || !data.job) {
        throw new Error(data.error ?? "Import failed to start.");
      }

      setJobs((current) => [data.job!, ...current]);
      setUrl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed to start.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <section className="border-b border-[#d8d1c3] bg-[#fffdf8]">
        <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
          <div className="mb-8 max-w-3xl">
            <div className="mb-4 flex items-center gap-4">
              <Image
                src="/icon.svg"
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-[16px] shadow-sm"
                priority
              />
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-rust">
                Curatube
              </div>
            </div>
            <h1 className="text-3xl font-black leading-tight text-ink sm:text-4xl md:text-6xl">
              Learn without the distractions.
            </h1>
          </div>

          <form onSubmit={submitImport} className="flex flex-col gap-3 md:flex-row">
            <label className="sr-only" htmlFor="playlist-url">
              YouTube playlist URL
            </label>
            <input
              id="playlist-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a YouTube playlist URL"
              className="min-h-16 flex-1 rounded-md border border-[#c9c0b2] bg-white px-5 text-lg text-ink shadow-sm outline-none transition placeholder:text-[#82786b] focus:border-moss focus:ring-4 focus:ring-moss/15"
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-16 items-center justify-center gap-2 rounded-md bg-ink px-6 text-base font-bold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="animate-spin" size={19} /> : <Plus size={19} />}
              Import
            </button>
          </form>

          {error ? <p className="mt-3 text-sm font-medium text-rust">{error}</p> : null}

          {jobs.length > 0 ? (
            <div className="mt-5 grid gap-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col gap-2 rounded-md border border-[#d8d1c3] bg-paper px-4 py-3 text-sm md:flex-row md:items-center"
                >
                  <div className="flex flex-1 items-center gap-2">
                    {job.status === "running" || job.status === "queued" ? (
                      <Loader2 className="animate-spin text-moss" size={17} />
                    ) : (
                      <Clock className="text-rust" size={17} />
                    )}
                    <span className="font-semibold capitalize">{job.status}</span>
                    <span className="truncate text-[#6c6257]">{job.message ?? job.source_url}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-cloud md:w-40">
                    <div
                      className="h-full bg-moss transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        <div className="mb-4">
          <div>
            <h2 className="text-2xl font-black text-ink">Imported playlists</h2>
            <span className="text-sm font-semibold text-[#6c6257]">
              {playlists.length === initialPlaylists.length
                ? `${initialPlaylists.length} courses`
                : `${playlists.length} of ${initialPlaylists.length} courses`}
            </span>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <label className="sr-only" htmlFor="playlist-search">
                Search imported playlists
              </label>
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#82786b]"
              />
              <input
                id="playlist-search"
                value={playlistSearch}
                onChange={(event) => setPlaylistSearch(event.target.value)}
                placeholder="Search by playlist, channel, or URL"
                className="h-12 w-full rounded-md border border-[#c9c0b2] bg-[#fffdf8] pl-11 pr-11 text-base font-medium text-ink shadow-sm outline-none transition placeholder:text-[#82786b] focus:border-moss focus:bg-white focus:ring-4 focus:ring-moss/15"
              />
              {playlistSearch ? (
                <button
                  type="button"
                  onClick={() => setPlaylistSearch("")}
                  aria-label="Clear playlist search"
                  title="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#6c6257] transition hover:bg-cloud hover:text-ink"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <div ref={sortMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setSortMenuOpen((open) => !open)}
                aria-expanded={sortMenuOpen}
                aria-haspopup="menu"
                aria-label="Sort playlists"
                title="Sort playlists"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-[#c9c0b2] bg-[#fffdf8] px-4 text-sm font-bold text-ink shadow-sm transition hover:bg-cloud sm:w-12 sm:px-0"
              >
                <ArrowUpDown size={18} />
                <span className="sm:hidden">Sort</span>
              </button>
              {sortMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-md border border-[#d8d1c3] bg-white p-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortBy === "last-watched"}
                    onClick={() => {
                      setSortBy("last-watched");
                      setSortMenuOpen(false);
                    }}
                    className={`flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold transition ${
                      sortBy === "last-watched"
                        ? "bg-ink text-white"
                        : "text-[#413a33] hover:bg-cloud"
                    }`}
                  >
                    <Clock size={16} />
                    Last watched
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortBy === "date-added"}
                    onClick={() => {
                      setSortBy("date-added");
                      setSortMenuOpen(false);
                    }}
                    className={`mt-1 flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold transition ${
                      sortBy === "date-added"
                        ? "bg-ink text-white"
                        : "text-[#413a33] hover:bg-cloud"
                    }`}
                  >
                    <CalendarDays size={16} />
                    Date added
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {initialPlaylists.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-[#c9c0b2] bg-[#fffdf8] px-5 text-center">
            <BookOpen className="mb-4 text-moss" size={34} />
            <p className="max-w-md text-base font-semibold text-ink">
              Imported playlists will appear here after yt-dlp finishes fetching metadata.
            </p>
          </div>
        ) : playlists.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-[#c9c0b2] bg-[#fffdf8] px-5 text-center">
            <Search className="mb-4 text-moss" size={34} />
            <p className="max-w-md text-base font-semibold text-ink">
              No imported playlists match your search.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((playlist) => (
              <article
                key={playlist.id}
                className="group overflow-hidden rounded-md border border-[#d8d1c3] bg-[#fffdf8] shadow-sm transition hover:-translate-y-0.5 hover:border-moss hover:shadow-md"
              >
                <Link href={`/playlists/${playlist.id}`} className="block">
                  <div className="aspect-video bg-cloud">
                    {playlist.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={playlist.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-moss">
                        <BookOpen size={42} />
                      </div>
                    )}
                  </div>
                  <div className="p-4 pb-2">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-rust">
                      <span>{playlist.video_count} videos</span>
                      <span>{playlist.import_status}</span>
                    </div>
                    <h3 className="line-clamp-2 min-h-12 text-lg font-black leading-snug text-ink">
                      {playlist.title}
                    </h3>
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-3 px-4 pb-4">
                  <p className="min-w-0 truncate text-sm font-medium text-[#6c6257]">
                    {playlist.channel ?? "YouTube playlist"}
                  </p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ExportNotesButtons playlistId={playlist.id} playlistTitle={playlist.title} />
                    <Link
                      href={`/playlists/${playlist.id}`}
                      aria-label={`Open ${playlist.title}`}
                      title="Open course"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink text-white transition hover:bg-moss"
                    >
                      <ArrowRight
                        size={17}
                        className="transition group-hover:translate-x-0.5"
                      />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer className="border-t border-[#d8d1c3] bg-[#fffdf8]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-sm font-medium text-[#6c6257] sm:flex-row sm:items-center sm:justify-between">
          <span>
            Curatube
            {buildCommit ? (
              <span className="ml-2 font-mono text-xs text-[#82786b]">{buildCommit}</span>
            ) : null}
          </span>
          <a
            href="https://github.com/say4n/curatube"
            target="_blank"
            rel="noreferrer"
            aria-label="Open GitHub repository"
            title="GitHub repository"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink transition hover:bg-cloud hover:text-moss"
          >
            <Github size={18} />
          </a>
        </div>
      </footer>
    </main>
  );
}
