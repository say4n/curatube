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

struct PlaylistResponse: Codable {
    let playlist: Playlist
}

struct VideosResponse: Codable {
    let videos: [Video]
}

struct VideoProgress: Codable, Hashable {
    let videoID: String
    let positionSeconds: Double?
    let durationSeconds: Double?
    let completed: Bool

    enum CodingKeys: String, CodingKey {
        case videoID
        case positionSeconds
        case durationSeconds
        case completed
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        videoID = try container.decode(String.self, forKey: .videoID)
        positionSeconds = try container.decodeIfPresent(Double.self, forKey: .positionSeconds)
        durationSeconds = try container.decodeIfPresent(Double.self, forKey: .durationSeconds)
        if let flag = try? container.decode(Bool.self, forKey: .completed) {
            completed = flag
        } else if let flag = try? container.decode(Int.self, forKey: .completed) {
            completed = flag != 0
        } else {
            completed = false
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(videoID, forKey: .videoID)
        try container.encodeIfPresent(positionSeconds, forKey: .positionSeconds)
        try container.encodeIfPresent(durationSeconds, forKey: .durationSeconds)
        try container.encode(completed, forKey: .completed)
    }
}

struct PlaylistVideosResponse: Codable {
    let videos: [Video]
    let progress: [VideoProgress]
}

struct SingleVideoProgressResponse: Codable {
    let progress: VideoProgress?
}

struct TranscriptSegment: Codable, Identifiable, Hashable {
    let id: Int
    let startSeconds: Double
    let durationSeconds: Double?
    let text: String
}

struct TranscriptResponse: Codable {
    let transcript: [TranscriptSegment]
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
    case unreachableSignIn(hops: [String])

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
        case .unreachableSignIn(let hops):
            if hops.isEmpty {
                return "Could not reach your server."
            }
            return "Could not reach the sign-in page (\(hops.joined(separator: " → ")))."
        }
    }
}