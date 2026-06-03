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
- Local video playback must stay Safari-compatible: keep one prepared MP4 per video
  using H.264/AAC when possible, serve it through the media API with byte-range
  support, and avoid adding parallel browser-specific copies unless there is a
  verified need.
- The YouTube iframe API mutates its host DOM. Keep React ownership separated
  from the API-owned player node when switching between embedded and local
  playback.
