import { NextResponse } from "next/server";
import { getVideo } from "@/lib/db";
import { refreshDownloadStatus, startVideoDownload } from "@/lib/downloads";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  return NextResponse.json({ download: refreshDownloadStatus(videoId) });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  try {
    return NextResponse.json({ download: startVideoDownload(videoId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed to start." },
      { status: 404 }
    );
  }
}

