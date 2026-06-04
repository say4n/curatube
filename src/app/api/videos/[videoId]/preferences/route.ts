import { NextResponse } from "next/server";
import { z } from "zod";
import { getVideo, getVideoPreference, setVideoPreference } from "@/lib/db";

export const runtime = "nodejs";

const patchSchema = z.object({
  prefer_local_playback: z.boolean()
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  return NextResponse.json({
    preferences: getVideoPreference(videoId) ?? {
      video_id: videoId,
      prefer_local_playback: false,
      created_at: now,
      updated_at: now
    }
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preferences payload." }, { status: 400 });
  }

  return NextResponse.json({
    preferences: setVideoPreference(videoId, {
      prefer_local_playback: parsed.data.prefer_local_playback
    })
  });
}
