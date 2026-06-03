import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { LearningWorkspace } from "@/components/learning-workspace";
import {
  getNote,
  getPlaylist,
  getPlaylistVideos,
  getVideoDownload,
  getVideoProgress,
  getTranscript,
  getVideo
} from "@/lib/db";
import { prepareVideoDownloadForStreaming } from "@/lib/downloads";

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

  const video = getVideo(videoId);
  if (!video || video.playlist_id !== playlistId) {
    redirect(`/playlists/${playlistId}/videos/${encodeURIComponent(videos[0].id)}`);
  }

  const transcript = getTranscript(video.id);
  const note = getNote(video.id);
  const progress = getVideoProgress(video.id);
  const download = getVideoDownload(video.id);
  const refreshedDownload =
    download?.status === "ready" ? await prepareVideoDownloadForStreaming(video.id) : download;
  const initialDownloadStatus = refreshedDownload
    ? {
        video_id: refreshedDownload.video_id,
        status: refreshedDownload.status,
        file_size_bytes: refreshedDownload.file_size_bytes,
        error: refreshedDownload.error
      }
    : null;

  return (
    <main className="min-h-screen bg-[#f7f4ef]">
      <div className="border-b border-[#d8d1c3] bg-[#fffdf8]/85 backdrop-blur">
        <div className="flex w-full items-center gap-4 px-5 py-3">
          <Link
            href="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#c9c0b2] bg-white text-ink transition hover:bg-cloud"
            aria-label="Back to playlists"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-moss">{playlist.title}</p>
            <h1 className="truncate text-base font-bold text-ink">{video.title}</h1>
          </div>
          <a
            href={`/api/playlists/${encodeURIComponent(playlist.id)}/notes/export`}
            download
            className="ml-auto inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#c9c0b2] bg-white px-3 text-sm font-bold text-ink transition hover:bg-cloud"
          >
            <Download size={17} />
            <span className="hidden sm:inline">Export notes</span>
            <span className="sm:hidden">Export</span>
          </a>
        </div>
      </div>

      <LearningWorkspace
        playlist={playlist}
        videos={videos}
        video={video}
        transcript={transcript}
        initialNote={note}
        initialProgressSeconds={progress?.position_seconds ?? 0}
        initialDownloadStatus={initialDownloadStatus}
      />
    </main>
  );
}
