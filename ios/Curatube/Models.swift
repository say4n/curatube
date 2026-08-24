import Foundation

struct Playlist: Codable, Identifiable, Hashable {
    let id: String
    let sourceURL: String
    let title: String
    let channel: String?
    let thumbnailURL: String?
    let videoCount: Int
    let completedVideoCount: Int
    let importStatus: String
    let archivedAt: String?
    let createdAt: String
    let updatedAt: String
    let lastWatchedAt: String?
}

struct Video: Codable, Identifiable, Hashable {
    let id: String
    let playlistID: String
    let youtubeID: String
    let title: String
    let thumbnailURL: String?
    let durationSeconds: Int?
    let position: Int
}

struct DownloadStatus: Codable {
    let videoID: String
    let status: String
    let filePath: String?
    let fileSizeBytes: Int?
    let mimeType: String?
    let progressPercent: Double?
    let downloadedBytes: Int?
    let totalBytes: Int?
    let speedBytesPerSecond: Int?
    let etaSeconds: Int?
    let error: String?

    var isReady: Bool { status == "ready" }
    var isActive: Bool { status == "queued" || status == "running" }
}

struct PlaylistsResponse: Codable {
    let playlists: [Playlist]
}

struct VideosResponse: Codable {
    let videos: [Video]
}

struct DownloadResponse: Codable {
    let download: DownloadStatus
}

struct ServerErrorPayload: Codable {
    let error: String
}

enum APIError: LocalizedError {
    case invalidServerURL
    case http(Int)
    case server(String)
    case authRequired
    case badResponse

    var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "The server URL isn't valid."
        case .http(let code):
            return "The server returned an error (\(code))."
        case .server(let message):
            return message
        case .authRequired:
            return "Sign-in required."
        case .badResponse:
            return "Unexpected response from the server."
        }
    }
}