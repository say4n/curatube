import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getVideo, getVideoProgress } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  position_seconds: z.number().finite().min(0),
  duration_seconds: z.number().finite().min(0).nullable().optional(),
  completed: z.boolean().optional()
});

const patchSchema = z
  .object({
    completed: z.boolean().optional()
  })
  .refine((value) => value.completed !== undefined);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  return NextResponse.json({ progress: getVideoProgress(videoId) ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid progress payload." }, { status: 400 });
  }

  const duration = parsed.data.duration_seconds ?? null;
  const completed =
    parsed.data.completed ??
    (duration !== null && duration > 0 && parsed.data.position_seconds / duration >= 0.95
      ? true
      : getVideoProgress(videoId)?.completed === 1);

  if (process.env.DEMO_MODE_ENABLED === "true") {
    return NextResponse.json({
      progress: {
        video_id: videoId,
        position_seconds: parsed.data.position_seconds,
        duration_seconds: duration,
        completed: completed ? 1 : 0,
        updated_at: new Date().toISOString(),
      }
    });
  }

  db.prepare(
    `INSERT INTO video_progress
      (video_id, position_seconds, duration_seconds, completed, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(video_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at`
  ).run(
    videoId,
    parsed.data.position_seconds,
    duration,
    completed ? 1 : 0
  );

  return NextResponse.json({ progress: getVideoProgress(videoId) });
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
    return NextResponse.json({ error: "Invalid progress patch payload." }, { status: 400 });
  }

  const current = getVideoProgress(videoId);

  if (process.env.DEMO_MODE_ENABLED === "true") {
    return NextResponse.json({
      progress: {
        video_id: videoId,
        position_seconds: current?.position_seconds ?? 0,
        duration_seconds: current?.duration_seconds ?? null,
        completed:
          parsed.data.completed === undefined
            ? current?.completed ?? 0
            : parsed.data.completed
              ? 1
              : 0,
        updated_at: new Date().toISOString(),
      }
    });
  }

  db.prepare(
    `INSERT INTO video_progress
      (video_id, position_seconds, duration_seconds, completed, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(video_id) DO UPDATE SET
      completed = excluded.completed,
      updated_at = excluded.updated_at`
  ).run(
    videoId,
    current?.position_seconds ?? 0,
    current?.duration_seconds ?? null,
    parsed.data.completed === undefined
      ? current?.completed ?? 0
      : parsed.data.completed
        ? 1
        : 0
  );

  return NextResponse.json({ progress: getVideoProgress(videoId) });
}
