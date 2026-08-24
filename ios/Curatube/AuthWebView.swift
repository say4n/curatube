import SwiftUI
import WebKit
import os

/// Full-screen SSO login.
///
/// Loads the login page on the *auth host* (discovered when the app's requests
/// get redirected off the server, e.g. `auth.sayan.page`) instead of the app
/// server itself. WebKit's WebContent process can be unreliable connecting to
/// private/LAN IPs, so by loading the auth host directly we avoid that path.
/// Login completion is judged by probing the app server with the harvested
/// cookies over URLSession (which uses normal app networking): when the API
/// responds, the session is real and the sheet dismisses.
struct AuthWebView: UIViewRepresentable {
    let client: APIClient
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(client: client)
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: "curatubeConsole")
        userContent.addUserScript(Self.consoleProbeScript)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = userContent

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

    /// Forwards console, JS errors and unhandled rejections to the app's unified
    /// log so a blank login page can be debugged from `log show`.
    private static let consoleProbeScript: WKUserScript = {
        let source = """
        (function () {
          if (window.__curatubeProbe) return;
          window.__curatubeProbe = true;
          var send = function (level, text) {
            try {
              window.webkit.messageHandlers.curatubeConsole.postMessage({ level: level, text: text });
            } catch (e) {}
          };
          ['log', 'info', 'warn', 'error'].forEach(function (l) {
            var original = console[l];
            console[l] = function () {
              var text = Array.prototype.map.call(arguments, function (a) {
                try { return (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a); }
                catch (e) { return String(a); }
              }).join(' ');
              send(l, text);
              try { original.apply(console, arguments); } catch (e) {}
            };
          });
          window.addEventListener('error', function (e) {
            send('error', 'Uncaught: ' + e.message + ' at ' + (e.filename || '?') + ':' + (e.lineno || '?'));
          });
          window.addEventListener('unhandledrejection', function (e) {
            send('error', 'UnhandledRejection: ' + String(e.reason));
          });
          document.addEventListener('DOMContentLoaded', function () {
            send('log', 'DOMContentLoaded; body children: ' + document.body.children.length);
          });
          window.addEventListener('load', function () {
            send('log', 'window load; body text len: ' + (document.body.innerText || '').length);
          });
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    }()

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKHTTPCookieStoreObserver {
        private let client: APIClient
        private weak var webView: WKWebView?
        private var verifyTask: Task<Void, Never>?
        private var succeeded = false
        private var pendingURL: String?

        init(client: APIClient) {
            self.client = client
        }

        func attach(to webView: WKWebView) {
            self.webView = webView
            webView.configuration.websiteDataStore.httpCookieStore.add(self)
        }

        func detach(from webView: WKWebView) {
            webView.configuration.websiteDataStore.httpCookieStore.remove(self)
            verifyTask?.cancel()
        }

        // MARK: - Diagnostics

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "curatubeConsole",
                  let body = message.body as? [String: Any],
                  let level = body["level"] as? String,
                  let text = body["text"] as? String else { return }
            os_log("AuthWebView [%{public}@] %{public}@", log: Log.auth, level, text)
        }

        // MARK: - Navigation

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            pendingURL = webView.url?.absoluteString
            os_log("AuthWebView didStart %{public}@", log: Log.auth, pendingURL ?? "-")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            os_log("AuthWebView didFailProvisional %{public}@ url=%{public}@", log: Log.auth, error.localizedDescription, pendingURL ?? "-")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            os_log("AuthWebView didFinish %{public}@", log: Log.auth, webView.url?.absoluteString ?? "-")
            scheduleVerify(delay: 0.3)
        }

        // MARK: - Session detection

        func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            scheduleVerify(delay: 0.5)
        }

        private func scheduleVerify(delay: Double) {
            guard !succeeded else { return }
            verifyTask?.cancel()
            verifyTask = Task { @MainActor [weak self] in
                guard let self else { return }
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard !Task.isCancelled, !self.succeeded else { return }
                await self.attemptVerify()
            }
        }

        @MainActor
        private func attemptVerify() async {
            guard let webView, !succeeded else { return }
            let store = webView.configuration.websiteDataStore.httpCookieStore
            let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
                store.getAllCookies { continuation.resume(returning: $0) }
            }
            let sessionCookies = cookies.filter { matchesHost($0) }
            guard !sessionCookies.isEmpty else { return }

            // Sync into URLSession's shared storage so app requests authenticate.
            for cookie in sessionCookies {
                HTTPCookieStorage.shared.setCookie(cookie)
            }

            // The placeholder LB cookie still redirects; only a real session
            // makes the API respond, so trust the probe over cookie presence.
            do {
                _ = try await client.fetchPlaylists()
                guard !succeeded else { return }
                succeeded = true
                client.completeLogin(cookies: cookies)
            } catch {
                // Not authenticated (yet) or transient; wait for the next change.
            }
        }

        private func matchesHost(_ cookie: HTTPCookie) -> Bool {
            guard let host = client.baseURL?.host?.lowercased() else { return false }
            var domain = (cookie.domain ?? "").lowercased()
            if domain.hasPrefix(".") { domain.removeFirst() }
            return !domain.isEmpty && (host == domain || host.hasSuffix("." + domain))
        }
    }
}

private enum Log {
    static let auth = OSLog(subsystem: Bundle.main.bundleIdentifier ?? "sayan.page.Curatube", category: "auth-webview")
}

struct AuthScreen: View {
    @Environment(APIClient.self) private var client

    @State private var loginURL: URL?
    @State private var resolveError: String?

    var body: some View {
        NavigationStack {
            Group {
                if let loginURL {
                    AuthWebView(client: client, startURL: loginURL)
                        .id(loginURL)
                } else if let resolveError {
                    ContentUnavailableView {
                        Label("Can't open the sign-in page", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(resolveError)
                    } actions: {
                        Button("Retry") { Task { await resolve() } }
                    }
                } else {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Opening sign-in…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
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
            .task { await resolve() }
        }
    }

    private func resolve() async {
        resolveError = nil
        loginURL = nil
        do {
            loginURL = try await client.resolveLoginURL()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            resolveError = message + "\n\nConnect to your server's network and try again."
        }
    }
}