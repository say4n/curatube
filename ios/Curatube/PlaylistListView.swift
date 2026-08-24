import SwiftUI

struct PlaylistListView: View {
    @Environment(APIClient.self) private var client

    @State private var playlists: [Playlist] = []
    @State private var loadError: String?

    private var authRequired: Binding<Bool> {
        Binding(
            get: { client.needsAuth },
            set: { client.needsAuth = $0 }
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if client.baseURL == nil {
                    ContentUnavailableView {
                        Label("Server not configured", systemImage: "server.rack")
                    } description: {
                        Text("Open the Server tab and enter your Curatube instance URL to get started.")
                    }
                } else if let loadError {
                    ContentUnavailableView {
                        Label("Can't reach server", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(loadError)
                    } actions: {
                        if client.needsAuth {
                            Button("Sign in") { client.needsAuth = true }
                        }
                        Button("Retry") { Task { await reload() } }
                    }
                } else if playlists.isEmpty {
                    ContentUnavailableView(
                        "No playlists yet",
                        systemImage: "film.stack",
                        description: Text("Import a playlist on the server to get started.")
                    )
                } else {
                    List(playlists) { playlist in
                        NavigationLink(value: playlist) {
                            PlaylistRow(playlist: playlist)
                        }
                    }
                    .refreshable { await reload() }
                }
            }
            .navigationTitle("Curatube")
            .task { await reload() }
            .onChange(of: client.needsAuth) { _, needsAuth in
                if !needsAuth, loadError != nil {
                    Task { await reload() }
                }
            }
            .navigationDestination(for: Playlist.self) { playlist in
                VideoListView(playlist: playlist)
            }
            .sheet(isPresented: authRequired) {
                AuthScreen()
            }
        }
    }

    private func reload() async {
        loadError = nil
        do {
            playlists = try await client.fetchPlaylists()
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case APIError.authRequired = error {
                client.needsAuth = true
            }
        }
    }
}

struct PlaylistRow: View {
    let playlist: Playlist

    var body: some View {
        HStack(spacing: 12) {
            RemoteThumb(playlist.thumbnailURL, width: 64, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(playlist.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if playlist.archivedAt != nil {
                Image(systemName: "archivebox")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let channel = playlist.channel { parts.append(channel) }
        let completed = playlist.completedVideoCount
        if playlist.videoCount > 0 {
            parts.append("\(playlist.videoCount) videos")
        }
        if completed > 0 {
            parts.append("\(completed) watched")
        }
        return parts.isEmpty ? playlist.importStatus : parts.joined(separator: " · ")
    }
}