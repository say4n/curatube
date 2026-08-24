import SwiftUI
import Observation

@main
struct CuratubeApp: App {
    @State private var client = APIClient()
    @State private var offlineLibrary = OfflineLibrary()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(client)
                .environment(offlineLibrary)
        }
    }
}

struct RootView: View {
    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    var body: some View {
        TabView {
            PlaylistListView()
                .tabItem { Label("Playlists", systemImage: "list.and.film") }
            OfflineLibraryView()
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
            SettingsView()
                .tabItem { Label("Server", systemImage: "server.rack") }
        }
    }
}