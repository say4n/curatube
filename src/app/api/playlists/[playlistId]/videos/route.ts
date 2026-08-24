import { NextResponse } from "next/server";
import { getPlaylist, getPlaylistVideos } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const { playlistId: rawPlaylistId } = await params;
  const playlistId = decodeURIComponent(rawPlaylistId);

  if (!getPlaylist(playlistId)) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  return NextResponse.json({ videos: getPlaylistVideos(playlistId) });
}