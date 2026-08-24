import SwiftUI
import Observation
import AVFoundation

@main
struct CuratubeApp: App {
    @State private var client = APIClient()
    @State private var offlineLibrary = OfflineLibrary()

    init() {
        // Play video audio via the media volume even when the device is muted
        // via the ring/silent switch (like YouTube).
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }

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

    private var authRequired: Binding<Bool> {
        Binding(
            get: { client.needsAuth },
            set: { client.needsAuth = $0 }
        )
    }

    var body: some View {
        TabView {
            PlaylistListView()
                .tabItem { Label("Playlists", systemImage: "list.and.film") }
            OfflineLibraryView()
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
            SettingsView()
                .tabItem { Label("Server", systemImage: "server.rack") }
        }
        .sheet(isPresented: authRequired) {
            AuthScreen()
        }
    }
}