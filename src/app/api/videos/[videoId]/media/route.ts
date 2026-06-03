import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getVideo } from "@/lib/db";
import { getMediaRoot, refreshDownloadStatus } from "@/lib/downloads";

export const runtime = "nodejs";

function streamFile(filePath: string, start: number, end: number) {
  return Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;
  const videoId = decodeURIComponent(rawVideoId);
  const video = getVideo(videoId);

  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const download = refreshDownloadStatus(videoId);
  if (download.status !== "ready" || !download.file_path) {
    return NextResponse.json({ error: "Video is not downloaded." }, { status: 404 });
  }

  const mediaRoot = getMediaRoot();
  const resolvedFilePath = fs.realpathSync(download.file_path);
  const resolvedMediaRoot = fs.realpathSync(mediaRoot);

  if (!resolvedFilePath.startsWith(`${resolvedMediaRoot}/`)) {
    return NextResponse.json({ error: "Invalid media path." }, { status: 403 });
  }

  const stats = fs.statSync(resolvedFilePath);
  const fileSize = stats.size;
  const contentType = download.mime_type ?? "video/mp4";
  const range = request.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new Response(null, { status: 416 });
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` }
      });
    }

    return new Response(streamFile(resolvedFilePath, start, end), {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Type": contentType
      }
    });
  }

  return new Response(streamFile(resolvedFilePath, 0, fileSize - 1), {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileSize),
      "Content-Type": contentType
    }
  });
}

