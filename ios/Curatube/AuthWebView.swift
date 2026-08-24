import SwiftUI
import WebKit
import os

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
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: "curatubeConsole")
        userContent.addUserScript(Self.consoleProbeScript)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = userContent

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: startURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private let client: APIClient
        private var succeeded = false

        init(client: APIClient) {
            self.client = client
        }

        // MARK: - Diagnostics

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "curatubeConsole",
                  let body = message.body as? [String: Any],
                  let level = body["level"] as? String,
                  let text = body["text"] as? String else { return }
            os_log("AuthWebView [%{public}@] %{public}@", Log.auth, level, text)
        }

        // MARK: - Navigation

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            if let url = webView.url {
                os_log("AuthWebView didStart %{public}@", Log.auth, url.absoluteString)
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            os_log("AuthWebView didFailProvisional %{public}@ %{public}@", Log.auth, error.localizedDescription, webView.url?.absoluteString ?? "-")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            os_log("AuthWebView didFinish %{public}@", Log.auth, webView.url?.absoluteString ?? "-")
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

private enum Log {
    static let auth = OSLog(subsystem: Bundle.main.bundleIdentifier ?? "dev.say4n.Curatube", category: "auth-webview")
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