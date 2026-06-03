import fs from "node:fs";
import path from "node:path";

function resolvePath(value: string) {
  return path.isAbsolute(value)
    ? value
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), value);
}

export const dataDir = resolvePath(process.env.CURATUBE_DATA_DIR ?? "data");
export const configDir = resolvePath(process.env.CURATUBE_CONFIG_DIR ?? path.join(dataDir, "config"));
export const mediaDir = resolvePath(process.env.CURATUBE_MEDIA_DIR ?? path.join(dataDir, "media"));

export const dbPath =
  process.env.CURATUBE_DB_PATH === ":memory:"
    ? ":memory:"
    : resolvePath(process.env.CURATUBE_DB_PATH ?? path.join(dataDir, "curatube.sqlite"));

export function ensureRuntimeDirectories() {
  if (process.env.DEMO_MODE_ENABLED === "true") return;

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
}
