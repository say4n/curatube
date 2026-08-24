import SwiftUI
import WebKit

/// Full-screen SSO login. Loads the server endpoints in a WKWebView so the
/// Authelia/SAML flow can complete, then harvests the session cookie and hands
/// it to the API client. The hosting view dismisses when `client.needsAuth` clears.
///
/// Login is only considered complete after the web view finishes navigating
/// back to the *base host* (the SSO redirect target). The proxy sets a
/// placeholder cookie on first redirect, so regardless of cookie activity we
/// must wait for that navigation, or the login sheet would tear down early.
struct AuthWebView: UIViewRepresentable {
    let client: APIClient
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(client: client)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: startURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let client: APIClient
        private var succeeded = false

        init(client: APIClient) {
            self.client = client
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !succeeded, let url = webView.url, isBaseHost(url) else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                try? await Task.sleep(nanoseconds: 600_000_000)
                await self.harvest(from: webView)
            }
        }

        @MainActor
        private func harvest(from webView: WKWebView) async {
            guard !succeeded else { return }
            let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
                webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                    continuation.resume(returning: cookies)
                }
            }
            guard cookies.contains(where: { matchesHost($0) }) else { return }
            succeeded = true
            client.completeLogin(cookies: cookies)
        }

        private func isBaseHost(_ url: URL) -> Bool {
            url.host?.lowercased() == client.baseURL?.host?.lowercased()
        }

        private func matchesHost(_ cookie: HTTPCookie) -> Bool {
            guard let host = client.baseURL?.host?.lowercased() else { return false }
            var domain = (cookie.domain ?? "").lowercased()
            if domain.hasPrefix(".") { domain.removeFirst() }
            return !domain.isEmpty && (host == domain || host.hasSuffix("." + domain))
        }
    }
}

struct AuthScreen: View {
    @Environment(APIClient.self) private var client

    var body: some View {
        NavigationStack {
            Group {
                if let startURL = try? client.apiEndpoint("/api/playlists") {
                    AuthWebView(client: client, startURL: startURL)
                } else {
                    ContentUnavailableView("Invalid server URL", systemImage: "server.rack")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        client.authRequestAborted = true
                        client.needsAuth = false
                    }
                }
            }
        }
    }
}