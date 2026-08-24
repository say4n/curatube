# Repository Guidelines

## Development Environment

- Use Docker for development and verification. Do not install Node, pnpm, yt-dlp, or native dependencies on the host.
- Start the app with `docker compose -f containers/docker-compose.yml up --build`.
- Run project commands inside the `curatube` service, for example:

```sh
docker compose -f containers/docker-compose.yml exec curatube pnpm typecheck
```

## Package Manager

- Use `pnpm` for all Node package operations.
- Keep `pnpm-lock.yaml` committed when dependencies change.

## Runtime Storage

The app stores SQLite data, config, and downloaded videos in configurable runtime paths:

- `CURATUBE_DATA_DIR`
- `CURATUBE_CONFIG_DIR`
- `CURATUBE_MEDIA_DIR`
- `CURATUBE_DB_PATH`

Docker Compose maps these to `/data`, `/data/config`, `/data/media`, and
`/data/curatube.sqlite` by default.

## Verification

Before committing substantial changes, run:

```sh
docker compose -f containers/docker-compose.yml exec curatube pnpm typecheck
docker build -f containers/Dockerfile -t curatube:latest .
```

## Notes

- Downloaded videos and local SQLite data are runtime artifacts and should not be committed.
- Keep UI changes focused on the distraction-free learning workflow.
- Local video playback prefers one prepared WebM per video (VP9 + Opus) with
  byte-range support via the media API. Old Safari is not a target, so there is
  no H.264/AAC re-encode step; fall back to other containers/codecs only when
  VP9 + Opus is unavailable. Avoid adding parallel browser-specific copies
  unless there is a verified need.
- The YouTube iframe API mutates its host DOM. Keep React ownership separated
  from the API-owned player node when switching between embedded and local
  playback.
- **Do NOT create a top-level `app/` directory.** A root `app/` folder breaks
  Next.js App Router detection (every route, including `/`, 404s) even though
  app routes live under `src/app`. The native iOS app lives in `ios/` instead.

## iOS App (`ios/`)

- Native SwiftUI companion (browse, SSO login, streaming, offline playback);
  the server remains the download engine. View files in `ios/Curatube/`, a
  hand-maintained Xcode 16+ synchronized-folder project (no XcodeGen/Tuist; new
  `.swift` files are picked up automatically).
- JSON endpoints added for the app: `GET /api/playlists` and
  `GET /api/playlists/:id/videos` (web UI still uses RSC pages).
- Build (host, macOS only — Docker can't build iOS):

```sh
xcodebuild -project ios/Curatube.xcodeproj \
  -scheme Curatube \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath ios/build build
```
