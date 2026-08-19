import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db, getVideo, getVideoDownload, type Video, type VideoDownload } from "./db";
import { mediaDir } from "./paths";

const execFileAsync = promisify(execFile);
const runningDownloads = new Set<string>();
const runningPreparations = new Map<string, Promise<VideoDownload>>();
const runningYtDlp = new Map<string, ReturnType<typeof spawn>>();
const abortedDownloads = new Set<string>();
const mediaRoot = mediaDir;
const videoExtensions = new Set([".mp4", ".webm", ".mkv", ".mov"]);
const preferredDownloadFormat =
  "bv*[vcodec^=vp9][height<=1440][fps<=60]+ba[acodec^=opus]/" +
  "b[vcodec^=vp9][acodec^=opus][height<=1440][fps<=60]/" +
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
    Pick<
      VideoDownload,
      | "status"
      | "file_path"
      | "file_size_bytes"
      | "mime_type"
      | "progress_percent"
      | "downloaded_bytes"
      | "total_bytes"
      | "speed_bytes_per_second"
      | "eta_seconds"
      | "error"
    >
  >
) {
  const current = ensureDownloadRow(videoId);

  db.prepare(
    `UPDATE video_downloads
     SET status = ?,
         file_path = ?,
         file_size_bytes = ?,
         mime_type = ?,
         progress_percent = ?,
         downloaded_bytes = ?,
         total_bytes = ?,
         speed_bytes_per_second = ?,
         eta_seconds = ?,
         error = ?,
         updated_at = ?
     WHERE video_id = ?`
  ).run(
    values.status ?? current.status,
    values.file_path === undefined ? current.file_path : values.file_path,
    values.file_size_bytes === undefined
      ? current.file_size_bytes
      : values.file_size_bytes,
    values.mime_type === undefined ? current.mime_type : values.mime_type,
    values.progress_percent === undefined
      ? current.progress_percent
      : values.progress_percent,
    values.downloaded_bytes === undefined
      ? current.downloaded_bytes
      : values.downloaded_bytes,
    values.total_bytes === undefined ? current.total_bytes : values.total_bytes,
    values.speed_bytes_per_second === undefined
      ? current.speed_bytes_per_second
      : values.speed_bytes_per_second,
    values.eta_seconds === undefined ? current.eta_seconds : values.eta_seconds,
    values.error === undefined ? current.error : values.error,
    now(),
    videoId
  );
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NA" || trimmed === "N/A") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDownloadProgress(line: string) {
  if (!line.startsWith("curatube-progress:")) return null;

  const [, percent, downloadedBytes, totalBytes, speed, eta] = line.split("|");
  const progressPercent = nullableNumber(percent?.replace("%", "") ?? "");
  const parsedDownloadedBytes = nullableNumber(downloadedBytes ?? "");
  const parsedTotalBytes = nullableNumber(totalBytes ?? "");

  return {
    progress_percent: progressPercent === null ? null : Math.max(0, Math.min(100, progressPercent)),
    downloaded_bytes: parsedDownloadedBytes,
    total_bytes:
      parsedDownloadedBytes !== null &&
      parsedTotalBytes !== null &&
      parsedTotalBytes < parsedDownloadedBytes
        ? null
        : parsedTotalBytes,
    speed_bytes_per_second: nullableNumber(speed ?? ""),
    eta_seconds: nullableNumber(eta ?? "")
  };
}

async function runYtDlp(videoId: string, args: string[], onLine: (line: string) => void) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so cancellation can kill yt-dlp and its ffmpeg
      // merge subprocess together.
      detached: true
    });
    runningYtDlp.set(videoId, child);
    let output = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    function handleChunk(chunk: Buffer, stream: "stdout" | "stderr") {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        output += text;
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) onLine(line.trim());
      } else {
        stderr += text;
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) onLine(line.trim());
      }
    }

    child.stdout.on("data", (chunk: Buffer) => handleChunk(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => handleChunk(chunk, "stderr"));
    child.on("error", (error) => {
      runningYtDlp.delete(videoId);
      reject(error);
    });
    child.on("close", (code) => {
      runningYtDlp.delete(videoId);
      if (stdoutBuffer.trim()) onLine(stdoutBuffer.trim());
      if (stderrBuffer.trim()) onLine(stderrBuffer.trim());
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || output.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
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

async function optimizeFileForStreaming(filePath: string) {
  // WebM (VP9 + Opus) streams progressively and seeks via cues in every
  // supported browser, so no remux is needed.
  if (path.extname(filePath).toLowerCase() === ".webm") {
    return filePath;
  }

  const extension = path.extname(filePath);
  const basePath = filePath.slice(0, -extension.length);
  const finalPath = extension.toLowerCase() === ".mp4" ? filePath : `${basePath}.mp4`;
  const temporaryPath = `${finalPath}.${process.pid}.${Date.now()}.tmp.mp4`;

  if (await isMp4OptimizedForStreaming(finalPath)) {
    return finalPath;
  }

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
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        temporaryPath
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );

    await fsp.rm(filePath, { force: true });
    await fsp.rename(temporaryPath, finalPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }

  return finalPath;
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

async function prepareVideoDownloadForStreamingNow(videoId: string) {
  const download = refreshDownloadStatus(videoId);

  if (download.status !== "ready" || !download.file_path) {
    return download;
  }

  const playableFilePath = await optimizeFileForStreaming(download.file_path);
  const playableStats = await fsp.stat(playableFilePath);

  if (playableFilePath !== download.file_path || playableStats.size !== download.file_size_bytes) {
    setDownload(videoId, {
      file_path: playableFilePath,
      file_size_bytes: playableStats.size,
      mime_type: mimeTypeFor(playableFilePath),
      error: null
    });
  }

  return getVideoDownload(videoId)!;
}

export async function prepareVideoDownloadForStreaming(videoId: string) {
  const existing = runningPreparations.get(videoId);
  if (existing) return existing;

  const preparation = prepareVideoDownloadForStreamingNow(videoId).finally(() => {
    runningPreparations.delete(videoId);
  });
  runningPreparations.set(videoId, preparation);

  return preparation;
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
      progress_percent: null,
      downloaded_bytes: null,
      total_bytes: null,
      speed_bytes_per_second: null,
      eta_seconds: null,
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
      progress_percent: null,
      downloaded_bytes: null,
      total_bytes: null,
      speed_bytes_per_second: null,
      eta_seconds: null,
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
  if (current.status === "ready") return current;
  if (runningDownloads.has(videoId)) return getVideoDownload(videoId)!;

  // A stale "queued"/"running" row can be left behind by a crashed process.
  // Restart yt-dlp, which resumes any partial .part files still on disk.
  setDownload(videoId, {
    status: "queued",
    progress_percent: 0,
    downloaded_bytes: null,
    total_bytes: null,
    speed_bytes_per_second: null,
    eta_seconds: null,
    error: null
  });

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
    progress_percent: null,
    downloaded_bytes: null,
    total_bytes: null,
    speed_bytes_per_second: null,
    eta_seconds: null,
    error: null
  });

  return getVideoDownload(videoId)!;
}

async function removeIncompleteDownloads(video: Video) {
  const downloadDirectory = path.join(
    mediaRoot,
    safeSegment(video.playlist_id),
    safeSegment(video.youtube_id)
  );

  const entries = await fsp.readdir(downloadDirectory, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".part")) continue;
    if (videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      await fsp.rm(path.join(downloadDirectory, entry.name), { force: true }).catch(() => {});
    }
  }
}

