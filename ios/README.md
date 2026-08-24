# Curatube (iOS)

Native iOS companion for the Curatube self-hosted learning app. The server does
all the heavyweight work (import, transcripts, YouTube downloads via yt-dlp,
media preparation); this app is a thin client that:

- browses playlists and videos (new JSON endpoints: `GET /api/playlists`,
  `GET /api/playlists/:id/videos`),
- signs in through the server's web SSO (Authelia) and reuses the session cookie,
- streams prepared videos from `/api/videos/:id/media`,
- downloads videos to the device for **offline playback** (stored in
  Application Support, driven by the server's byte-range support).

## Layout

- `ios/Curatube/` — SwiftUI sources, one view file per screen.
- `ios/Curatube.xcodeproj/` — hand-maintained Xcode 16+ *synchronized folder*
  project (no XcodeGen/Tuist needed; add `.swift` files and they're picked up).

## Build & run

Requires Xcode 16+ (tested with Xcode 27 / iOS 26 simulators). Command line:

```sh
xcrun simctl boot "iPhone 17 Pro"
xcodebuild -project ios/Curatube.xcodeproj \
           -scheme Curatube \
           -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
           -derivedDataPath ios/build \
           build
# install + launch:
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/Curatube.app
xcrun simctl launch booted dev.say4n.Curatube
```

Or open `ios/Curatube.xcodeproj` in Xcode and run from there. The scheme
disables code signing for the simulator SDK only (set your own team + bundle id
to run on a device).

## Notes

- There is no default server; set yours in the **Server** tab (persisted in
  `UserDefaults`). For a self-hosted Authelia-protected instance the app
  presents an in-app login and copies the session cookie into URLSession's
  shared cookie storage. Local self-hosted instances (plain HTTP on a LAN)
  work too.
- Offline videos live in `Application Support/OfflineVideos` and are tracked by
  an `index.json`; deleting an entry removes the file. `URLSessionDownloadTask`
  reports progress via the server's `Accept-Ranges: bytes` support.
- Playback prefers the offline file when present; otherwise it streams the
  server-prepared WebM/MP4 through AVPlayer. A video must first be downloaded on
  the *server* ("Prepare on server") before it can stream or be pulled to the
  device.