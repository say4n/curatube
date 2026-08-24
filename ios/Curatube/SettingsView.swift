import SwiftUI

struct SettingsView: View {
    @Environment(APIClient.self) private var client
    @Environment(OfflineLibrary.self) private var offlineLibrary

    @State private var draftURL = ""
    @State private var testing = false
    @State private var testMessage: String?
    @FocusState private var urlFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://yt.sayan.page", text: $draftURL)
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
                        Button("Test") { Task { await testConnection() } }
                            .disabled(testing || draftURL == client.baseURLString && testMessage != nil)
                        Button("Save") { save() }
                            .disabled(draftURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("The server URL is used for catalog, downloads and playback. Sign-in happens automatically if the server is behind a web SSO.")
                }

                Section("Session") {
                    LabeledContent("Signed in", value: client.needsAuth ? "No" : "Yes")
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
        }
    }

    private func save() {
        client.baseURLString = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
        testMessage = nil
        Task { await testConnection() }
    }

    private func testConnection() async {
        testing = true
        defer { testing = false }
        do {
            let playlists = try await client.fetchPlaylists()
            testMessage = "Connected — \(playlists.count) playlists."
        } catch {
            testMessage = "Error: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
            if case APIError.authRequired = error {
                client.needsAuth = true
            }
        }
    }
}