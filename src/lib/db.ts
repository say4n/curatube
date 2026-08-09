import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { dataDir, dbPath, ensureRuntimeDirectories } from "./paths";
ensureRuntimeDirectories();

const globalForDb = globalThis as unknown as {
  curatubeDb?: Database.Database;
};

export const db =
  globalForDb.curatubeDb ??
  (process.env.DEMO_MODE_ENABLED === "true"
    ? ({
        prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
        exec: () => {},
        pragma: () => {},
        transaction: (fn: any) => fn
      } as unknown as Database.Database)
    : new Database(dbPath, {
        fileMustExist: false
      }));

if (process.env.NODE_ENV !== "production") {
  globalForDb.curatubeDb = db;
}

if (process.env.DEMO_MODE_ENABLED !== "true") {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  const transcriptFtsSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transcript_fts'`).get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (transcriptFtsSql?.includes("content='transcript_segments'")) {
    db.exec(`
      DROP TRIGGER IF EXISTS transcript_fts_ai;
      DROP TRIGGER IF EXISTS transcript_fts_ad;
      DROP TRIGGER IF EXISTS transcript_fts_au;
      DROP TABLE IF EXISTS transcript_fts;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      channel TEXT,
      thumbnail_url TEXT,
      video_count INTEGER NOT NULL DEFAULT 0,
      import_status TEXT NOT NULL DEFAULT 'ready',
      import_error TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      youtube_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      duration_seconds INTEGER,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(playlist_id, youtube_id)
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      start_seconds REAL NOT NULL,
      duration_seconds REAL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      UNIQUE(video_id, position)
    );

    CREATE TABLE IF NOT EXISTS notes (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_downloads (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'missing',
      file_path TEXT,
      file_size_bytes INTEGER,
      mime_type TEXT,
      progress_percent REAL,
      downloaded_bytes INTEGER,
      total_bytes INTEGER,
      speed_bytes_per_second REAL,
      eta_seconds INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_progress (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      position_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_preferences (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      prefer_local_playback INTEGER NOT NULL DEFAULT 0,
      youtube_embed_blocked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_updated_at
      ON playlists(updated_at);
    CREATE INDEX IF NOT EXISTS idx_videos_playlist_position
      ON videos(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status_created
      ON import_jobs(status, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts4(
      video_id,
      text
    );

    CREATE TRIGGER IF NOT EXISTS transcript_fts_ai AFTER INSERT ON transcript_segments BEGIN
      INSERT INTO transcript_fts(rowid, video_id, text) VALUES (new.id, new.video_id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS transcript_fts_ad AFTER DELETE ON transcript_segments BEGIN
      DELETE FROM transcript_fts WHERE rowid = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS transcript_fts_au AFTER UPDATE ON transcript_segments BEGIN
      DELETE FROM transcript_fts WHERE rowid = old.id;
      INSERT INTO transcript_fts(rowid, video_id, text) VALUES (new.id, new.video_id, new.text);
    END;
  `);

  const playlistColumns = db.prepare(`PRAGMA table_info(playlists)`).all() as Array<{
    name: string;
  }>;
  if (!playlistColumns.some((column) => column.name === "archived_at")) {
    db.exec(`ALTER TABLE playlists ADD COLUMN archived_at TEXT`);
  }
  if (!playlistColumns.some((column) => column.name === "deleted_at")) {
    db.exec(`ALTER TABLE playlists ADD COLUMN deleted_at TEXT`);
  }

  const videoDownloadColumns = db.prepare(`PRAGMA table_info(video_downloads)`).all() as Array<{
    name: string;
  }>;
  const videoDownloadMigrations = [
    ["progress_percent", "REAL"],
    ["downloaded_bytes", "INTEGER"],
    ["total_bytes", "INTEGER"],
    ["speed_bytes_per_second", "REAL"],
    ["eta_seconds", "INTEGER"]
  ];
  for (const [name, type] of videoDownloadMigrations) {
    if (!videoDownloadColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE video_downloads ADD COLUMN ${name} ${type}`);
    }
  }

  const videoPreferenceColumns = db.prepare(`PRAGMA table_info(video_preferences)`).all() as Array<{
    name: string;
  }>;
  if (!videoPreferenceColumns.some((column) => column.name === "youtube_embed_blocked_at")) {
    db.exec(`ALTER TABLE video_preferences ADD COLUMN youtube_embed_blocked_at TEXT`);
  }

  const videoProgressColumns = db.prepare(`PRAGMA table_info(video_progress)`).all() as Array<{
    name: string;
  }>;
  if (videoProgressColumns.some((column) => column.name === "prefer_local_playback")) {
    db.exec(`
      INSERT OR IGNORE INTO video_preferences
        (video_id, prefer_local_playback, created_at, updated_at)
      SELECT video_id, prefer_local_playback, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM video_progress
      WHERE prefer_local_playback = 1
    `);
  }

  const ftsSegmentCount = (
    db.prepare(`SELECT count(*) AS c FROM transcript_segments`).get() as { c: number }
  ).c;
  const ftsIndexedCount = (
    db.prepare(`SELECT count(*) AS c FROM transcript_fts`).get() as { c: number }
  ).c;
  if (ftsIndexedCount !== ftsSegmentCount) {
    db.exec(`
      DELETE FROM transcript_fts;
      INSERT INTO transcript_fts(rowid, video_id, text)
        SELECT id, video_id, text FROM transcript_segments;
    `);
  }
}

export type Playlist = {
  id: string;
  source_url: string;
  title: string;
  channel: string | null;
  thumbnail_url: string | null;
  video_count: number;
  completed_video_count: number;
  import_status: string;
  import_error: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  last_watched_at: string | null;
};

export type Video = {
  id: string;
  playlist_id: string;
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  position: number;
};

export type TranscriptSegment = {
  id: number;
  video_id: string;
  start_seconds: number;
  duration_seconds: number | null;
  text: string;
  position: number;
};

export type ImportJob = {
  id: string;
  source_url: string;
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  message: string | null;
  playlist_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoDownload = {
  video_id: string;
  status: "missing" | "queued" | "running" | "ready" | "failed";
  file_path: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  progress_percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed_bytes_per_second: number | null;
  eta_seconds: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoProgress = {
  video_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  completed: number;
  updated_at: string;
};

export type VideoPreference = {
  video_id: string;
  prefer_local_playback: boolean;
  youtube_embed_blocked_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeVideoPreference(
  preference:
    | (Omit<VideoPreference, "prefer_local_playback" | "youtube_embed_blocked_at"> & {
        prefer_local_playback?: number | boolean | null;
        youtube_embed_blocked_at?: string | null;
      })
    | undefined
) {
  if (!preference) return undefined;
  return {
    ...preference,
    prefer_local_playback:
      preference.prefer_local_playback === true || preference.prefer_local_playback === 1,
    youtube_embed_blocked_at: preference.youtube_embed_blocked_at ?? null
  } as VideoPreference;
}

let demoDataCache: any = null;
function getDemoData() {
  if (demoDataCache) return demoDataCache;
  try {
    const demoPath = process.env.VERCEL
      ? path.join(process.cwd(), "data", "demo.json.gz")
      : path.join(dataDir, "demo.json.gz");
    const compressed = fs.readFileSync(demoPath);
    const jsonString = require("zlib").gunzipSync(compressed).toString("utf-8");
    demoDataCache = JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to load demo.json.gz", e);
    demoDataCache = {
      playlists: [],
      videos: [],
      transcript_segments: [],
      notes: [],
      video_downloads: [],
      video_progress: [],
      video_preferences: [],
    };
  }
  return demoDataCache;
}

export function getPlaylists() {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().playlists || []).map((playlist: any) => ({
      completed_video_count: 0,
      archived_at: null,
      deleted_at: null,
      ...playlist
    })).filter((playlist: Playlist) => !playlist.deleted_at) as Playlist[];
  }
  return db
    .prepare(
      `SELECT
         p.*,
         (
           SELECT COUNT(*)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
             AND vp.completed = 1
         ) AS completed_video_count,
         (
           SELECT MAX(vp.updated_at)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
         ) AS last_watched_at
       FROM playlists p
       WHERE p.deleted_at IS NULL
       ORDER BY datetime(p.updated_at) DESC, p.title ASC`
    )
    .all() as Playlist[];
}

export function getRecentJobs() {
  if (process.env.DEMO_MODE_ENABLED === "true") return [] as ImportJob[];
  return db
    .prepare(
      `SELECT * FROM import_jobs
       WHERE status IN ('queued', 'running', 'failed')
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    )
    .all() as ImportJob[];
}

export function getImportJob(id: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") return undefined;
  return db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(id) as
    | ImportJob
    | undefined;
}

export function getPlaylist(id: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    const playlist = (getDemoData().playlists || []).find((p: any) => p.id === id);
    return playlist
      ? ({
          completed_video_count: 0,
          archived_at: null,
          deleted_at: null,
          ...playlist
        } as Playlist)
      : undefined;
  }
  return db
    .prepare(
      `SELECT
         p.*,
         (
           SELECT COUNT(*)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
             AND vp.completed = 1
         ) AS completed_video_count,
         (
           SELECT MAX(vp.updated_at)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
         ) AS last_watched_at
       FROM playlists p
       WHERE p.id = ?
         AND p.deleted_at IS NULL`
    )
    .get(id) as Playlist | undefined;
}

