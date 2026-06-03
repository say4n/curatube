import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db, getVideo, getVideoDownload, type VideoDownload } from "./db";
import { mediaDir } from "./paths";

const execFileAsync = promisify(execFile);
const runningDownloads = new Set<string>();
const mediaRoot = mediaDir;
const videoExtensions = new Set([".mp4", ".webm", ".mkv", ".mov"]);
const preferredDownloadFormat =
  "bv*[ext=mp4][height<=1440][fps<=60]+ba[ext=m4a]/" +
  "b[ext=mp4][height<=1440][fps<=60]/" +
  "bv*[height<=1440][fps<=60]+ba/" +
  "b[height<=1440][fps<=60]/" +
  "bv*[height<=1440]+ba/b[height<=1440]/bv*+ba/best";

function now() {
  return new Date().toISOString();
}

function videoUrl(youtubeId: string) {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function mimeTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

function ensureDownloadRow(videoId: string) {
  const existing = getVideoDownload(videoId);
  if (existing) return existing;

  db.prepare(
    `INSERT INTO video_downloads (video_id, status, created_at, updated_at)
     VALUES (?, 'missing', ?, ?)`
  ).run(videoId, now(), now());

  return getVideoDownload(videoId)!;
}

function setDownload(
  videoId: string,
  values: Partial<
    Pick<VideoDownload, "status" | "file_path" | "file_size_bytes" | "mime_type" | "error">
  >
) {
  const current = ensureDownloadRow(videoId);

  db.prepare(
    `UPDATE video_downloads
     SET status = ?, file_path = ?, file_size_bytes = ?, mime_type = ?, error = ?, updated_at = ?
     WHERE video_id = ?`
  ).run(
    values.status ?? current.status,
    values.file_path === undefined ? current.file_path : values.file_path,
    values.file_size_bytes === undefined
      ? current.file_size_bytes
      : values.file_size_bytes,
    values.mime_type === undefined ? current.mime_type : values.mime_type,
    values.error === undefined ? current.error : values.error,
    now(),
    videoId
  );
}

async function findDownloadedFile(directory: string) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fsp.stat(filePath);
        return { filePath, size: stats.size };
      })
  );

  return files.sort((a, b) => b.size - a.size)[0] ?? null;
}

async function optimizeMp4ForStreaming(filePath: string) {
  if (path.extname(filePath).toLowerCase() !== ".mp4") return filePath;
  if (await isMp4OptimizedForStreaming(filePath)) return filePath;

  const temporaryPath = `${filePath}.faststart.mp4`;

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        temporaryPath
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );

    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }

  return filePath;
}

async function isMp4OptimizedForStreaming(filePath: string) {
  const handle = await fsp.open(filePath, "r");

  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("latin1");
    const moovIndex = header.indexOf("moov");
    const mdatIndex = header.indexOf("mdat");

    return moovIndex !== -1 && (mdatIndex === -1 || moovIndex < mdatIndex);
  } finally {
    await handle.close();
  }
}

export async function prepareVideoDownloadForStreaming(videoId: string) {
  const download = refreshDownloadStatus(videoId);

  if (download.status !== "ready" || !download.file_path) {
    return download;
  }

  const playableFilePath = await optimizeMp4ForStreaming(download.file_path);
  const playableStats = await fsp.stat(playableFilePath);

  if (playableStats.size !== download.file_size_bytes) {
    setDownload(videoId, {
      file_size_bytes: playableStats.size,
      mime_type: mimeTypeFor(playableFilePath),
      error: null
    });
  }

  return getVideoDownload(videoId)!;
}

export function getMediaRoot() {
  return mediaRoot;
}

export function refreshDownloadStatus(videoId: string) {
  const download = ensureDownloadRow(videoId);

  if (download.status !== "ready" || !download.file_path) {
    return download;
  }

  if (!fs.existsSync(download.file_path)) {
    setDownload(videoId, {
      status: "missing",
      file_path: null,
      file_size_bytes: null,
      mime_type: null,
      error: "Downloaded file is missing from disk."
    });
    return getVideoDownload(videoId)!;
  }

  const stats = fs.statSync(download.file_path);
  if (!stats.isFile()) {
    setDownload(videoId, {
      status: "missing",
      file_path: null,
      file_size_bytes: null,
      mime_type: null,
      error: "Downloaded path is not a file."
    });
    return getVideoDownload(videoId)!;
  }

  if (download.file_size_bytes !== stats.size) {
    setDownload(videoId, { file_size_bytes: stats.size, error: null });
    return getVideoDownload(videoId)!;
  }

  return download;
}

export function startVideoDownload(videoId: string) {
  const video = getVideo(videoId);
  if (!video) {
    throw new Error("Video not found.");
  }

  const current = refreshDownloadStatus(videoId);
  if (current.status === "ready" || current.status === "running") {
    return current;
  }

  setDownload(videoId, {
    status: "queued",
    error: null
  });

  if (runningDownloads.has(videoId)) {
    return getVideoDownload(videoId)!;
  }

  runningDownloads.add(videoId);
  void runVideoDownload(videoId).finally(() => {
    runningDownloads.delete(videoId);
  });

  return getVideoDownload(videoId)!;
}

export async function deleteVideoDownload(videoId: string) {
  const download = ensureDownloadRow(videoId);

  if (download.file_path) {
    const resolvedFilePath = path.resolve(download.file_path);
    const resolvedMediaRoot = path.resolve(mediaRoot);

    if (resolvedFilePath.startsWith(`${resolvedMediaRoot}${path.sep}`)) {
      await fsp.rm(path.dirname(resolvedFilePath), { recursive: true, force: true });
    }
  }

  setDownload(videoId, {
    status: "missing",
    file_path: null,
    file_size_bytes: null,
    mime_type: null,
    error: null
  });

  return getVideoDownload(videoId)!;
}

async function runVideoDownload(videoId: string) {
  const video = getVideo(videoId);
  if (!video) return;

  const downloadDirectory = path.join(
    mediaRoot,
    safeSegment(video.playlist_id),
    safeSegment(video.youtube_id)
  );

  try {
    await fsp.mkdir(downloadDirectory, { recursive: true });
    setDownload(videoId, {
      status: "running",
      file_path: null,
      file_size_bytes: null,
      mime_type: null,
      error: null
    });

    await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "--restrict-filenames",
        "--windows-filenames",
        "-f",
        preferredDownloadFormat,
        "--merge-output-format",
        "mp4",
        "-o",
        path.join(downloadDirectory, "%(title).180B [%(id)s].%(ext)s"),
        videoUrl(video.youtube_id)
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );

    const downloadedFile = await findDownloadedFile(downloadDirectory);
    if (!downloadedFile) {
      throw new Error("yt-dlp completed but no playable video file was found.");
    }

    const playableFilePath = await optimizeMp4ForStreaming(downloadedFile.filePath);
    const playableStats = await fsp.stat(playableFilePath);

    setDownload(videoId, {
      status: "ready",
      file_path: playableFilePath,
      file_size_bytes: playableStats.size,
      mime_type: mimeTypeFor(playableFilePath),
      error: null
    });
  } catch (error) {
    setDownload(videoId, {
      status: "failed",
      file_path: null,
      file_size_bytes: null,
      mime_type: null,
      error: error instanceof Error ? error.message : "Download failed."
    });
  }
}
