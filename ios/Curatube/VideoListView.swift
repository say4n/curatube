import SwiftUI

struct VideoListView: View {
    let playlist: Playlist

    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    @State private var videos: [Video] = []
    @State private var watchedIDs: Set<String> = []
    @State private var loadError: String?

    var body: some View {
        Group {
            if let loadError {
                ContentUnavailableView {
                    Label("Can't reach server", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await reload() } }
                }
            } else if videos.isEmpty {
                ContentUnavailableView(
                    "No videos",
                    systemImage: "video.slash",
                    description: Text("This playlist has no videos.")
                )
            } else {
                List(videos) { video in
                    NavigationLink(value: video) {
                        VideoRow(video: video, isWatched: watchedIDs.contains(video.id))
                    }
                }
                .refreshable { await reload() }
            }
        }
        .navigationTitle(playlist.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .navigationDestination(for: Video.self) { video in
            PlayerScreen(video: video)
        }
    }

    private func reload() async {
        loadError = nil
        do {
            let response = try await client.fetchVideos(playlistID: playlist.id)
            videos = response.videos
            watchedIDs = Set(response.progress.filter { $0.completed }.map(\.videoID))
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case APIError.authRequired = error {
                client.needsAuth = true
            }
        }
    }
}

struct VideoRow: View {
    let video: Video
    var isWatched = false

    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    var body: some View {
        HStack(spacing: 12) {
            RemoteThumb(video.thumbnailURL, width: 64, height: 40)
                .overlay(alignment: .bottomTrailing) {
                    if let duration = Formatters.duration(video.durationSeconds) {
                        Text(duration)
                            .font(.caption2.monospacedDigit())
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 4))
                            .foregroundStyle(.white)
                            .padding(2)
                    }
                }
                .overlay(alignment: .topLeading) {
                    badge
                        .padding(2)
                }
            Text(video.title)
                .font(.subheadline)
                .lineLimit(2)
            Spacer()
        }
        .opacity(isWatched ? 0.4 : 1)
        .saturation(isWatched ? 0 : 1)
    }

    @ViewBuilder
    private var badge: some View {
        if offlineLibrary.isOffline(video.id) {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else if let task = offlineLibrary.task(for: video.id) {
            if task.progress < 1 {
                ProgressView(value: task.progress)
                    .progressViewStyle(.circular)
                    .tint(.accentColor)
            }
        }
    }
}