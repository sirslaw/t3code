import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { resolveBranchSelectionTarget } from "../BranchToolbar.logic";
import { NewAttachedThreadButton, OverviewThreadCard, WorkStateCounts } from "./WorkOverviewPage";
import { locationSummary, threadKey, workLocations } from "./workspaceOverview";
import { useWorkspaceSummaries } from "./useWorkspaceSummaries";
import styles from "./workOverview.module.css";

export function PullRequestWorkThreads({
  environmentId,
  reference,
  url,
  headBranch,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  url: string;
  headBranch: string;
}) {
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const now = new Date(useNowMinute()).toISOString();
  const location = workLocations(
    threads.filter((thread) => thread.environmentId === environmentId),
    projects,
    "pr",
  ).find((location) => location.pullRequest?.url.toLowerCase() === url.toLowerCase());
  const { summaries, error, refresh, pending } = useWorkspaceSummaries(location ? [location] : []);
  const root = projects.find(
    (project) => project.environmentId === environmentId && project.id === reference.projectId,
  )?.workspaceRoot;
  const branchQuery = useEnvironmentQuery(
    root && !location
      ? vcsEnvironment.listRefs({
          environmentId,
          input: { cwd: root, query: headBranch, refKind: "local", limit: 10 },
        })
      : null,
  );
  const existing = branchQuery.data?.refs.find(
    ({ name, isRemote, current, worktreePath }) =>
      name === headBranch && !isRemote && (current || worktreePath),
  );
  const attached =
    location?.threads[0] ??
    (root && existing
      ? {
          environmentId,
          projectId: reference.projectId,
          branch: headBranch,
          worktreePath: resolveBranchSelectionTarget({
            activeProjectCwd: root,
            activeWorktreePath: null,
            refName: existing,
          }).nextWorktreePath,
        }
      : null);
  return (
    <div className={`${styles["t3-work-overview"]} absolute inset-0 overflow-y-auto p-4.5`}>
      <div className={styles["pr-panel-body"]}>
        <div className={styles["pr-thread-actions"]}>
          {attached ? (
            <NewAttachedThreadButton thread={attached} />
          ) : (
            <button
              type="button"
              className={`${styles["quiet-btn"]} ${styles["new-attached-thread"]}`}
              disabled
              aria-description={
                branchQuery.isPending
                  ? "Checking existing checkouts…"
                  : "No existing checkout is available for this pull request."
              }
            >
              New attached thread
            </button>
          )}
        </div>
        {location ? (
          <p className={styles["thread-summary"]}>
            {locationSummary(location, summaries) ??
              `${location.threads.length} non-settled ${location.threads.length === 1 ? "thread" : "threads"} on this pull request.`}
          </p>
        ) : null}
        <WorkStateCounts threads={location?.threads ?? []} now={now} />
        <div className={styles["thread-list"]}>
          {location?.threads.map((thread) => (
            <OverviewThreadCard
              key={threadKey(thread)}
              thread={thread}
              now={now}
              summaries={summaries}
            />
          )) ?? (
            <p className={styles["thread-summary"]}>
              No non-settled threads are linked to this pull request.
            </p>
          )}
        </div>
        {error ? (
          <p role="status" className={styles["overview-footer"]}>
            {error}
            <button type="button" disabled={pending} onClick={refresh}>
              Retry
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
