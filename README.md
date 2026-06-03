# curatube

A distraction-free learning environment for YouTube playlists.

## Development

Curatube is developed inside Docker so local Node, pnpm, yt-dlp, and native SQLite
dependencies do not need to be installed on the host.

```sh
docker compose -f containers/docker-compose.yml up --build
```

Open `http://localhost:3000`.

Run checks inside the same environment:

```sh
docker compose -f containers/docker-compose.yml exec curatube pnpm typecheck
```

## Self-hosting

Use the published GHCR image with the example compose file:

```sh
docker compose -f containers/docker-compose.example.yml pull
docker compose -f containers/docker-compose.example.yml up -d
```

## Storage configuration

Curatube defaults to local `./data` storage, but all runtime paths can be set with environment variables:

- `CURATUBE_DATA_DIR`: base app data directory.
- `CURATUBE_CONFIG_DIR`: config directory, defaults to `$CURATUBE_DATA_DIR/config`.
- `CURATUBE_MEDIA_DIR`: downloaded video directory, defaults to `$CURATUBE_DATA_DIR/media`.
- `CURATUBE_DB_PATH`: SQLite path, defaults to `$CURATUBE_DATA_DIR/curatube.sqlite`.

Docker defaults to `/data`, `/data/config`, `/data/media`, and `/data/curatube.sqlite`.
