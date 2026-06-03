import { NextResponse } from "next/server";
import { getNote, getPlaylist, getPlaylistVideos } from "@/lib/db";
import { markdownFilename, playlistNotesMarkdown } from "@/lib/note-export";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const { playlistId } = await params;
  const playlist = getPlaylist(playlistId);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  const videoNotes = getPlaylistVideos(playlistId).map((video) => ({
    video,
    note: getNote(video.id)
  }));
  const markdown = playlistNotesMarkdown(playlist, videoNotes);

  return new NextResponse(markdown, {
    headers: {
      "Content-Disposition": `attachment; filename="${markdownFilename(playlist.title)}"`,
      "Content-Type": "text/markdown; charset=utf-8"
    }
  });
}
