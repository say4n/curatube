import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ServiceWorkerCleanup } from "@/components/service-worker-cleanup";

export const metadata: Metadata = {
  title: "Curatube",
  description: "A distraction free learning environment for YouTube courses",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerCleanup />
        {process.env.DEMO_MODE_ENABLED === "true" && (
          <div className="fixed top-4 right-4 z-50">
            <a
              href="https://github.com/say4n/curatube"
              target="_blank"
              rel="noreferrer"
              className="bg-black/90 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-black transition-colors shadow-lg border border-white/10 flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
              View on GitHub
            </a>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