export function setPlaylistArchived(playlistId: string, archived: boolean) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    const playlist = (getDemoData().playlists || []).find((p: any) => p.id === playlistId);
    if (!playlist) return undefined;

    return {
      ...playlist,
      archived_at: archived ? new Date().toISOString() : null
    } as Playlist;
  }

  db.prepare(
    `UPDATE playlists
     SET archived_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(archived ? 1 : 0, playlistId);

  return getPlaylist(playlistId);
}

export function setPlaylistDeleted(playlistId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    const playlist = (getDemoData().playlists || []).find((p: any) => p.id === playlistId);
    if (!playlist) return undefined;

    return {
      ...playlist,
      deleted_at: new Date().toISOString()
    } as Playlist;
  }

  db.prepare(
    `UPDATE playlists
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(playlistId);

  return db.prepare(`SELECT * FROM playlists WHERE id = ?`).get(playlistId) as Playlist | undefined;
}

export function getPlaylistVideos(playlistId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().videos || []).filter((v: any) => v.playlist_id === playlistId) as Video[];
  }
  return db
    .prepare(
      `SELECT * FROM videos WHERE playlist_id = ? ORDER BY position ASC`
    )
    .all(playlistId) as Video[];
}

export function getVideo(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().videos || []).find((v: any) => v.id === videoId) as Video | undefined;
  }
  return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(videoId) as
    | Video
    | undefined;
}

