"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Trash2
} from "lucide-react";
import type { Playlist, TranscriptSegment, Video, VideoProgress } from "@/lib/db";
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
        playVideo?: () => void;
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
  initialVideoProgress: VideoProgress[];
  initialPreferLocalPlayback: boolean | null;
  initialYoutubeEmbedBlocked: boolean;
  initialDownloadStatus: DownloadStatus | null;
};

let youtubeApiPromise: Promise<void> | null = null;
const notesWidthStorageKey = "curatube:notes-width";
const minNotesWidth = 320;
const maxNotesWidth = 680;

type DownloadStatus = {
  video_id: string;
  status: "missing" | "queued" | "running" | "ready" | "failed";
  file_size_bytes: number | null;
  progress_percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed_bytes_per_second: number | null;
  eta_seconds: number | null;
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

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function joinMetadata(parts: Array<string | null>) {
  return parts.filter(Boolean).join(" · ");
}

function clampNotesWidth(width: number) {
  return Math.min(maxNotesWidth, Math.max(minNotesWidth, width));
}

export function LearningWorkspace({
  playlist,
  videos,
  video,
  transcript,
  initialNote,
  initialProgressSeconds,
  initialVideoProgress,
  initialPreferLocalPlayback,
  initialYoutubeEmbedBlocked,
  initialDownloadStatus
}: Props) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [notesWidth, setNotesWidth] = useState(420);
  const [courseListOpen, setCourseListOpen] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState(transcript);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [youtubePlayerVisible, setYoutubePlayerVisible] = useState(false);
  const [embedBlocked, setEmbedBlocked] = useState(initialYoutubeEmbedBlocked);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(initialDownloadStatus);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [preferLocalPlayback, setPreferLocalPlayback] = useState<boolean | null>(
    initialPreferLocalPlayback
  );
  const [pendingLocalSeek, setPendingLocalSeek] = useState<number | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(initialProgressSeconds);
  const [videoCompletion, setVideoCompletion] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      initialVideoProgress.map((progress) => [progress.video_id, progress.completed === 1])
    )
  );
  const playerRef = useRef<{
    destroy?: () => void;
    getCurrentTime?: () => number;
    getDuration?: () => number;
    playVideo?: () => void;
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  } | null>(null);
  const youtubeHostRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const isUnloadingRef = useRef(false);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const transcriptItemRefs = useRef(new Map<number, HTMLButtonElement>());
  const playerElementId = useMemo(() => `youtube-player-${video.youtube_id}`, [video.youtube_id]);
  const encodedVideoId = encodeURIComponent(video.id);
  const downloadIsActive =
    downloadStatus?.status === "queued" || downloadStatus?.status === "running";
  const localVideoReady = downloadStatus?.status === "ready";
  const localVideoActive = localVideoReady && (embedBlocked || preferLocalPlayback !== false);
  const shouldUseYouTubePlayer = !localVideoActive;
  const canSwitchPlayer = localVideoReady && !embedBlocked;
  const downloadProgressPercent =
    typeof downloadStatus?.progress_percent === "number" &&
    Number.isFinite(downloadStatus.progress_percent)
      ? Math.max(0, Math.min(100, downloadStatus.progress_percent))
      : null;
  const downloadIsFinalizing =
    downloadIsActive && downloadProgressPercent !== null && downloadProgressPercent >= 99.95;
  const validDownloadTotalBytes =
    typeof downloadStatus?.downloaded_bytes === "number" &&
    typeof downloadStatus?.total_bytes === "number" &&
    downloadStatus.total_bytes >= downloadStatus.downloaded_bytes
      ? downloadStatus.total_bytes
      : null;
  const downloadedLabel = formatBytes(downloadStatus?.downloaded_bytes ?? null);
  const totalLabel = formatBytes(validDownloadTotalBytes);
  const transferLabel =
    downloadedLabel && totalLabel
      ? `${downloadedLabel} of ${totalLabel}`
      : downloadedLabel;
  const speedLabel =
    downloadIsActive &&
    !downloadIsFinalizing &&
    typeof downloadStatus?.speed_bytes_per_second === "number" &&
    downloadStatus.speed_bytes_per_second >= 1024
      ? `${formatBytes(downloadStatus.speed_bytes_per_second)}/s`
      : null;
  const etaLabel =
    downloadIsActive && !downloadIsFinalizing
      ? formatDuration(downloadStatus?.eta_seconds ?? null)
      : null;
  const downloadProgressDetail = joinMetadata([
    transferLabel,
    speedLabel,
    etaLabel ? `ETA ${etaLabel}` : null
  ]);
  const showDownloadPanel =
    downloadIsActive ||
    downloadStatus?.status === "failed" ||
    Boolean(downloadStatus?.error);
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
    setVideoCompletion(
      Object.fromEntries(
        initialVideoProgress.map((progress) => [progress.video_id, progress.completed === 1])
      )
    );
  }, [initialVideoProgress]);

  useEffect(() => {
    setPlayerReady(false);
    setYoutubePlayerVisible(false);
    setEmbedBlocked(initialYoutubeEmbedBlocked);
    setDownloadStatus(initialDownloadStatus);
    setPreferLocalPlayback(initialPreferLocalPlayback);
    setPendingLocalSeek(null);
    setCurrentPlaybackTime(initialProgressSeconds);
    isUnloadingRef.current = false;
    // Server-provided playback state seeds the client only when navigating to a new video.
    // Local delete/download actions should not be overwritten by player mode changes.
  }, [initialYoutubeEmbedBlocked, video.id]);

  useEffect(() => {
    setCourseListOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(notesWidthStorageKey));
    if (Number.isFinite(savedWidth)) {
      setNotesWidth(clampNotesWidth(savedWidth));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let revealTimer: number | null = null;
    setPlayerReady(false);
    setYoutubePlayerVisible(false);
    setEmbedBlocked(initialYoutubeEmbedBlocked);

    if (!shouldUseYouTubePlayer || initialYoutubeEmbedBlocked) {
      setPlayerReady(true);
      setYoutubePlayerVisible(false);
      return () => {
        cancelled = true;
      };
    }

    loadYouTubeApi().then(() => {
      if (cancelled || !window.YT?.Player) return;
      const host = youtubeHostRef.current;
      if (!host) return;

      host.replaceChildren();
      const playerElement = document.createElement("div");
      playerElement.id = playerElementId;
      playerElement.className = "h-full w-full";
      host.appendChild(playerElement);

      playerRef.current = new window.YT.Player(playerElementId, {
        videoId: video.youtube_id,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          ...(initialProgressSeconds > 5 ? { start: Math.floor(initialProgressSeconds) } : {})
        },
        events: {
          onReady: () => {
            revealTimer = window.setTimeout(() => {
              if (cancelled || !playerRef.current) return;
              setPlayerReady(true);
              setYoutubePlayerVisible(true);
            }, 400);
          },
          onError: (event) => {
            if (event.data === 101 || event.data === 150) {
              if (revealTimer !== null) {
                window.clearTimeout(revealTimer);
                revealTimer = null;
              }
              setYoutubePlayerVisible(false);
              setEmbedBlocked(true);
              void saveYoutubeEmbedBlocked();
            }
          },
          onStateChange: (event) => {
            if (event.data === 0) {
              setVideoCompletion((current) => ({ ...current, [video.id]: true }));
              void saveProgress(true);
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      if (revealTimer !== null) {
        window.clearTimeout(revealTimer);
      }
      setYoutubePlayerVisible(false);
      try {
        playerRef.current?.destroy?.();
      } catch {
        // The YouTube iframe API owns this DOM node after initialization.
      }
      youtubeHostRef.current?.replaceChildren();
      playerRef.current = null;
    };
  }, [
    initialProgressSeconds,
    initialYoutubeEmbedBlocked,
    playerElementId,
    shouldUseYouTubePlayer,
    video.youtube_id
  ]);

  useEffect(() => {
    if (!playerReady || embedBlocked || localVideoActive) return;

    const interval = window.setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.();
      if (typeof currentTime === "number" && currentTime > 0) {
        setCurrentPlaybackTime(currentTime);
        void saveProgress();
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [embedBlocked, localVideoActive, playerReady, video.id]);

  useEffect(() => {
    if (!playerReady || embedBlocked || localVideoActive) return;

    const interval = window.setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.();
      if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
        setCurrentPlaybackTime(currentTime);
      }
    }, 750);

    return () => window.clearInterval(interval);
  }, [embedBlocked, localVideoActive, playerReady, video.id]);

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
    if (!downloadIsActive) return;

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/videos/${encodedVideoId}/download`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { download: DownloadStatus };
      setDownloadStatus(data.download);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [downloadIsActive, encodedVideoId]);

  useEffect(() => {
    if (pendingLocalSeek === null || !localVideoActive || !localVideoRef.current) return;

    playLocalVideoFrom(pendingLocalSeek);
    setPendingLocalSeek(null);
  }, [localVideoActive, pendingLocalSeek]);

  function playLocalVideoFrom(seconds: number) {
    const element = localVideoRef.current;
    if (!element) return;

    const playAfterSeek = () => {
      element.removeEventListener("seeked", playAfterSeek);
      void element.play().catch(() => {});
    };

    element.pause();
    element.addEventListener("seeked", playAfterSeek, { once: true });
    element.currentTime = seconds;
    void element.play().catch(() => {});
    window.setTimeout(() => {
      element.removeEventListener("seeked", playAfterSeek);
      if (Math.abs(element.currentTime - seconds) < 0.75) {
        void element.play().catch(() => {});
      }
    }, 900);
  }

  async function saveProgress(completed?: boolean, positionOverride?: number, durationOverride?: number | null) {
    const position =
      positionOverride ??
      (localVideoActive
        ? localVideoRef.current?.currentTime
        : playerRef.current?.getCurrentTime?.());
    const duration =
      durationOverride ??
      (localVideoActive ? localVideoRef.current?.duration : playerRef.current?.getDuration?.());

    if (typeof position !== "number" || Number.isNaN(position) || position < 0) return;

    const response = await fetch(`/api/videos/${encodedVideoId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position_seconds: position,
        duration_seconds:
          typeof duration === "number" && Number.isFinite(duration) && duration > 0
            ? duration
            : null,
        ...(typeof completed === "boolean" ? { completed } : {})
      })
    });

    if (!response.ok) return;

    const data = (await response.json()) as { progress: VideoProgress | null };
    if (data.progress?.completed === 1) {
      setVideoCompletion((current) => ({ ...current, [data.progress!.video_id]: true }));
    }
  }

  async function toggleVideoCompletion(targetVideoId: string) {
    const nextCompleted = !videoCompletion[targetVideoId];
    setVideoCompletion((current) => ({ ...current, [targetVideoId]: nextCompleted }));

    const response = await fetch(`/api/videos/${encodeURIComponent(targetVideoId)}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: nextCompleted })
    });

    if (!response.ok) {
      setVideoCompletion((current) => ({ ...current, [targetVideoId]: !nextCompleted }));
      return;
    }

    const data = (await response.json()) as { progress: VideoProgress | null };
    if (data.progress) {
      setVideoCompletion((current) => ({
        ...current,
        [data.progress!.video_id]: data.progress!.completed === 1
      }));
    }
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
    if (localVideoActive && localVideoRef.current) {
      playLocalVideoFrom(seconds);
      setCurrentPlaybackTime(seconds);
    } else if (embedBlocked) {
      setPendingLocalSeek(seconds);
      setCurrentPlaybackTime(seconds);
    } else {
      playerRef.current?.seekTo(seconds, true);
      playerRef.current?.playVideo?.();
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

  async function saveYoutubeEmbedBlocked() {
    await fetch(`/api/videos/${encodedVideoId}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtube_embed_blocked_at: new Date().toISOString() })
    });
  }

  async function togglePreferredPlayer() {
    if (!localVideoReady) return;

    const nextPreferLocal = !localVideoActive;
    setPreferLocalPlayback(nextPreferLocal);

    const response = await fetch(`/api/videos/${encodedVideoId}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefer_local_playback: nextPreferLocal })
    });

    if (!response.ok) {
      setPreferLocalPlayback(!nextPreferLocal);
      return;
    }

    const data = (await response.json()) as {
      preferences: { prefer_local_playback: boolean } | null;
    };
    if (data.preferences) {
      setPreferLocalPlayback(data.preferences.prefer_local_playback);
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

    isUnloadingRef.current = true;
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
      isUnloadingRef.current = false;
    }
  }

  function startNotesResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!window.matchMedia("(min-width: 1280px)").matches) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = notesWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextWidth = clampNotesWidth(startWidth + startX - pointerEvent.clientX);
      setNotesWidth(nextWidth);
    }

    function stopResize(pointerEvent: PointerEvent) {
      const nextWidth = clampNotesWidth(startWidth + startX - pointerEvent.clientX);
      setNotesWidth(nextWidth);
      window.localStorage.setItem(notesWidthStorageKey, String(nextWidth));
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
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
        <div className="hover-scrollbar max-h-[42vh] overflow-y-auto p-3 lg:sticky lg:top-0 lg:max-h-[calc(100vh-65px)]">
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
          <div className="grid gap-1.5">
            {videos.map((item) => {
              const completed = videoCompletion[item.id] === true;

              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-2 rounded-md p-1.5 text-sm transition ${
                    item.id === video.id
                      ? "bg-ink text-white"
                      : "text-[#413a33] hover:bg-cloud"
                  }`}
                >
                  <Link
                    href={`/playlists/${playlist.id}/videos/${encodeURIComponent(item.id)}`}
                    className="relative block aspect-video overflow-hidden rounded bg-cloud"
                  >
                    {item.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnail_url}
                        alt=""
                        className={`h-full w-full object-cover transition ${
                          completed ? "grayscale opacity-45" : ""
                        }`}
                      />
                    ) : (
                      <div
                        className={`flex h-full items-center justify-center bg-[#e8e1d6] text-moss transition ${
                          completed ? "grayscale opacity-45" : ""
                        }`}
                      >
                        <FileText size={18} />
                      </div>
                    )}
                  </Link>
                  <Link
                    href={`/playlists/${playlist.id}/videos/${encodeURIComponent(item.id)}`}
                    className={`min-w-0 rounded px-1 py-1 transition ${completed ? "opacity-55" : ""}`}
                  >
                    <span className="mb-0.5 block text-xs font-bold opacity-70">
                      {String(item.position).padStart(2, "0")}
                    </span>
                    <span className="line-clamp-2 font-semibold leading-snug">{item.title}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      void toggleVideoCompletion(item.id);
                    }}
                    aria-pressed={completed}
                    aria-label={completed ? "Mark video incomplete" : "Mark video complete"}
                    title={completed ? "Mark incomplete" : "Mark complete"}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${
                      item.id === video.id
                        ? "bg-white/10 text-white hover:bg-white/20"
                        : completed
                          ? "bg-moss text-white hover:bg-moss/85"
                          : "border border-[#c9c0b2] bg-white text-[#6c6257] hover:bg-cloud hover:text-ink"
                    }`}
                  >
                    {completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="flex min-h-[calc(100vh-65px)] flex-col xl:h-[calc(100vh-65px)] xl:min-h-0">
          <div
            className={`grid min-h-0 min-w-0 flex-1 gap-0 xl:overflow-hidden ${
              notesOpen ? "xl:grid-cols-[minmax(0,1fr)_var(--notes-width)]" : ""
            }`}
            style={
              notesOpen
                ? ({ "--notes-width": `${notesWidth}px` } as CSSProperties)
                : undefined
            }
          >
            <div className="hover-scrollbar min-w-0 p-3 sm:p-4 md:p-6 xl:min-h-0 xl:overflow-y-auto">
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
                  {shouldUseYouTubePlayer ? (
                    <div
                      ref={youtubeHostRef}
                      className={`h-full w-full ${
                        youtubePlayerVisible && !embedBlocked
                          ? ""
                          : "invisible pointer-events-none"
                      }`}
                    />
                  ) : null}
                  {localVideoActive ? (
                    <video
                      ref={localVideoRef}
                      src={`/api/videos/${encodedVideoId}/media`}
                      title={video.title}
                      className="absolute inset-0 h-full w-full"
                      controls
                      playsInline
                      preload="auto"
                      onError={() => {
                        void refreshDownloadStatus();
                      }}
                      onLoadedMetadata={(event) => {
                        if (initialProgressSeconds > 5) {
                          event.currentTarget.currentTime = initialProgressSeconds;
                        }
                      }}
                      onTimeUpdate={(event) => {
                        if (isUnloadingRef.current) return;
                        const currentTime = event.currentTarget.currentTime;
                        const duration = event.currentTarget.duration;
                        setCurrentPlaybackTime(currentTime);
                        if (
                          !videoCompletion[video.id] &&
                          Number.isFinite(duration) &&
                          duration > 0 &&
                          currentTime / duration >= 0.95
                        ) {
                          setVideoCompletion((current) => ({ ...current, [video.id]: true }));
                          void saveProgress(undefined, currentTime, duration);
                        }
                        if (Math.floor(currentTime) % 5 === 0) {
                          void saveProgress(undefined, currentTime, duration);
                        }
                      }}
                      onPause={(event) => {
                        void saveProgress(undefined, event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                      onEnded={(event) => {
                        setVideoCompletion((current) => ({ ...current, [video.id]: true }));
                        void saveProgress(true, event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                    />
                  ) : null}
                </div>
                {embedBlocked && !localVideoActive ? (
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
              <div className="mt-3 flex flex-col gap-3 rounded-md bg-[#fffdf8] px-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#6c6257]">
                    {playerReady ? (
                      <Check size={16} className="text-moss" />
                    ) : (
                      <Loader2 size={16} className="animate-spin text-moss" />
                    )}
                    <span>
                      {localVideoActive
                        ? "Local download"
                        : embedBlocked
                          ? downloadIsActive
                            ? "Downloading"
                            : "Embed blocked"
                        : playerReady
                          ? "Player ready"
                          : "Loading player"}
                    </span>
                  </div>
                  {showDownloadPanel ? (
                    <div className="mt-2 min-h-[76px] max-w-md rounded-md border border-[#e1d9cc] bg-white px-3 py-2 shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#6c6257]">
                          {downloadStatus?.status === "ready"
                            ? "Downloaded video"
                            : downloadStatus?.status === "failed"
                              ? "Download failed"
                              : "Downloading video"}
                        </span>
                        <span className="min-w-[86px] rounded-full bg-cloud px-2 py-0.5 text-center font-mono text-xs font-bold text-moss">
                          {downloadStatus?.status === "ready"
                            ? "Ready"
                            : downloadStatus?.status === "failed"
                              ? "Failed"
                              : downloadIsFinalizing
                                ? "Finalizing"
                                : downloadProgressPercent !== null
                                  ? `${downloadProgressPercent.toFixed(1)}%`
                                  : "Starting"}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[#e8e1d6]">
                        <div
                          className="h-full rounded-full bg-moss transition-[width] duration-500 ease-out"
                          style={{
                            width:
                              downloadStatus?.status === "ready"
                                ? "100%"
                                : `${downloadProgressPercent ?? 6}%`
                          }}
                        />
                      </div>
                      {downloadStatus?.status === "ready" &&
                      formatBytes(downloadStatus.file_size_bytes) ? (
                        <div className="mt-1.5 truncate font-mono text-xs leading-5 text-[#81776a]">
                          {formatBytes(downloadStatus.file_size_bytes)}
                        </div>
                      ) : downloadProgressDetail ? (
                        <div className="mt-1.5 truncate font-mono text-xs leading-5 text-[#81776a]">
                          {downloadProgressDetail}
                        </div>
                      ) : downloadStatus?.error ? (
                        <div className="mt-1.5 truncate text-xs leading-5 text-rust">
                          {downloadStatus.error}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {downloadStatus && !showDownloadPanel ? (
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
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
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
                  {canSwitchPlayer ? (
                    <button
                      type="button"
                      onClick={togglePreferredPlayer}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#c9c0b2] bg-white px-3 text-xs font-bold text-ink transition hover:bg-cloud"
                    >
                      {localVideoActive ? <ExternalLink size={15} /> : <Download size={15} />}
                      {localVideoActive ? "Use YouTube" : "Use local"}
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

              <div className="mt-4 overflow-hidden rounded-xl border border-[#d8d1c3] bg-[#fffdf8] p-4">
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
                  <div className="overflow-hidden rounded-lg border border-[#d8d1c3] bg-white">
                    <div
                      ref={transcriptListRef}
                      className="hover-scrollbar max-h-[52vh] overflow-y-auto md:max-h-[38vh] xl:max-h-[360px]"
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
                          className={`grid w-full grid-cols-[56px_minmax(0,1fr)] gap-3 border-b border-[#eee9de] px-3 py-3 text-left text-sm transition last:border-b-0 hover:bg-cloud sm:grid-cols-[72px_minmax(0,1fr)] sm:px-4 ${
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
                  </div>
                )}
              </div>
            </div>

            {notesOpen ? (
              <div className="relative h-full min-h-0 min-w-0 self-stretch overflow-hidden">
                <button
                  type="button"
                  onPointerDown={startNotesResize}
                  aria-label="Resize notes pane"
                  title="Resize notes pane"
                  className="absolute left-0 top-0 z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none xl:flex"
                >
                  <span className="h-12 w-1 rounded-full bg-[#c9c0b2] opacity-0 transition hover:opacity-100" />
                </button>
                <NoteEditor videoId={video.id} initialNote={initialNote} onSeek={seekTo} />
              </div>
            ) : null}
          </div>

        </div>
      </section>
    </div>
  );
}
