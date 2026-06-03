import { notFound, redirect } from "next/navigation";
import { getPlaylist, getPlaylistVideos } from "@/lib/db";

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

  redirect(`/playlists/${playlistId}/videos/${encodeURIComponent(videos[0].id)}`);
}