export function getTranscript(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().transcript_segments || []).filter((ts: any) => ts.video_id === videoId) as TranscriptSegment[];
  }
  return db
    .prepare(
      `SELECT * FROM transcript_segments
       WHERE video_id = ?
       ORDER BY position ASC`
    )
    .all(videoId) as TranscriptSegment[];
}

function buildFtsMatch(query: string) {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9_\u00C0-\uFFFF]/g, ""))
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(" ");
}

export function searchTranscript(videoId: string, query: string) {
  if (!query.trim()) return [] as TranscriptSegment[];

  if (process.env.DEMO_MODE_ENABLED === "true") {
    const needle = query.toLowerCase();
    return getTranscript(videoId).filter((segment) =>
      segment.text.toLowerCase().includes(needle)
    );
  }

  const match = buildFtsMatch(query);
  if (!match) return [] as TranscriptSegment[];

  return db
    .prepare(
      `SELECT ts.id, ts.video_id, ts.start_seconds, ts.duration_seconds, ts.text, ts.position
       FROM transcript_fts
       JOIN transcript_segments ts ON ts.rowid = transcript_fts.rowid
       WHERE transcript_fts.video_id = ?
         AND transcript_fts MATCH ?
       ORDER BY ts.position ASC
       LIMIT 100`
    )
    .all(videoId, match) as TranscriptSegment[];
}

