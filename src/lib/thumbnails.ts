import fs from "fs/promises";
import path from "path";
import { mediaDir } from "@/lib/paths";
import { db } from "@/lib/db";

// Ensure the thumbnails directory exists
const thumbnailsDir = path.join(mediaDir, "thumbnails");
fs.mkdir(thumbnailsDir, { recursive: true }).catch(() => {});

export async function processThumbnail(
  id: string,
  type: "playlist" | "video",
  url: string | null
): Promise<string | null> {
  if (!url || !url.startsWith("http")) return url;

  try {
    const response = await fetch(url);
    if (!response.ok) return url;

    const buffer = await response.arrayBuffer();
    const filename = `${type}_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
    const filepath = path.join(thumbnailsDir, filename);

    await fs.writeFile(filepath, Buffer.from(buffer));

    const localUrl = `/api/thumbnails/${filename}`;

    if (type === "playlist") {
      db.prepare(`UPDATE playlists SET thumbnail_url = ? WHERE id = ?`).run(localUrl, id);
    } else {
      db.prepare(`UPDATE videos SET thumbnail_url = ? WHERE id = ?`).run(localUrl, id);
    }

    return localUrl;
  } catch (err) {
    console.error(`Failed to process thumbnail for ${type} ${id}:`, err);
    return url;
  }
}

export async function backfillPlaylists(playlists: any[]) {
  await Promise.all(
    playlists.map(async (p) => {
      if (p.thumbnail_url?.startsWith("http")) {
        p.thumbnail_url = await processThumbnail(p.id, "playlist", p.thumbnail_url);
      }
    })
  );
}

export async function backfillVideos(videos: any[]) {
  await Promise.all(
    videos.map(async (v) => {
      if (v.thumbnail_url?.startsWith("http")) {
        v.thumbnail_url = await processThumbnail(v.id, "video", v.thumbnail_url);
      }
    })
  );
}
