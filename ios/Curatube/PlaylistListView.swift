import SwiftUI

enum PlaylistScope: String, CaseIterable, Identifiable {
    case unarchived
    case archived

    var id: String { rawValue }

    var title: String {
        switch self {
        case .unarchived: return "Default"
        case .archived: return "Archived"
        }
    }
}

struct PlaylistListView: View {
    @Environment(APIClient.self) private var client

    @State private var playlists: [Playlist] = []
    @State private var loadError: String?
    @State private var scope: PlaylistScope = .unarchived

    private var visiblePlaylists: [Playlist] {
        switch scope {
        case .unarchived:
            return playlists.filter { $0.archivedAt == nil }
        case .archived:
            return playlists.filter { $0.archivedAt != nil }
        }
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
                } else if visiblePlaylists.isEmpty {
                    ContentUnavailableView(
                        playlists.isEmpty ? "No playlists yet" : "No playlists here",
                        systemImage: "film.stack",
                        description: Text(
                            playlists.isEmpty
                                ? "Import a playlist on the server to get started."
                                : "Nothing to show in this filter. Switch it from the top-right menu."
                        )
                    )
                } else {
                    List(visiblePlaylists) { playlist in
                        NavigationLink(value: playlist) {
                            PlaylistRow(playlist: playlist)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            let isArchived = playlist.archivedAt != nil
                            Button {
                                Task { await toggleArchive(playlist) }
                            } label: {
                                Label(
                                    isArchived ? "Unarchive" : "Archive",
                                    systemImage: isArchived ? "tray.and.arrow.up" : "archivebox"
                                )
                            }
                            .tint(isArchived ? .blue : .orange)
                        }
                    }
                    .refreshable { await reload() }
                }
            }
            .navigationTitle("Curatube")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Playlist scope", selection: $scope) {
                            ForEach(PlaylistScope.allCases) { scope in
                                Text(scope.title).tag(scope)
                            }
                        }
                    } label: {
                        Label("Filter playlists", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .task { await reload() }
            .onChange(of: client.needsAuth) { _, needsAuth in
                if !needsAuth, loadError != nil {
                    Task { await reload() }
                }
            }
            .navigationDestination(for: Playlist.self) { playlist in
                VideoListView(playlist: playlist)
            }
        }
    }

    private func toggleArchive(_ playlist: Playlist) async {
        let archived = playlist.archivedAt == nil
        do {
            let updated = try await client.setPlaylistArchived(playlistID: playlist.id, archived: archived)
            if let index = playlists.firstIndex(where: { $0.id == playlist.id }) {
                playlists[index] = updated
            }
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if case APIError.authRequired = error {
                client.needsAuth = true
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