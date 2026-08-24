import SwiftUI

/// Loads an image from either a resolved URL or a server-relative path with a
/// placeholder while loading.
struct RemoteThumb: View {
    @Environment(APIClient.self) private var client

    let urlOverride: URL?
    let pathOrURL: String?
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        let url = urlOverride ?? client.resolve(pathOrURL)
        return ZStack {
            Rectangle().fill(Color(.secondarySystemBackground))
            if let url {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().aspectRatio(contentMode: .fill)
                    }
                }
            } else {
                Image(systemName: "film")
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    init(_ pathOrURL: String?, width: CGFloat, height: CGFloat) {
        self.urlOverride = nil
        self.pathOrURL = pathOrURL
        self.width = width
        self.height = height
    }
}