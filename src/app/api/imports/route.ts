import { NextResponse } from "next/server";
import { z } from "zod";
import { createImportJob, startImportJob } from "@/lib/importer";

export const runtime = "nodejs";

const bodySchema = z.object({
  url: z.string().url()
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid YouTube playlist URL." }, { status: 400 });
  }

  const job = createImportJob(parsed.data.url);
  startImportJob(job.id);

  return NextResponse.json({ job });
}