export function getNote(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    const note = (getDemoData().notes || []).find((n: any) => n.video_id === videoId);
    return note?.body ?? "";
  }
  const row = db
    .prepare(`SELECT body FROM notes WHERE video_id = ?`)
    .get(videoId) as { body: string } | undefined;

  return row?.body ?? "";
}

export function getVideoDownload(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().video_downloads || []).find((d: any) => d.video_id === videoId) as VideoDownload | undefined;
  }
  return db
    .prepare(`SELECT * FROM video_downloads WHERE video_id = ?`)
    .get(videoId) as VideoDownload | undefined;
}

export function getVideoProgress(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return (getDemoData().video_progress || []).find((p: any) => p.video_id === videoId) as
      | VideoProgress
      | undefined;
  }
  return db
    .prepare(`SELECT * FROM video_progress WHERE video_id = ?`)
    .get(videoId) as VideoProgress | undefined;
}

export function getPlaylistVideoProgress(playlistId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    const videoIds = new Set(
      (getDemoData().videos || [])
        .filter((video: any) => video.playlist_id === playlistId)
        .map((video: any) => video.id)
    );

    return (getDemoData().video_progress || [])
      .filter((progress: any) => videoIds.has(progress.video_id)) as VideoProgress[];
  }

  return db
    .prepare(
      `SELECT vp.*
       FROM video_progress vp
       JOIN videos v ON v.id = vp.video_id
       WHERE v.playlist_id = ?`
    )
    .all(playlistId) as VideoProgress[];
}

export function getVideoPreference(videoId: string) {
  if (process.env.DEMO_MODE_ENABLED === "true") {
    return normalizeVideoPreference(
      (getDemoData().video_preferences || []).find((p: any) => p.video_id === videoId)
    );
  }
  return normalizeVideoPreference(
    db.prepare(`SELECT * FROM video_preferences WHERE video_id = ?`).get(videoId) as
      | (Omit<VideoPreference, "prefer_local_playback" | "youtube_embed_blocked_at"> & {
          prefer_local_playback?: number | boolean | null;
          youtube_embed_blocked_at?: string | null;
        })
      | undefined
  );
}

export function setVideoPreference(
  videoId: string,
  values: {
    prefer_local_playback?: boolean;
    youtube_embed_blocked_at?: string | null;
  }
) {
  const current = getVideoPreference(videoId);
  const preferLocalPlayback =
    values.prefer_local_playback ?? current?.prefer_local_playback ?? false;
  const youtubeEmbedBlockedAt =
    values.youtube_embed_blocked_at === undefined
      ? current?.youtube_embed_blocked_at ?? null
      : values.youtube_embed_blocked_at;

  if (process.env.DEMO_MODE_ENABLED === "true") {
    return {
      video_id: videoId,
      prefer_local_playback: preferLocalPlayback,
      youtube_embed_blocked_at: youtubeEmbedBlockedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as VideoPreference;
  }

  db.prepare(
    `INSERT INTO video_preferences
      (video_id, prefer_local_playback, youtube_embed_blocked_at, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(video_id) DO UPDATE SET
      prefer_local_playback = excluded.prefer_local_playback,
      youtube_embed_blocked_at = excluded.youtube_embed_blocked_at,
      updated_at = excluded.updated_at`
  ).run(videoId, preferLocalPlayback ? 1 : 0, youtubeEmbedBlockedAt);

  return getVideoPreference(videoId);
}
