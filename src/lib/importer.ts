import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { db, getImportJob } from "./db";
import { readBestVttFile } from "./transcripts";

const execFileAsync = promisify(execFile);
const runningJobs = new Set<string>();

const flatPlaylistSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  channel: z.string().optional(),
  uploader: z.string().optional(),
  webpage_url: z.string().optional(),
  thumbnail: z.string().optional(),
  thumbnails: z.array(z.object({ url: z.string().optional() })).optional(),
  entries: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
        duration: z.number().optional().nullable(),
        thumbnail: z.string().optional().nullable(),
        thumbnails: z.array(z.object({ url: z.string().optional() })).optional()
      })
    )
    .default([])
});

function now() {
  return new Date().toISOString();
}

function makeJobId() {
  return crypto.randomUUID();
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function bestThumbnail(input: {
  thumbnail?: string | null;
  thumbnails?: { url?: string }[];
}) {
  return input.thumbnail ?? input.thumbnails?.at(-1)?.url ?? null;
}

function videoUrl(youtubeId: string) {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

function setJob(
  id: string,
  values: Partial<{
    status: "queued" | "running" | "complete" | "failed";
    progress: number;
    message: string | null;
    playlist_id: string | null;
    error: string | null;
  }>
) {
  const current = getImportJob(id);
  if (!current) return;

  db.prepare(
    `UPDATE import_jobs
     SET status = ?, progress = ?, message = ?, playlist_id = ?, error = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    values.status ?? current.status,
    values.progress ?? current.progress,
    values.message === undefined ? current.message : values.message,
    values.playlist_id === undefined ? current.playlist_id : values.playlist_id,
    values.error === undefined ? current.error : values.error,
    now(),
    id
  );
}

export function createImportJob(sourceUrl: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return {
      id: makeJobId(),
      source_url: sourceUrl,
      status: "failed",
      progress: 0,
      message: "Importing is disabled in demo mode",
      playlist_id: null,
      error: "Demo mode active",
      created_at: now(),
      updated_at: now(),
    } as any;
  }

  const id = makeJobId();

  db.prepare(
    `INSERT INTO import_jobs (id, source_url, status, progress, message, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, 'Queued', ?, ?)`
  ).run(id, sourceUrl, now(), now());

  return getImportJob(id)!;
}

async function fetchPlaylist(sourceUrl: string) {
  const { stdout } = await execFileAsync(
    "yt-dlp",
    ["--dump-single-json", "--flat-playlist", "--no-warnings", "--skip-download", sourceUrl],
    { maxBuffer: 64 * 1024 * 1024 }
  );

  return flatPlaylistSchema.parse(JSON.parse(stdout));
}

export async function fetchTranscript(youtubeId: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "curatube-"));

  try {
    const baseArgs = [
      "--skip-download",
      "--sub-langs",
      "en-US,en-orig,en.*,en",
      "--sub-format",
      "vtt",
      "-o",
      path.join(tempDir, "%(id)s.%(ext)s"),
      videoUrl(youtubeId)
    ];

    for (const subtitleFlag of ["--write-subs", "--write-auto-subs"]) {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.mkdir(tempDir, { recursive: true });

      try {
        await execFileAsync("yt-dlp", [subtitleFlag, ...baseArgs], {
          maxBuffer: 32 * 1024 * 1024
        });
      } catch {
        continue;
      }

      const segments = await readBestVttFile(tempDir);
      if (segments.length > 0) return segments;
    }

    return [];
  } catch {
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function refreshVideoTranscript(videoId: string) {
  const video = db.prepare(`SELECT id, youtube_id FROM videos WHERE id = ?`).get(videoId) as
    | { id: string; youtube_id: string }
    | undefined;

  if (!video) {
    throw new Error("Video not found.");
  }

  const segments = await fetchTranscript(video.youtube_id);
  const insertSegment = db.prepare(
    `INSERT OR REPLACE INTO transcript_segments
      (video_id, start_seconds, duration_seconds, text, position)
     VALUES (?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    db.prepare(`DELETE FROM transcript_segments WHERE video_id = ?`).run(video.id);
    segments.forEach((segment, segmentIndex) => {
      insertSegment.run(
        video.id,
        segment.start,
        Math.max(0, segment.end - segment.start),
        segment.text,
        segmentIndex + 1
      );
    });
  })();

  return segments.length;
}

export function startImportJob(jobId: string) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  void runImport(jobId).finally(() => {
    runningJobs.delete(jobId);
  });
}

async function runImport(jobId: string) {
  const job = getImportJob(jobId);
  if (!job) return;

  try {
    setJob(jobId, { status: "running", progress: 5, message: "Fetching playlist metadata" });
    const playlist = await fetchPlaylist(job.source_url);
    const playlistId = safeId(playlist.id ?? new URL(job.source_url).searchParams.get("list") ?? jobId);
    const entries = playlist.entries.filter((entry) => entry.id ?? entry.url);
    const videos = entries.map((entry, index) => {
      const youtubeId = entry.id ?? entry.url!;
      return {
        id: `${playlistId}:${youtubeId}`,
        playlistId,
        youtubeId,
        title: entry.title ?? "Untitled video",
        thumbnail: bestThumbnail(entry),
        duration: entry.duration ?? null,
        position: index + 1
      };
    });

    db.transaction(() => {
      db.prepare(
        `INSERT INTO playlists
          (id, source_url, title, channel, thumbnail_url, video_count, import_status, import_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'importing', NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          channel = excluded.channel,
          thumbnail_url = excluded.thumbnail_url,
          video_count = excluded.video_count,
          import_status = 'importing',
          import_error = NULL,
          updated_at = excluded.updated_at`
      ).run(
        playlistId,
        job.source_url,
        playlist.title ?? "Imported playlist",
        playlist.channel ?? playlist.uploader ?? null,
        bestThumbnail(playlist),
        videos.length,
        now(),
        now()
      );

      db.prepare(`DELETE FROM transcript_segments WHERE video_id IN (SELECT id FROM videos WHERE playlist_id = ?)`).run(playlistId);
      db.prepare(`DELETE FROM videos WHERE playlist_id = ?`).run(playlistId);

      const insertVideo = db.prepare(
        `INSERT INTO videos
          (id, playlist_id, youtube_id, title, thumbnail_url, duration_seconds, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const video of videos) {
        insertVideo.run(
          video.id,
          video.playlistId,
          video.youtubeId,
          video.title,
          video.thumbnail,
          video.duration,
          video.position,
          now(),
          now()
        );
      }
    })();

    setJob(jobId, {
      progress: 20,
      message: `Imported metadata for ${videos.length} videos`,
      playlist_id: playlistId
    });

    const insertSegment = db.prepare(
      `INSERT OR REPLACE INTO transcript_segments
        (video_id, start_seconds, duration_seconds, text, position)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const [index, video] of videos.entries()) {
      setJob(jobId, {
        progress: 20 + Math.floor((index / Math.max(videos.length, 1)) * 75),
        message: `Fetching transcripts (${index + 1}/${videos.length})`
      });

      const segments = await fetchTranscript(video.youtubeId);
      db.transaction(() => {
        db.prepare(`DELETE FROM transcript_segments WHERE video_id = ?`).run(video.id);
        segments.forEach((segment, segmentIndex) => {
          insertSegment.run(
            video.id,
            segment.start,
            Math.max(0, segment.end - segment.start),
            segment.text,
            segmentIndex + 1
          );
        });
      })();
    }

    db.prepare(
      `UPDATE playlists
       SET import_status = 'ready', import_error = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now(), playlistId);

    setJob(jobId, { status: "complete", progress: 100, message: "Import complete", playlist_id: playlistId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    const current = getImportJob(jobId);

    if (current?.playlist_id) {
      db.prepare(
        `UPDATE playlists
         SET import_status = 'failed', import_error = ?, updated_at = ?
         WHERE id = ?`
      ).run(message, now(), current.playlist_id);
    }

    setJob(jobId, {
      status: "failed",
      progress: 100,
      message: "Import failed",
      error: message
    });
  }
}
