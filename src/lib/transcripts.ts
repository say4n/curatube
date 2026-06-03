import fs from "node:fs/promises";
import path from "node:path";

type ParsedSegment = {
  start: number;
  end: number;
  text: string;
};

const timingLine =
  /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/;

function timeToSeconds(value: string) {
  const [hours = "0", minutes = "0", seconds = "0"] = value.split(":");
  return (
    Number.parseInt(hours, 10) * 3600 +
    Number.parseInt(minutes, 10) * 60 +
    Number.parseFloat(seconds)
  );
}

function cleanCueText(lines: string[]) {
  return lines
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVtt(input: string) {
  const blocks = input
    .replace(/\r/g, "")
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: ParsedSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => timingLine.test(line));
    if (timingIndex === -1) continue;

    const match = lines[timingIndex].match(timingLine);
    if (!match) continue;

    const text = cleanCueText(lines.slice(timingIndex + 1));
    if (!text) continue;

    segments.push({
      start: timeToSeconds(match[1]),
      end: timeToSeconds(match[2]),
      text
    });
  }

  return segments.filter((segment, index, all) => {
    const previous = all[index - 1];
    return !previous || previous.start !== segment.start || previous.text !== segment.text;
  });
}

export async function readBestVttFile(directory: string) {
  const files = await fs.readdir(directory);
  const vttFiles = files.filter((file) => path.extname(file).toLowerCase() === ".vtt");
  if (vttFiles.length === 0) return [];

  const parsedFiles = await Promise.all(
    vttFiles.map(async (file) => {
      const content = await fs.readFile(path.join(directory, file), "utf8");
      return parseVtt(content);
    })
  );

  return parsedFiles.sort((a, b) => b.length - a.length)[0] ?? [];
}
