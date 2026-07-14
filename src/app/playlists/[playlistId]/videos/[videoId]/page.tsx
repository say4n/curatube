import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { LearningWorkspace } from "@/components/learning-workspace";
import { ExportNotesButtons } from "@/components/export-notes-buttons";
import { DeletePlaylistButton } from "@/components/delete-playlist-button";
import {
  getNote,
  getPlaylist,
  getPlaylistVideoProgress,
  getPlaylistVideos,
  getVideoDownload,
  getVideoPreference,
  getVideoProgress,
  getTranscript,
  getVideo
} from "@/lib/db";
import { prepareVideoDownloadForStreaming } from "@/lib/downloads";

import { backfillVideos } from "@/lib/thumbnails";

export const dynamic = "force-dynamic";

export default async function VideoPage({
  params
}: {
  params: Promise<{ playlistId: string; videoId: string }>;
}) {
  const { playlistId, videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);
  const playlist = getPlaylist(playlistId);
  if (!playlist) notFound();

  const videos = getPlaylistVideos(playlistId);
  if (videos.length === 0) notFound();

  await backfillVideos(videos);

  const video = getVideo(videoId);
  if (!video || video.playlist_id !== playlistId) {
    redirect(`/playlists/${playlistId}/videos/${encodeURIComponent(videos[0].id)}`);
  }

  const transcript = getTranscript(video.id);
  const note = getNote(video.id);
  const videoProgress = getPlaylistVideoProgress(playlistId);
  const progress = getVideoProgress(video.id);
  const preference = getVideoPreference(video.id);
  const download = getVideoDownload(video.id);
  const refreshedDownload =
    download?.status === "ready" ? await prepareVideoDownloadForStreaming(video.id) : download;
  const initialDownloadStatus = refreshedDownload
    ? {
        video_id: refreshedDownload.video_id,
        status: refreshedDownload.status,
        file_size_bytes: refreshedDownload.file_size_bytes,
        progress_percent: refreshedDownload.progress_percent,
        downloaded_bytes: refreshedDownload.downloaded_bytes,
        total_bytes: refreshedDownload.total_bytes,
        speed_bytes_per_second: refreshedDownload.speed_bytes_per_second,
        eta_seconds: refreshedDownload.eta_seconds,
        error: refreshedDownload.error
      }
    : null;

  return (
    <main className="min-h-screen min-h-dvh bg-[#f7f4ef]">
      <div className="border-b border-[#d8d1c3] bg-[#fffdf8]/85 backdrop-blur">
        <div className="flex w-full items-center gap-2 px-3 py-2 sm:gap-4 sm:px-5 sm:py-3">
          <Link
            href="/"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud sm:h-9 sm:w-9"
            aria-label="Back to playlists"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-moss">{playlist.title}</p>
            <h1 className="truncate text-base font-bold text-ink">{video.title}</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ExportNotesButtons playlistId={playlist.id} playlistTitle={playlist.title} />
            <DeletePlaylistButton playlistId={playlist.id} playlistTitle={playlist.title} />
          </div>
        </div>
      </div>

      <LearningWorkspace
        playlist={playlist}
        videos={videos}
        video={video}
        transcript={transcript}
        initialNote={note}
        initialProgressSeconds={progress?.position_seconds ?? 0}
        initialVideoProgress={videoProgress}
        initialPreferLocalPlayback={preference?.prefer_local_playback ?? null}
        initialYoutubeEmbedBlocked={Boolean(preference?.youtube_embed_blocked_at)}
        initialDownloadStatus={initialDownloadStatus}
      />
    </main>
  );
}
