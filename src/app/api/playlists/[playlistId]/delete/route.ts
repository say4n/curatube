import { NextResponse } from "next/server";
import { getPlaylist, getPlaylistVideos, setPlaylistDeleted } from "@/lib/db";
import { deleteVideoDownload } from "@/lib/downloads";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const { playlistId } = await params;

  if (!getPlaylist(playlistId)) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  const videos = getPlaylistVideos(playlistId);
  for (const video of videos) {
    await deleteVideoDownload(video.id);
  }

  return NextResponse.json({
    playlist: setPlaylistDeleted(playlistId)
  });
}
