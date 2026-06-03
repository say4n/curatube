import fs from "fs";
import path from "path";

const buildCommitFile = path.join(process.cwd(), ".curatube-build-commit");

export function getBuildCommit() {
  const fromEnv = process.env.CURATUBE_BUILD_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);

  if (fs.existsSync(buildCommitFile)) {
    const fromFile = fs.readFileSync(buildCommitFile, "utf8").trim();
    if (fromFile) return fromFile.slice(0, 7);
  }

  return null;
}
