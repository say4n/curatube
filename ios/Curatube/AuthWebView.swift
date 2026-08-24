import SwiftUI
import WebKit

/// Full-screen SSO login. Loads the server endpoints in a WKWebView so the
/// Authelia/SAML flow can complete, then harvests the session cookie and hands
/// it to the API client. The hosting view dismisses when `client.needsAuth` clears.
struct AuthWebView: UIViewRepresentable {
    let client: APIClient
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(client: client, startURL: startURL)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.attach(to: webView)
        webView.load(URLRequest(url: startURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.detach(from: uiView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKHTTPCookieStoreObserver {
        private let client: APIClient
        private let startURL: URL
        private weak var webView: WKWebView?
        private var succeeded = false

        init(client: APIClient, startURL: URL) {
            self.client = client
            self.startURL = startURL
        }

        func attach(to webView: WKWebView) {
            self.webView = webView
            webView.configuration.websiteDataStore.httpCookieStore.add(self)
        }

        func detach(from webView: WKWebView) {
            webView.configuration.websiteDataStore.httpCookieStore.remove(self)
        }

        func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            Task { @MainActor [weak self] in
                guard let self, !self.succeeded else { return }
                let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
                    cookieStore.getAllCookies { cookies in
                        continuation.resume(returning: cookies)
                    }
                }
                guard let baseHost = self.client.baseURL?.host, !baseHost.isEmpty else { return }
                let hasSession = cookies.contains { cookie in
                    self.matchesHost(cookie, baseHost: baseHost)
                }
                guard hasSession else { return }
                self.succeeded = true
                self.client.completeLogin(cookies: cookies)
            }
        }

        private func matchesHost(_ cookie: HTTPCookie, baseHost: String) -> Bool {
            let host = baseHost.lowercased()
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
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { client.needsAuth = false }
                }
            }
        }
    }
}