import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getVideo } from "@/lib/db";
import { getMediaRoot, refreshDownloadStatus } from "@/lib/downloads";

export const runtime = "nodejs";

function streamFile(filePath: string, start: number, end: number) {
  return Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
}

function parseRange(range: string, fileSize: number) {
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;

    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Math.min(Number.parseInt(rawEnd, 10), fileSize - 1) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
    return null;
  }

  return { start, end };
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
    const byteRange = parseRange(range, fileSize);

    if (!byteRange) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` }
      });
    }

    const { start, end } = byteRange;

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
