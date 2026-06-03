import { HomePage } from "@/components/home-page";
import { getBuildCommit } from "@/lib/build-info";
import { getPlaylists, getRecentJobs } from "@/lib/db";
import { backfillPlaylists } from "@/lib/thumbnails";

export const dynamic = "force-dynamic";

export default async function Page() {
  const playlists = getPlaylists();
  const jobs = getRecentJobs();

  await backfillPlaylists(playlists);

  return (
    <HomePage
      initialPlaylists={playlists}
      initialJobs={jobs}
      buildCommit={getBuildCommit()}
    />
  );
}
