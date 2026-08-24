import SwiftUI
import AVKit
import AVFoundation

struct PlayerScreen: View {
    let video: Video

    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    @State private var status: DownloadStatus?
    @State private var statusError: String?
    @State private var preparing = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        Group {
            if let localURL = offlineLibrary.localURL(for: video.id) {
                playback { LocalPlaybackView(url: localURL) }
            } else if let status, status.isReady, let mediaURL = try? client.mediaURL(videoID: video.id) {
                playback { LocalPlaybackView(url: mediaURL) }
            } else {
                stateView.frame(maxHeight: .infinity)
            }
        }
        .navigationTitle(video.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                toolbarContent
            }
        }
        .task { startPolling() }
        .onDisappear {
            pollTask?.cancel()
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private func playback<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }

    @ViewBuilder
    private var stateView: some View {
        VStack(spacing: 18) {
            if let message = statusError {
                ContentUnavailableView {
                    Label("Playback unavailable", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    if client.needsAuth {
                        Button("Sign in") { client.needsAuth = true }
                    }
                    Button("Retry") {
                        statusError = nil
                        startPolling()
                    }
                }
            } else if let status {
                if status.isActive {
                    VStack(spacing: 12) {
                        if let percent = status.progressPercent, percent > 0 {
                            ProgressView(value: percent / 100)
                                .progressViewStyle(.linear)
                            Text("Server is downloading… \(Int(percent))%")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        } else {
                            ProgressView("Server is downloading…")
                        }
                    }
                } else {
                    VStack(spacing: 14) {
                        RemoteThumb(video.thumbnailURL, width: 160, height: 90)
                        Text("This video isn't downloaded on the server yet.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await prepareOnServer() }
                        } label: {
                            if preparing {
                                ProgressView().tint(.white)
                            } else {
                                Label("Prepare on server", systemImage: "arrow.down.to.line")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(preparing)
                        if let error = status.error {
                            Text(error).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView("Contacting server…")
            }
        }
        .padding()
    }

    @ViewBuilder
    private var toolbarContent: some View {
        if offlineLibrary.isOffline(video.id) {
            Menu {
                Button(role: .destructive) {
                    offlineLibrary.remove(videoID: video.id)
                } label: {
                    Label("Remove download", systemImage: "trash")
                }
            } label: {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(.green)
            }
        } else if let task = offlineLibrary.task(for: video.id) {
            if task.progress < 1 {
                ProgressView(value: task.progress)
                    .progressViewStyle(.circular)
            }
        } else if status?.isReady == true {
            Button {
                startDeviceDownload()
            } label: {
                Image(systemName: "arrow.down.circle")
            }
            .help("Download for offline playback")
        } else {
            Image(systemName: "arrow.down.circle.dotted")
                .foregroundStyle(.tertiary)
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { await pollStatus() }
    }

    private func pollStatus() async {
        while !Task.isCancelled {
            do {
                let current = try await client.fetchDownloadStatus(videoID: video.id)
                status = current
                statusError = nil
                if current.isReady || current.status == "missing" || current.status == "failed" {
                    return
                }
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                statusError = message
                if case APIError.authRequired = error {
                    client.needsAuth = true
                }
                return
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    private func prepareOnServer() async {
        preparing = true
        defer { preparing = false }
        do {
            status = try await client.startServerDownload(videoID: video.id)
            statusError = nil
            startPolling()
        } catch {
            statusError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case APIError.authRequired = error {
                client.needsAuth = true
            }
        }
    }

    private func startDeviceDownload() {
        guard let mediaURL = try? client.mediaURL(videoID: video.id) else { return }
        offlineLibrary.startDownload(videoID: video.id, title: video.title, remoteURL: mediaURL)
    }
}

/// AVKit player. Attaches the server session cookies for streaming behind SSO.
struct LocalPlaybackView: View {
    let url: URL

    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView()
                    .tint(.white)
            }
        }
        .onAppear {
            guard player == nil else {
                player?.play()
                return
            }
            let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
            if cookies.isEmpty {
                player = AVPlayer(url: url)
            } else {
                let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            }
            player?.automaticallyWaitsToMinimizeStalling = true
            player?.play()
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}