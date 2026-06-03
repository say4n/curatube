"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Trash2
} from "lucide-react";
import type { Playlist, TranscriptSegment, Video } from "@/lib/db";
import { formatTimestamp } from "@/lib/time";
import { NoteEditor } from "./note-editor";

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
  events?: {
            onReady?: () => void;
            onError?: (event: { data: number }) => void;
            onStateChange?: (event: { data: number }) => void;
          };
        }
      ) => {
        destroy?: () => void;
        getCurrentTime?: () => number;
        getDuration?: () => number;
        seekTo: (seconds: number, allowSeekAhead: boolean) => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type Props = {
  playlist: Playlist;
  videos: Video[];
  video: Video;
  transcript: TranscriptSegment[];
  initialNote: string;
  initialProgressSeconds: number;
};

let youtubeApiPromise: Promise<void> | null = null;

type DownloadStatus = {
  video_id: string;
  status: "missing" | "queued" | "running" | "ready" | "failed";
  file_size_bytes: number | null;
  error: string | null;
};

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function LearningWorkspace({
  playlist,
  videos,
  video,
  transcript,
  initialNote,
  initialProgressSeconds
}: Props) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [courseListOpen, setCourseListOpen] = useState(true);
  const [transcriptSegments, setTranscriptSegments] = useState(transcript);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [pendingLocalSeek, setPendingLocalSeek] = useState<number | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(initialProgressSeconds);
  const playerRef = useRef<{
    destroy?: () => void;
    getCurrentTime?: () => number;
    getDuration?: () => number;
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  } | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const transcriptItemRefs = useRef(new Map<number, HTMLButtonElement>());
  const playerElementId = useMemo(() => `youtube-player-${video.youtube_id}`, [video.youtube_id]);
  const encodedVideoId = encodeURIComponent(video.id);
  const downloadIsActive =
    downloadStatus?.status === "queued" || downloadStatus?.status === "running";
  const localVideoReady = embedBlocked && downloadStatus?.status === "ready";
  const activeTranscriptIndex = useMemo(() => {
    if (transcriptSegments.length === 0) return -1;

    const nextIndex = transcriptSegments.findIndex(
      (segment) => segment.start_seconds > currentPlaybackTime
    );

    return nextIndex === -1 ? transcriptSegments.length - 1 : Math.max(0, nextIndex - 1);
  }, [currentPlaybackTime, transcriptSegments]);

  useEffect(() => {
    setTranscriptSegments(transcript);
  }, [transcript, video.id]);

  useEffect(() => {
    let cancelled = false;
    setPlayerReady(false);
    setEmbedBlocked(false);
    setDownloadStatus(null);
    setPendingLocalSeek(null);
    setCurrentPlaybackTime(initialProgressSeconds);

    loadYouTubeApi().then(() => {
      if (cancelled || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(playerElementId, {
        videoId: video.youtube_id,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1
        },
        events: {
          onReady: () => {
            setPlayerReady(true);
            if (initialProgressSeconds > 5) {
              playerRef.current?.seekTo(initialProgressSeconds, true);
            }
          },
          onError: (event) => {
            if (event.data === 101 || event.data === 150) {
              setEmbedBlocked(true);
            }
          },
          onStateChange: (event) => {
            if (event.data === 0) {
              void saveProgress(true);
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // The YouTube iframe API owns this DOM node after initialization.
      }
      playerRef.current = null;
    };
  }, [initialProgressSeconds, playerElementId, video.youtube_id]);

  useEffect(() => {
    if (!playerReady || embedBlocked) return;

    const interval = window.setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.();
      if (typeof currentTime === "number" && currentTime > 0) {
        setCurrentPlaybackTime(currentTime);
        void saveProgress();
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [embedBlocked, playerReady, video.id]);

  useEffect(() => {
    if (!playerReady || embedBlocked) return;

    const interval = window.setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.();
      if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
        setCurrentPlaybackTime(currentTime);
      }
    }, 750);

    return () => window.clearInterval(interval);
  }, [embedBlocked, playerReady, video.id]);

  useEffect(() => {
    if (activeTranscriptIndex < 0) return;

    const segment = transcriptSegments[activeTranscriptIndex];
    if (!segment) return;

    const list = transcriptListRef.current;
    const item = transcriptItemRefs.current.get(segment.id);
    if (!list || !item) return;

    list.scrollTo({
      top: item.offsetTop - list.offsetTop,
      behavior: "smooth"
    });
  }, [activeTranscriptIndex, transcriptSegments]);

  useEffect(() => {
    if (!embedBlocked) return;

    let cancelled = false;

    async function loadDownloadStatus() {
      setDownloadBusy(true);
      try {
        const response = await fetch(`/api/videos/${encodedVideoId}/download`, {
          cache: "no-store"
        });
        if (!response.ok) return;
        const data = (await response.json()) as { download: DownloadStatus };
        if (!cancelled) setDownloadStatus(data.download);
      } finally {
        if (!cancelled) setDownloadBusy(false);
      }
    }

    void loadDownloadStatus();

    return () => {
      cancelled = true;
    };
  }, [embedBlocked, encodedVideoId]);

  useEffect(() => {
    if (!embedBlocked || !downloadIsActive) return;

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/videos/${encodedVideoId}/download`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { download: DownloadStatus };
      setDownloadStatus(data.download);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [downloadIsActive, embedBlocked, encodedVideoId]);

  useEffect(() => {
    if (pendingLocalSeek === null || !localVideoReady || !localVideoRef.current) return;

    localVideoRef.current.currentTime = pendingLocalSeek;
    setPendingLocalSeek(null);
  }, [localVideoReady, pendingLocalSeek]);

  async function saveProgress(completed = false, positionOverride?: number, durationOverride?: number | null) {
    const position =
      positionOverride ??
      (localVideoReady
        ? localVideoRef.current?.currentTime
        : playerRef.current?.getCurrentTime?.());
    const duration =
      durationOverride ??
      (localVideoReady ? localVideoRef.current?.duration : playerRef.current?.getDuration?.());

    if (typeof position !== "number" || Number.isNaN(position) || position < 0) return;

    await fetch(`/api/videos/${encodedVideoId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position_seconds: position,
        duration_seconds:
          typeof duration === "number" && Number.isFinite(duration) && duration > 0
            ? duration
            : null,
        completed
      })
    });
  }

  async function refreshTranscript() {
    setTranscriptBusy(true);
    try {
      const response = await fetch(`/api/videos/${encodedVideoId}/transcript`, {
        method: "POST"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { transcript: TranscriptSegment[] };
      setTranscriptSegments(data.transcript);
    } finally {
      setTranscriptBusy(false);
    }
  }

  function seekTo(seconds: number) {
    if (localVideoReady && localVideoRef.current) {
      localVideoRef.current.currentTime = seconds;
      setCurrentPlaybackTime(seconds);
    } else if (embedBlocked) {
      setPendingLocalSeek(seconds);
      setCurrentPlaybackTime(seconds);
    } else {
      playerRef.current?.seekTo(seconds, true);
      setCurrentPlaybackTime(seconds);
    }

    document.getElementById("player-region")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshDownloadStatus() {
    setDownloadBusy(true);
    try {
      const response = await fetch(`/api/videos/${encodedVideoId}/download`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { download: DownloadStatus };
      setDownloadStatus(data.download);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function startDownload() {
    setDownloadBusy(true);
    try {
      const response = await fetch(`/api/videos/${encodedVideoId}/download`, {
        method: "POST"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { download: DownloadStatus };
      setDownloadStatus(data.download);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function deleteDownload() {
    const confirmed = window.confirm("Delete the downloaded video file from local storage?");
    if (!confirmed) return;

    setDownloadBusy(true);
    try {
      if (localVideoRef.current) {
        localVideoRef.current.pause();
        localVideoRef.current.removeAttribute("src");
        localVideoRef.current.load();
      }

      const response = await fetch(`/api/videos/${encodedVideoId}/download/delete`, {
        method: "POST"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { download: DownloadStatus };
      setDownloadStatus(data.download);
    } finally {
      setDownloadBusy(false);
    }
  }

  return (
    <div
      className={`grid w-full gap-0 ${
        courseListOpen ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-1"
      }`}
    >
      <aside
        className={`border-b border-[#d8d1c3] bg-[#fffdf8] lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r ${
          courseListOpen ? "block" : "hidden"
        }`}
      >
        <div className="sticky top-0 max-h-[calc(100vh-65px)] overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between gap-2 px-2">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-rust">
              Course videos
            </div>
            <button
              type="button"
              onClick={() => setCourseListOpen(false)}
              aria-label="Collapse course videos"
              title="Collapse course videos"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d8d1c3] bg-white text-ink transition hover:bg-cloud"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="grid gap-1">
            {videos.map((item) => (
              <Link
                key={item.id}
                href={`/playlists/${playlist.id}/videos/${encodeURIComponent(item.id)}`}
                className={`rounded-md px-3 py-2 text-sm transition ${
                  item.id === video.id
                    ? "bg-ink text-white"
                    : "text-[#413a33] hover:bg-cloud"
                }`}
              >
                <span className="mb-1 block text-xs font-bold opacity-70">
                  {String(item.position).padStart(2, "0")}
                </span>
                <span className="line-clamp-2 font-semibold leading-snug">{item.title}</span>
              </Link>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="grid min-h-[calc(100vh-65px)] grid-rows-[auto_1fr]">
          <div
            className={`grid min-w-0 gap-0 ${
              notesOpen ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""
            }`}
          >
            <div className="min-w-0 p-4 md:p-6">
              {!courseListOpen ? (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => setCourseListOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c9c0b2] bg-white px-3 text-sm font-bold text-ink transition hover:bg-cloud"
                  >
                    <PanelLeftOpen size={17} />
                    Course videos
                  </button>
                </div>
              ) : null}
              <div id="player-region" className="relative overflow-hidden rounded-md bg-black shadow-lg">
                <div className="relative aspect-video">
                  <div
                    id={playerElementId}
                    className={`h-full w-full ${embedBlocked ? "opacity-0" : ""}`}
                  />
                  {localVideoReady ? (
                    <video
                      ref={localVideoRef}
                      src={`/api/videos/${encodedVideoId}/media`}
                      title={video.title}
                      className="absolute inset-0 h-full w-full"
                      controls
                      playsInline
                      onError={() => {
                        void refreshDownloadStatus();
                      }}
                      onLoadedMetadata={(event) => {
                        if (initialProgressSeconds > 5) {
                          event.currentTarget.currentTime = initialProgressSeconds;
                        }
                      }}
                      onTimeUpdate={(event) => {
                        const currentTime = event.currentTarget.currentTime;
                        setCurrentPlaybackTime(currentTime);
                        if (Math.floor(currentTime) % 5 === 0) {
                          void saveProgress(false, currentTime, event.currentTarget.duration);
                        }
                      }}
                      onPause={(event) => {
                        void saveProgress(false, event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                      onEnded={(event) => {
                        void saveProgress(true, event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                    />
                  ) : null}
                </div>
                {embedBlocked && !localVideoReady ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#171717]/95 px-5 text-center text-white">
                    <div className="max-w-lg">
                      <Download className="mx-auto mb-4 text-white/85" size={34} />
                      <p className="text-lg font-black">YouTube blocked embedded playback.</p>
                      <p className="mt-2 text-sm leading-6 text-white/75">
                        Use the controls below the player to download a local copy with yt-dlp or
                        open the lesson on YouTube.
                      </p>
                    </div>
                  </div>
                ) : null}
                {embedBlocked && downloadStatus?.status === "missing" ? (
                  <div className="absolute inset-x-0 bottom-0 bg-rust px-3 py-2 text-center text-xs font-bold text-white">
                    Local file is missing. Start the download again to restore playback.
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-col gap-3 rounded-md bg-[#fffdf8] px-1 py-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#6c6257]">
                    {playerReady ? (
                      <Check size={16} className="text-moss" />
                    ) : (
                      <Loader2 size={16} className="animate-spin text-moss" />
                    )}
                    <span>
                      {embedBlocked
                        ? localVideoReady
                          ? "Local download"
                          : downloadIsActive
                            ? "Downloading"
                            : "Embed blocked"
                        : playerReady
                          ? "Player ready"
                          : "Loading player"}
                    </span>
                  </div>
                  {embedBlocked ? (
                    <div className="mt-0.5 text-xs leading-5 text-[#81776a]">
                      {downloadStatus?.status === "ready" &&
                      formatBytes(downloadStatus.file_size_bytes) ? (
                        <span className="font-mono">
                          {formatBytes(downloadStatus.file_size_bytes)}
                        </span>
                      ) : null}
                      {downloadStatus?.status === "missing" ? <span>Local file missing</span> : null}
                      {downloadStatus?.status === "failed" ? <span>Download failed</span> : null}
                      {downloadStatus?.error ? (
                        <div className="mt-1 text-rust">{downloadStatus.error}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  {embedBlocked ? (
                    <>
                      {downloadStatus?.status === "failed" ||
                      downloadStatus?.status === "missing" ||
                      !downloadStatus ? (
                        <button
                          type="button"
                          onClick={startDownload}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-ink px-3 text-xs font-bold text-white transition hover:bg-[#2d2924]"
                        >
                          {downloadBusy ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <Download size={15} />
                          )}
                          Download
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={refreshDownloadStatus}
                        aria-label="Refresh download status"
                        title="Refresh download status"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud"
                      >
                        {downloadBusy ? (
                          <Loader2 className="animate-spin" size={15} />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                      </button>
                      {localVideoReady ? (
                        <button
                          type="button"
                          onClick={deleteDownload}
                          aria-label="Delete downloaded video"
                          title="Delete downloaded video"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-rust text-white transition hover:bg-rust/85"
                        >
                          {downloadBusy ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      ) : null}
                      <a
                        href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open on YouTube"
                        title="Open on YouTube"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud"
                      >
                        <ExternalLink size={15} />
                      </a>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setNotesOpen((open) => !open)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c9c0b2] bg-white px-3 text-sm font-bold text-ink transition hover:bg-cloud"
                  >
                    <FileText size={17} />
                    Notes
                    {notesOpen ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
                  </button>
                </div>
              </div>
            </div>

            {notesOpen ? (
              <NoteEditor videoId={video.id} initialNote={initialNote} onSeek={seekTo} />
            ) : null}
          </div>

          <div className="border-t border-[#d8d1c3] bg-[#fffdf8]">
            <div className="px-4 py-4 md:px-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-ink">Transcript</h2>
                <span className="text-sm font-semibold text-[#6c6257]">
                  {transcriptSegments.length} segments
                </span>
              </div>

              {transcriptSegments.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[#c9c0b2] bg-paper px-4 text-center text-sm font-semibold text-[#6c6257]">
                  <span>No English transcript is stored for this video yet.</span>
                  <button
                    type="button"
                    onClick={refreshTranscript}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-xs font-bold text-white transition hover:bg-moss"
                  >
                    {transcriptBusy ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    Fetch transcript
                  </button>
                </div>
              ) : (
                <div
                  ref={transcriptListRef}
                  className="max-h-[38vh] overflow-y-auto rounded-md border border-[#d8d1c3] bg-white"
                >
                  {transcriptSegments.map((segment, index) => (
                    <button
                      key={segment.id}
                      ref={(element) => {
                        if (element) {
                          transcriptItemRefs.current.set(segment.id, element);
                        } else {
                          transcriptItemRefs.current.delete(segment.id);
                        }
                      }}
                      type="button"
                      onClick={() => seekTo(segment.start_seconds)}
                      className={`grid w-full grid-cols-[72px_minmax(0,1fr)] gap-3 border-b border-[#eee9de] px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-cloud ${
                        index === activeTranscriptIndex ? "bg-cloud" : ""
                      }`}
                    >
                      <span className="font-mono font-bold text-rust">
                        {formatTimestamp(segment.start_seconds)}
                      </span>
                      <span className="leading-relaxed text-[#312c27]">{segment.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
