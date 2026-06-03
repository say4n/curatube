import { HomePage } from "@/components/home-page";
import { getPlaylists, getRecentJobs } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Page() {
  const playlists = getPlaylists();
  const jobs = getRecentJobs();

  return <HomePage initialPlaylists={playlists} initialJobs={jobs} />;
}

