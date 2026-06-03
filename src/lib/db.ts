import Database from "better-sqlite3";
import { dbPath, ensureRuntimeDirectories } from "./paths";

ensureRuntimeDirectories();

const globalForDb = globalThis as unknown as {
  curatubeDb?: Database.Database;
};

export const db =
  globalForDb.curatubeDb ??
  new Database(dbPath, {
    fileMustExist: false
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.curatubeDb = db;
}

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

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
`);

export type Playlist = {
  id: string;
  source_url: string;
  title: string;
  channel: string | null;
  thumbnail_url: string | null;
  video_count: number;
  import_status: string;
  import_error: string | null;
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

export function getPlaylists() {
  return db
    .prepare(
      `SELECT
         p.*,
         (
           SELECT MAX(vp.updated_at)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
         ) AS last_watched_at
       FROM playlists p
       ORDER BY datetime(p.updated_at) DESC, p.title ASC`
    )
    .all() as Playlist[];
}

export function getRecentJobs() {
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
  return db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(id) as
    | ImportJob
    | undefined;
}

export function getPlaylist(id: string) {
  return db
    .prepare(
      `SELECT
         p.*,
         (
           SELECT MAX(vp.updated_at)
           FROM videos v
           JOIN video_progress vp ON vp.video_id = v.id
           WHERE v.playlist_id = p.id
         ) AS last_watched_at
       FROM playlists p
       WHERE p.id = ?`
    )
    .get(id) as Playlist | undefined;
}

export function getPlaylistVideos(playlistId: string) {
  return db
    .prepare(
      `SELECT * FROM videos WHERE playlist_id = ? ORDER BY position ASC`
    )
    .all(playlistId) as Video[];
}

export function getVideo(videoId: string) {
  return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(videoId) as
    | Video
    | undefined;
}

export function getTranscript(videoId: string) {
  return db
    .prepare(
      `SELECT * FROM transcript_segments
       WHERE video_id = ?
       ORDER BY position ASC`
    )
    .all(videoId) as TranscriptSegment[];
}

export function getNote(videoId: string) {
  const row = db
    .prepare(`SELECT body FROM notes WHERE video_id = ?`)
    .get(videoId) as { body: string } | undefined;

  return row?.body ?? "";
}

export function getVideoDownload(videoId: string) {
  return db
    .prepare(`SELECT * FROM video_downloads WHERE video_id = ?`)
    .get(videoId) as VideoDownload | undefined;
}

export function getVideoProgress(videoId: string) {
  return db
    .prepare(`SELECT * FROM video_progress WHERE video_id = ?`)
    .get(videoId) as VideoProgress | undefined;
}
