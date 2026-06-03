import fs from 'fs';
import path from 'path';
import { db } from '../lib/db';
import { dataDir } from '../lib/paths';

const PLAYLIST_IDS_TO_DUMP = [
  'PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi',
  'PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ'
];

function dumpData() {
  console.log('Dumping data for playlists:', PLAYLIST_IDS_TO_DUMP);

  const dump = {
    playlists: [] as any[],
    videos: [] as any[],
    transcript_segments: [] as any[],
    notes: [] as any[],
    video_downloads: [] as any[],
    video_progress: [] as any[],
  };

  for (const pid of PLAYLIST_IDS_TO_DUMP) {
    const playlistInfo = db.prepare(`SELECT * FROM playlists WHERE source_url LIKE ?`).get(`%${pid}%`) as any;
    if (!playlistInfo) {
      console.warn(`Playlist ${pid} not found in DB. Skipping.`);
      continue;
    }
    
    // Add extra computed fields that the getter normally provides
    const lastWatched = db.prepare(`
        SELECT MAX(vp.updated_at) as last_watched_at
        FROM videos v
        JOIN video_progress vp ON vp.video_id = v.id
        WHERE v.playlist_id = ?
    `).get(playlistInfo.id) as any;
    playlistInfo.last_watched_at = lastWatched?.last_watched_at || null;

    dump.playlists.push(playlistInfo);

    const videos = db.prepare(`SELECT * FROM videos WHERE playlist_id = ? ORDER BY position ASC`).all(playlistInfo.id) as any[];
    dump.videos.push(...videos);

    for (const v of videos) {
      const segments = db.prepare(`SELECT * FROM transcript_segments WHERE video_id = ? ORDER BY position ASC`).all(v.id) as any[];
      dump.transcript_segments.push(...segments);

      const note = db.prepare(`SELECT body FROM notes WHERE video_id = ?`).get(v.id) as any;
      if (note) {
        dump.notes.push({ video_id: v.id, body: note.body });
      }

      const download = db.prepare(`SELECT * FROM video_downloads WHERE video_id = ?`).get(v.id) as any;
      if (download) {
        dump.video_downloads.push(download);
      }

      const progress = db.prepare(`SELECT * FROM video_progress WHERE video_id = ?`).get(v.id) as any;
      if (progress) {
        dump.video_progress.push(progress);
      }
    }
  }

  const outPath = path.join(dataDir, 'demo.json.gz');
  const jsonString = JSON.stringify(dump);
  const compressed = require('zlib').gzipSync(jsonString);
  fs.writeFileSync(outPath, compressed);
  console.log(`Demo data dumped to ${outPath} (${compressed.length} bytes compressed)`);
  console.log(`Exported ${dump.playlists.length} playlists, ${dump.videos.length} videos.`);
}

dumpData();
