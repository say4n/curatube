import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlaylist, setPlaylistArchived } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  archived: z.boolean()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const { playlistId } = await params;

  if (!getPlaylist(playlistId)) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid archive payload." }, { status: 400 });
  }

  return NextResponse.json({
    playlist: setPlaylistArchived(playlistId, parsed.data.archived)
  });
}
