import Foundation
import Observation

/// Registry of videos downloaded to this device, plus the active download tasks.
@MainActor
@Observable
final class OfflineLibrary {
    struct OfflineVideo: Identifiable, Hashable {
        let videoID: String
        let title: String
        let fileURL: URL
        let fileSize: Int64
        let downloadedAt: Date

        var id: String { videoID }
    }

    private(set) var downloads: [String: OfflineVideo] = [:]
    private(set) var activeTasks: [String: DownloadTask] = [:]

    private let fileManager = FileManager.default
    private var directory: URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("OfflineVideos", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private var indexFileURL: URL {
        directory.appendingPathComponent("index.json")
    }

    init() {
        loadIndex()
    }

    func isOffline(_ videoID: String) -> Bool {
        downloads[videoID] != nil
    }

    func localURL(for videoID: String) -> URL? {
        downloads[videoID]?.fileURL
    }

    func task(for videoID: String) -> DownloadTask? {
        activeTasks[videoID]
    }

    @discardableResult
    func startDownload(videoID: String, title: String, remoteURL: URL) -> DownloadTask {
        if let existing = activeTasks[videoID] { return existing }
        let task = DownloadTask(videoID: videoID, title: title, remoteURL: remoteURL)
        activeTasks[videoID] = task
        task.onFinish = { [weak self] task, fileURL, size in
            self?.registerCompleted(videoID: task.videoID, title: task.title, fileURL: fileURL, size: size)
        }
        task.resume()
        return task
    }

    func remove(videoID: String) {
        activeTasks.removeValue(forKey: videoID)?.cancel()
        if let entry = downloads.removeValue(forKey: videoID) {
            try? fileManager.removeItem(at: entry.fileURL)
        }
        saveIndex()
    }

    private func registerCompleted(videoID: String, title: String, fileURL: URL, size: Int64) {
        downloads[videoID] = OfflineVideo(
            videoID: videoID,
            title: title,
            fileURL: fileURL,
            fileSize: size,
            downloadedAt: Date()
        )
        activeTasks.removeValue(forKey: videoID)
        saveIndex()
    }

    private struct IndexRecord: Codable {
        let videoID: String
        let title: String
        let fileURLPath: String
        let fileSize: Int64
        let downloadedAt: Date
    }

    private func saveIndex() {
        let records = downloads.map { record in
            IndexRecord(
                videoID: record.key,
                title: record.value.title,
                fileURLPath: record.value.fileURL.path,
                fileSize: record.value.fileSize,
                downloadedAt: record.value.downloadedAt
            )
        }
        do {
            let data = try JSONEncoder().encode(records)
            try data.write(to: indexFileURL, options: .atomic)
        } catch {
            NSLog("Curatube: failed to save offline index: %@", error.localizedDescription)
        }
    }

    private func loadIndex() {
        guard let data = try? Data(contentsOf: indexFileURL),
              let records = try? JSONDecoder().decode([IndexRecord].self, from: data) else { return }
        var loaded: [String: OfflineVideo] = [:]
        for record in records {
            let url = URL(fileURLWithPath: record.fileURLPath)
            guard fileManager.fileExists(atPath: url.path) else { continue }
            loaded[record.videoID] = OfflineVideo(
                videoID: record.videoID,
                title: record.title,
                fileURL: url,
                fileSize: record.fileSize,
                downloadedAt: record.downloadedAt
            )
        }
        downloads = loaded
    }
}

/// One device download. Streams the prepared media file from the server into
/// Application Support with byte-range progress reporting.
@MainActor
@Observable
final class DownloadTask: NSObject, URLSessionDownloadDelegate, URLSessionDataDelegate {
    enum State: Equatable {
        case downloading
        case finished
        case failed(String)
    }

    let videoID: String
    let title: String
    let remoteURL: URL

    var state: State = .downloading
    var writtenBytes: Int64 = 0
    var expectedBytes: Int64 = 0

    var progress: Double {
        expectedBytes > 0 ? min(1, Double(writtenBytes) / Double(expectedBytes)) : 0
    }

    var onFinish: ((DownloadTask, URL, Int64) -> Void)?

    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var mimeType = "video/mp4"

    init(videoID: String, title: String, remoteURL: URL) {
        self.videoID = videoID
        self.title = title
        self.remoteURL = remoteURL
        super.init()
    }

    func resume() {
        guard session == nil else { return }
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 7 * 24 * 3600
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.session = session
        let task = session.downloadTask(with: remoteURL)
        self.task = task
        task.resume()
    }

    func cancel() {
        task?.cancel()
        session?.invalidateAndCancel()
        session = nil
    }

    nonisolated func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        Task { @MainActor in
            guard self.task == downloadTask else { return }
            self.writtenBytes = totalBytesWritten
            self.expectedBytes = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 0
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        Task { @MainActor in
            guard self.task == downloadTask else { return }
            self.finishTemporaryFile(location, mime: self.mimeType)
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        task sessionTask: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let error else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        Task { @MainActor in
            self.state = .failed(error.localizedDescription)
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse
    ) async -> URLSession.ResponseDisposition {
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 200
        let mime = (http?.mimeType ?? "").lowercased()
        let accepted = (200...299).contains(status)
        Task { @MainActor in
            if !mime.isEmpty, accepted { self.mimeType = mime }
            if !accepted { self.state = .failed("Server returned HTTP \(status)") }
        }
        return accepted ? .allow : .cancel
    }

    private func finishTemporaryFile(_ location: URL, mime: String) {
        if case .failed = state { return }
        let extensionName = Self.fileExtension(for: mime)
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineVideos", isDirectory: true)
        try? fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        let destination = base.appendingPathComponent("\(videoID).\(extensionName)")
        try? fileManager.removeItem(at: destination)
        do {
            try fileManager.moveItem(at: location, to: destination)
            let size = (try? fileManager.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
            state = .finished
            onFinish?(self, destination, size)
        } catch {
            state = .failed("Could not store the video: \(error.localizedDescription)")
        }
    }

    private var fileManager: FileManager { .default }

    private static func fileExtension(for mime: String) -> String {
        switch mime {
        case "video/webm": return "webm"
        case "video/x-matroska": return "mkv"
        case "video/mp4", "video/quicktime": return "mp4"
        default: return "mp4"
        }
    }
}