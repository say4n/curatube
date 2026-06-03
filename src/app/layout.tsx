import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ServiceWorkerCleanup } from "@/components/service-worker-cleanup";

export const metadata: Metadata = {
  title: "Curatube",
  description: "A distraction free learning environment for YouTube courses"
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
        {children}
      </body>
    </html>
  );
}
