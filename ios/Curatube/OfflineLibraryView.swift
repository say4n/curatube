import SwiftUI

struct OfflineLibraryView: View {
    @Environment(OfflineLibrary.self) private var offlineLibrary

    private var sorted: [OfflineLibrary.OfflineVideo] {
        offlineLibrary.downloads.values.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            Group {
                if offlineLibrary.downloads.isEmpty {
                    ContentUnavailableView(
                        "No downloaded videos",
                        systemImage: "arrow.down.circle",
                        description: Text("Download videos while connected to watch anywhere.")
                    )
                } else {
                    List {
                        Section {
                            ForEach(sorted) { entry in
                                OfflineVideoRow(entry: entry)
                            }
                        }
                        Section("Storage") {
                            LabeledContent("Videos", value: "\(offlineLibrary.downloads.count)")
                            LabeledContent("Used", value: Formatters.bytes(totalBytes))
                        }
                    }
                }
            }
            .navigationTitle("Downloads")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var totalBytes: Int64 {
        offlineLibrary.downloads.values.reduce(0) { $0 + $1.fileSize }
    }
}

struct OfflineVideoRow: View {
    let entry: OfflineLibrary.OfflineVideo

    @Environment(OfflineLibrary.self) private var offlineLibrary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "film.fill")
                .font(.title3)
                .frame(width: 32)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title)
                    .font(.subheadline)
                    .lineLimit(2)
                Text(Formatters.bytes(entry.fileSize))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(role: .destructive) {
                offlineLibrary.remove(videoID: entry.videoID)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
        }
    }
}