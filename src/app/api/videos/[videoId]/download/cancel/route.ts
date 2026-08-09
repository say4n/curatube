import { NextResponse } from "next/server";
import { getVideo } from "@/lib/db";
import { cancelVideoDownload } from "@/lib/downloads";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const download = await cancelVideoDownload(videoId);

  return NextResponse.json({ download });
}
