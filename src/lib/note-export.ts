import type { Playlist, Video } from "./db";

type VideoNote = {
  video: Video;
  note: string;
};

function videoUrl(video: Video) {
  return `https://www.youtube.com/watch?v=${video.youtube_id}&list=${video.playlist_id}`;
}

function markdownLinkText(text: string) {
  return text.replace(/([\\\[\]])/g, "\\$1");
}

function demoteMarkdownHeadings(markdown: string) {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    const fenceMatch = current.match(/^( {0,3})(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (fenceMarker === marker) {
        fenceMarker = null;
      } else if (!fenceMarker) {
        fenceMarker = marker;
      }
      output.push(current);
      continue;
    }

    if (fenceMarker) {
      output.push(current);
      continue;
    }

    if (next && /^[ \t]*(=+|-+)[ \t]*$/.test(next) && current.trim().length > 0) {
      output.push(`### ${current.trim()}`);
      index += 1;
      continue;
    }

    output.push(
      current.replace(/^( {0,3})(#{1,6})([ \t]+.+)$/, (_match, indent, hashes, rest) => {
        const demotedLevel = Math.min(6, hashes.length + 2);
        return `${indent}${"#".repeat(demotedLevel)}${rest}`;
      })
    );
  }

  return output.join("\n").trim();
}

export function playlistNotesMarkdown(playlist: Playlist, videoNotes: VideoNote[]) {
  const index = videoNotes.map(({ video }) => {
    const position = String(video.position).padStart(2, "0");
    return `- ${position} - ${markdownLinkText(video.title)}`;
  }).join("\n");

  const sections = videoNotes.map(({ video, note }) => {
    const position = String(video.position).padStart(2, "0");
    const body = demoteMarkdownHeadings(note);

    return [`## ${position} - [${markdownLinkText(video.title)}](${videoUrl(video)})`, body]
      .filter(Boolean)
      .join("\n\n");
  });

  const parts = [`# ${playlist.title}`, playlist.source_url];
  if (index) {
    parts.push(`## Index\n\n${index}`);
  }
  parts.push(...sections);

  return parts.join("\n\n").concat("\n");
}

export function markdownFilename(title: string) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "playlist"}-notes.md`;
}
