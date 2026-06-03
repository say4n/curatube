import { notFound, redirect } from "next/navigation";
import { getPlaylist, getPlaylistVideoProgress, getPlaylistVideos } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlaylistPage({
  params
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;
  const playlist = getPlaylist(playlistId);
  if (!playlist) notFound();

  const videos = getPlaylistVideos(playlistId);
  if (videos.length === 0) notFound();

  const progress = getPlaylistVideoProgress(playlistId);
  const completedVideoIds = new Set(
    progress.filter((p) => p.completed).map((p) => p.video_id)
  );

  const firstUncompleted = videos.find((v) => !completedVideoIds.has(v.id)) || videos[0];

  redirect(`/playlists/${playlistId}/videos/${encodeURIComponent(firstUncompleted.id)}`);
}
