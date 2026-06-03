import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getVideo } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  body: z.string().max(200_000)
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);
  const video = getVideo(videoId);

  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note body." }, { status: 400 });
  }

  db.prepare(
    `INSERT INTO notes (video_id, body, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(video_id) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at`
  ).run(videoId, parsed.data.body);

  return NextResponse.json({ ok: true });
}