export async function cancelVideoDownload(videoId: string) {
  abortedDownloads.add(videoId);

  const child = runningYtDlp.get(videoId);
  if (child?.pid) {
    runningYtDlp.delete(videoId);
    try {
      // Kill the process group so yt-dlp and any ffmpeg merge subprocess die
      // together. .part files are kept on disk so a later start can resume.
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already gone.
      }
    }
  }

  const video = getVideo(videoId);
  if (video) {
    await removeIncompleteDownloads(video);
  }

  setDownload(videoId, {
    status: "missing",
    file_path: null,
    file_size_bytes: null,
    mime_type: null,
    progress_percent: null,
    downloaded_bytes: null,
    total_bytes: null,
    speed_bytes_per_second: null,
    eta_seconds: null,
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
    if (abortedDownloads.has(videoId)) {
      abortedDownloads.delete(videoId);
      return;
    }
    setDownload(videoId, {
      status: "running",
      file_path: null,
      file_size_bytes: null,
      mime_type: null,
      progress_percent: 0,
      downloaded_bytes: null,
      total_bytes: null,
      speed_bytes_per_second: null,
      eta_seconds: null,
      error: null
    });

    await runYtDlp(
      videoId,
      [
        "--newline",
        "--no-playlist",
        "--continue",
        "--restrict-filenames",
        "--windows-filenames",
        "--plugin-dirs",
        "/opt/yt-dlp-plugins",
        "--extractor-args",
        "youtube:player_client=mweb",
        "-f",
        preferredDownloadFormat,
        "--merge-output-format",
        "webm/mp4",
        "--progress-template",
        "download:curatube-progress:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s",
        "-o",
        path.join(downloadDirectory, "%(title).180B [%(id)s].%(ext)s"),
        videoUrl(video.youtube_id)
      ],
      (line) => {
        if (abortedDownloads.has(videoId)) return;
        const progress = parseDownloadProgress(line);
        if (progress) setDownload(videoId, progress);
      }
    );
    if (abortedDownloads.has(videoId)) {
      abortedDownloads.delete(videoId);
      return;
    }

    const downloadedFile = await findDownloadedFile(downloadDirectory);
    if (!downloadedFile) {
      throw new Error("yt-dlp completed but no playable video file was found.");
    }
    if (abortedDownloads.has(videoId)) {
      abortedDownloads.delete(videoId);
      return;
    }

    const playableFilePath = await optimizeFileForStreaming(downloadedFile.filePath);
    if (abortedDownloads.has(videoId)) {
      abortedDownloads.delete(videoId);
      return;
    }
    const playableStats = await fsp.stat(playableFilePath);

    setDownload(videoId, {
      status: "ready",
      file_path: playableFilePath,
      file_size_bytes: playableStats.size,
      mime_type: mimeTypeFor(playableFilePath),
      progress_percent: 100,
      downloaded_bytes: playableStats.size,
      total_bytes: playableStats.size,
      speed_bytes_per_second: null,
      eta_seconds: null,
      error: null
    });
  } catch (error) {
    if (abortedDownloads.has(videoId)) {
      abortedDownloads.delete(videoId);
      return;
    }
    setDownload(videoId, {
      status: "failed",
      file_path: null,
      file_size_bytes: null,
      progress_percent: null,
      downloaded_bytes: null,
      total_bytes: null,
      speed_bytes_per_second: null,
      eta_seconds: null,
      mime_type: null,
      error: error instanceof Error ? error.message : "Download failed."
    });
  }
}
