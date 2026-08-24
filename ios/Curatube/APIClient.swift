import Foundation
import Observation

@MainActor
@Observable
final class APIClient {
    private static let serverURLKey = "curatube.serverBaseURL"

    var baseURLString: String {
        didSet { UserDefaults.standard.set(baseURLString, forKey: Self.serverURLKey) }
    }

    /// Becomes true when a request is redirected off the configured server
    /// (e.g. to an Authelia SSO login page). The UI presents the login web view.
    var needsAuth = false

    private let redirectDelegate = RedirectDelegate()
    private let session: URLSession

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    init() {
        baseURLString = UserDefaults.standard.string(forKey: Self.serverURLKey) ?? ""
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: redirectDelegate, delegateQueue: .main)
        self.session = session
        redirectDelegate.onRedirect = { [weak self] host in
            guard let self else { return }
            if let baseHost = self.baseURL?.host?.lowercased(),
               host.lowercased() != baseHost {
                self.needsAuth = true
            }
        }
    }

    var baseURL: URL? {
        var value = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        guard !value.isEmpty, let url = URL(string: value) else { return nil }
        return url
    }

    /// Resolve a possibly-relative path (thumbnail URLs) against the configured server.
    func resolve(_ pathOrURL: String?) -> URL? {
        guard let pathOrURL, let base = baseURL else { return nil }
        if let url = URL(string: pathOrURL), url.scheme != nil {
            return url
        }
        return URL(string: pathOrURL, relativeTo: base)?.absoluteURL
    }

    func apiEndpoint(_ path: String) throws -> URL {
        guard let base = baseURL,
              let url = URL(string: path, relativeTo: base)?.absoluteURL else {
            throw APIError.invalidServerURL
        }
        return url
    }

    func mediaURL(videoID: String) throws -> URL {
        try apiEndpoint("/api/videos/\(Self.pathSegment(videoID))/media")
    }

    func fetchPlaylists() async throws -> [Playlist] {
        let data = try await perform(URLRequest(url: try apiEndpoint("/api/playlists")))
        return try Self.decoder.decode(PlaylistsResponse.self, from: data).playlists
    }

    func fetchVideos(playlistID: String) async throws -> [Video] {
        let path = "/api/playlists/\(Self.pathSegment(playlistID))/videos"
        let data = try await perform(URLRequest(url: try apiEndpoint(path)))
        return try Self.decoder.decode(VideosResponse.self, from: data).videos
    }

    func fetchDownloadStatus(videoID: String) async throws -> DownloadStatus {
        let path = "/api/videos/\(Self.pathSegment(videoID))/download"
        let data = try await perform(URLRequest(url: try apiEndpoint(path)))
        return try Self.decoder.decode(DownloadResponse.self, from: data).download
    }

    func startServerDownload(videoID: String) async throws -> DownloadStatus {
        var request = URLRequest(url: try apiEndpoint("/api/videos/\(Self.pathSegment(videoID))/download"))
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        let data = try await perform(request)
        return try Self.decoder.decode(DownloadResponse.self, from: data).download
    }

    /// Copy cookies harvested from the SSO login web view into the shared cookie
    /// storage so URLSession (and downloads) stay authenticated.
    func completeLogin(cookies: [HTTPCookie]) {
        for cookie in cookies {
            HTTPCookieStorage.shared.setCookie(cookie)
        }
        needsAuth = false
    }

    func clearSession() {
        if let cookies = HTTPCookieStorage.shared.cookies {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        needsAuth = false
    }

    private static func serverErrorDescription(from data: Data, status: Int) -> APIError {
        if let error = try? decoder.decode(ServerErrorPayload.self, from: data) {
            return .server(error.error)
        }
        return .http(status)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.badResponse
            }
            guard (200...299).contains(http.statusCode) else {
                throw Self.serverErrorDescription(from: data, status: http.statusCode)
            }
            return data
        } catch {
            if needsAuth { throw APIError.authRequired }
            if let apiError = error as? APIError { throw apiError }
            throw APIError.server(error.localizedDescription)
        }
    }

    private static func pathSegment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

/// URLSession delegate that stops redirects off the configured base host and
/// flags that authentication is required (typical behind Authelia/SSO proxies).
final class RedirectDelegate: NSObject, URLSessionTaskDelegate {
    var onRedirect: ((String) -> Void)?

    nonisolated func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        if let host = request.url?.host {
            onRedirect?(host)
        }
        return nil
    }
}