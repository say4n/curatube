import { NextResponse } from "next/server";
import { getImportJob } from "@/lib/db";
import { startImportJob } from "@/lib/importer";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getImportJob(id);

  if (!job) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  if (job.status === "queued") {
    startImportJob(job.id);
  }

  return NextResponse.json({ job });
}

