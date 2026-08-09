import { NextResponse } from "next/server";
import { getTranscript, getVideo, searchTranscript } from "@/lib/db";
import { refreshVideoTranscript } from "@/lib/importer";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  if (!getVideo(videoId)) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";

  if (query.trim()) {
    return NextResponse.json({ transcript: searchTranscript(videoId, query) });
  }

  return NextResponse.json({ transcript: getTranscript(videoId) });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);

  try {
    await refreshVideoTranscript(videoId);
    return NextResponse.json({ transcript: getTranscript(videoId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcript refresh failed." },
      { status: 404 }
    );
  }
}
