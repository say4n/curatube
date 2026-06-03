import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { mediaDir } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const filepath = path.join(mediaDir, "thumbnails", filename);

  try {
    const file = await fs.readFile(filepath);
    
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new NextResponse("Not found", { status: 404 });
  }
}
