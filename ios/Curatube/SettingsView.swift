import SwiftUI

struct SettingsView: View {
    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    @State private var draftURL = ""
    @State private var testing = false
    @State private var testMessage: String?
    @State private var pendingTestAfterLogin = false
    @FocusState private var urlFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://your-server.example", text: $draftURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($urlFieldFocused)
                    HStack {
                        if testing {
                            ProgressView().controlSize(.small)
                            Text("Checking…").font(.footnote).foregroundStyle(.secondary)
                        }
                        if let testMessage {
                            Text(testMessage)
                                .font(.footnote)
                                .foregroundStyle(testMessage.hasPrefix("Connected") ? .green : .red)
                        }
                        Spacer()
                        Button("Save & Test") { save() }
                            .disabled(testing || draftURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("The server URL is used for catalog, downloads and playback. Sign-in happens automatically if the server is behind a web SSO.")
                }

                Section("Session") {
                    LabeledContent("Signed in", value: client.baseURL != nil && !client.needsAuth ? "Yes" : "No")
                    Button("Sign out") { client.clearSession() }
                        .foregroundStyle(.red)
                }

                Section("Storage") {
                    LabeledContent("Downloaded videos", value: "\(offlineLibrary.downloads.count)")
                }
            }
            .navigationTitle("Server & Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                draftURL = client.baseURLString
            }
            .onChange(of: urlFieldFocused) { _, focused in
                if focused { draftURL = client.baseURLString }
            }
            .onChange(of: client.needsAuth) { _, needsAuth in
                if !needsAuth, pendingTestAfterLogin, !testing {
                    pendingTestAfterLogin = false
                    Task { await testConnection() }
                }
            }
        }
    }

    private func save() {
        client.baseURLString = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
        testMessage = nil
        pendingTestAfterLogin = false
        Task { await testConnection() }
    }

    private func testConnection() async {
        guard client.baseURL != nil else {
            testMessage = "Enter a server URL first."
            return
        }
        testing = true
        defer { testing = false }
        do {
            let playlists = try await client.fetchPlaylists()
            testMessage = "Connected — \(playlists.count) playlists."
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            testMessage = "Error: \(message)"
            if case APIError.authRequired = error {
                testMessage = "Sign-in required — opening the login…"
                pendingTestAfterLogin = true
                client.needsAuth = true
            }
        }
    }
}