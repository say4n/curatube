import SwiftUI
import AVKit
import AVFoundation

/// Owns the AVPlayer and syncs playback progress back to the server.
@MainActor
@Observable
final class PlaybackController {
    let client: APIClient
    let video: Video
    let url: URL

    var player: AVPlayer?
    var currentTime: Double = 0
    private(set) var duration: Double = 0

    private var timeObserver: Any?
    private var lastSentPosition: Double = 0

    init(client: APIClient, video: Video, url: URL) {
        self.client = client
        self.video = video
        self.url = url
    }

    func start() {
        if player != nil {
            player?.play()
            return
        }
        let newPlayer: AVPlayer
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        if cookies.isEmpty {
            newPlayer = AVPlayer(url: url)
        } else {
            let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
            newPlayer = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        }
        newPlayer.automaticallyWaitsToMinimizeStalling = true
        player = newPlayer
        observe(newPlayer)
        newPlayer.play()
    }

    func togglePlay() {
        if player?.rate == 0 {
            player?.play()
        } else {
            player?.pause()
        }
    }

    func pause() {
        player?.pause()
    }

    func seek(to seconds: Double) {
        guard let player else { return }
        let target = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        if player.timeControlStatus == .paused {
            player.play()
        }
    }

    func flushProgress() {
        syncPosition(currentTime: currentTime)
    }

    func tearDown() {
        if let token = timeObserver, let player {
            player.removeTimeObserver(token)
        }
        timeObserver = nil
        player?.pause()
        player = nil
    }

    private func observe(_ player: AVPlayer) {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        let token = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            guard let self, let player = self.player else { return }
            let time = player.currentTime().seconds
            self.currentTime = time
            if let d = player.currentItem?.duration.seconds, d.isFinite {
                self.duration = d
            }
            self.syncPosition(currentTime: time)
        }
        timeObserver = token
    }

    private func syncPosition(currentTime: Double) {
        guard currentTime.isFinite, currentTime >= 0 else { return }
        guard abs(currentTime - lastSentPosition) >= 3 || currentTime == 0 else { return }
        lastSentPosition = currentTime
        let completed = duration > 0 && currentTime / duration >= 0.95
        let videoID = video.id
        let duration = duration
        Task { @MainActor in
            try? await client.saveProgress(
                videoID: videoID,
                positionSeconds: currentTime,
                durationSeconds: duration > 0 ? duration : nil,
                completed: completed
            )
        }
    }
}

struct PlayerScreen: View {
    let video: Video

    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary
    @Environment(\.scenePhase) private var scenePhase

    @State private var status: DownloadStatus?
    @State private var statusError: String?
    @State private var preparing = false
    @State private var pollTask: Task<Void, Never>?
    @State private var playback: PlaybackController?

    var body: some View {
        Group {
            if let url = resolvedURL, let playback {
                playerUI(url: url, playback: playback)
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
        .task(id: resolvedURL) {
            guard let url = resolvedURL else { return }
            if playback?.url != url {
                playback?.tearDown()
                let controller = PlaybackController(client: client, video: video, url: url)
                playback = controller
                controller.start()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                playback?.flushProgress()
                playback?.pause()
            }
        }
        .onDisappear {
            pollTask?.cancel()
            playback?.tearDown()
            playback = nil
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private var resolvedURL: URL? {
        if let local = offlineLibrary.localURL(for: video.id) {
            return local
        }
        if let status, status.isReady, let media = try? client.mediaURL(videoID: video.id) {
            return media
        }
        return nil
    }

    private func playerUI(url: URL, playback: PlaybackController) -> some View {
        VStack(spacing: 0) {
            PlayerSurface(playback: playback)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(video.title)
                            .font(.headline)
                        if let duration = Formatters.duration(video.durationSeconds ?? Int(playback.duration)) {
                            Text(duration)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    TranscriptView(video: video, playback: playback)
                }
                .padding()
            }
        }
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

/// The 16:9 player surface. AVPlayerViewController's inline controls include
/// the fullscreen button, which presents AVKit's immersive player and manages
/// landscape rotation itself (not blocked by the device rotation lock).
struct PlayerSurface: View {
    let playback: PlaybackController

    var body: some View {
        ZStack {
            Color.black
            if let player = playback.player {
                InlinePlayerView(player: player)
            } else {
                ProgressView()
                    .tint(.white)
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
    }
}

struct InlinePlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.showsPlaybackControls = true
        controller.videoGravity = .resizeAspect
        return controller
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        if uiViewController.player !== player {
            uiViewController.player = player
        }
    }
}

/// Landscape, chromeless fullscreen via AVKit's native fullscreen presentation.
/// AVKit manages the rotation itself and, like YouTube, isn't blocked by the
/// device's rotation lock.
/// Clickable, timestamped transcript with the active segment highlighted.
struct TranscriptView: View {
    let video: Video
    let playback: PlaybackController

    @Environment(APIClient.self) private var client
    @State private var segments: [TranscriptSegment] = []
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Transcript")
                .font(.title3.bold())
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if segments.isEmpty {
                ProgressView("Loading transcript…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(segments) { segment in
                    Button {
                        playback.seek(to: segment.startSeconds)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Text(Formatters.duration(Int(segment.startSeconds)) ?? "0:00")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(isActive(segment) ? Color.accentColor : .secondary)
                                .frame(width: 44, alignment: .leading)
                            Text(segment.text)
                                .font(.footnote)
                                .foregroundStyle(isActive(segment) ? .primary : .secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .task { await load() }
    }

    private func isActive(_ segment: TranscriptSegment) -> Bool {
        let time = playback.currentTime
        if let duration = segment.durationSeconds, duration > 0 {
            return time >= segment.startSeconds && time < segment.startSeconds + duration
        }
        return time >= segment.startSeconds
    }

    private func load() async {
        error = nil
        do {
            segments = try await client.fetchTranscript(videoID: video.id)
        } catch let fetchError {
            let message = (fetchError as? LocalizedError)?.errorDescription ?? fetchError.localizedDescription
            error = message
        }
    }
}