import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  GitBranchIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  SearchIcon,
  FolderGit2Icon,
  MoonIcon,
  CircleDashedIcon,
  XIcon,
} from "lucide-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironmentScope } from "~/state/session";
import { useNowMinute } from "~/hooks/useNowMinute";
import { buildThreadRouteParams } from "~/threadRoutes";
import { isElectron } from "~/env";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTime } from "../RelativeTime";
import { PullRequestDetailPanel } from "./PullRequestDetailPanel";
import { PullRequestGlyph } from "./pullRequestIcons";
import { toastManager } from "../ui/toast";
import {
  compactText,
  locationSource,
  nonSettled,
  threadKey,
  workLocations,
  workState,
  type SummaryData,
  type WorkGrouping,
  type WorkLocation,
  type WorkState,
} from "./workspaceOverview";
import { useWorkspaceSummaries } from "./useWorkspaceSummaries";
import styles from "./workOverview.module.css";

const stateLabels = { open: "Open", working: "Working", snoozed: "Snoozed" };
const stateIcons = { open: CircleDotIcon, working: CircleDashedIcon, snoozed: MoonIcon };
function WorkStateIcon({ state }: { state: WorkState }) {
  const Icon = stateIcons[state];
  return <Icon aria-hidden className={`${styles.ico} ${styles.small}`} />;
}

export function WorkViewTabs({ work = false }: { work?: boolean }) {
  return (
    <div className={styles["t3-work-overview"]}>
      <div className={styles["page-toolbar"]}>
        <div className={styles["view-tabs"]} role="tablist" aria-label="Pull request views">
          <Link
            to="/pull-requests"
            search={{ involvement: "all", state: "open" }}
            className={styles["view-tab"]}
            role="tab"
            aria-selected={!work}
          >
            <PullRequestGlyph.pullRequest aria-hidden className={`${styles.ico} ${styles.small}`} />
            Pull requests
          </Link>
          <Link
            to="/pull-requests"
            search={{ involvement: "all", state: "open", view: "work" }}
            className={styles["view-tab"]}
            role="tab"
            aria-selected={work}
          >
            <LayoutGridIcon aria-hidden className={`${styles.ico} ${styles.small}`} />
            Work overview
          </Link>
        </div>
      </div>
    </div>
  );
}

export function OverviewThreadCard({
  thread,
  now,
  summaries,
}: {
  thread: EnvironmentThreadShell;
  now: string;
  summaries: SummaryData;
}) {
  const state = workState(thread, now);
  const overview = summaries.threads[threadKey(thread)];
  const status = thread.hasPendingApprovals
    ? "Needs approval"
    : thread.hasPendingUserInput || thread.pendingSubagentRequest
      ? "Needs your input"
      : stateLabels[state];
  return (
    <Link
      className={styles["overview-thread"]}
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
      aria-label={`Open ${thread.title}`}
    >
      <div className={styles["thread-content"]}>
        <span className={styles["thread-link"]}>
          <span className={styles["thread-name"]}>{thread.title}</span>
        </span>
        <p className={styles["thread-summary"]}>
          {overview?.summary ?? compactText(thread.title, 120, 18)}
        </p>
        <div className={styles["thread-detail-line"]}>
          <span>{overview?.role ?? (thread.lineage.parentThreadId ? "Agent task" : "Thread")}</span>
          <span>·</span>
          <span className={styles["provider-name"]}>
            {thread.runtime?.providerName ?? thread.modelSelection.instanceId}
          </span>
          <span>·</span>
          <span>
            {overview ? (
              <>
                Summary <RelativeTime timestamp={overview.generatedAt} />
              </>
            ) : (
              "Summary pending"
            )}
          </span>
          {state === "working" && overview ? (
            <>
              <span>·</span>
              <span>Last completed work</span>
            </>
          ) : null}
        </div>
      </div>
      <span className={`${styles["thread-status"]} ${styles[`state-${state}`]}`}>
        <WorkStateIcon state={state} />
        {status}
      </span>
      <span className={`${styles["icon-btn"]} ${styles["thread-open"]}`} aria-hidden>
        <ArrowRightIcon className={`${styles.ico} ${styles.small}`} />
      </span>
    </Link>
  );
}

export function NewAttachedThreadButton({
  thread,
}: {
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId" | "branch" | "worktreePath">;
}) {
  const handleNewThread = useNewThreadHandler();
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  return (
    <button
      type="button"
      className={`${styles["quiet-btn"]} ${styles["new-attached-thread"]}`}
      disabled={!canOperate}
      aria-description={`New thread on ${thread.branch ?? "this checkout"}`}
      onClick={() => {
        void handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          startFromOrigin: false,
        }).catch((error: unknown) =>
          toastManager.add({
            type: "error",
            title: "Could not open attached thread",
            description: error instanceof Error ? error.message : "Try again.",
          }),
        );
      }}
    >
      <MessageSquarePlusIcon aria-hidden className={`${styles.ico} ${styles.small}`} />
      New attached thread
    </button>
  );
}

export function WorkStateCounts({
  threads,
  now,
}: {
  threads: readonly EnvironmentThreadShell[];
  now: string;
}) {
  return (
    <div className={styles["state-counts"]}>
      {(["working", "open", "snoozed"] as const).map((state) => {
        const count = threads.filter((thread) => workState(thread, now) === state).length;
        return count ? (
          <span key={state} className={`${styles["state-count"]} ${styles[`state-${state}`]}`}>
            <WorkStateIcon state={state} />
            {count} {state}
          </span>
        ) : null;
      })}
    </div>
  );
}

function LocationBlock({
  location,
  now,
  groupBy,
  expanded,
  onToggle,
  onOpenPr,
  summaries,
}: {
  location: WorkLocation;
  now: string;
  groupBy: WorkGrouping;
  expanded: boolean;
  onToggle: () => void;
  onOpenPr: () => void;
  summaries: SummaryData;
}) {
  const heading = location.branch ?? location.project.title;
  const summary = summaries.locations[locationSource(location)];
  return (
    <section className={styles.location} aria-label={heading}>
      <div className={styles["location-head"]}>
        <button
          className={styles["location-toggle"]}
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${heading}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDownIcon className={`${styles.ico} ${styles.small}`} />
          ) : (
            <ChevronRightIcon className={`${styles.ico} ${styles.small}`} />
          )}
        </button>
        <div className={styles["location-main"]}>
          <div className={styles["location-title-row"]}>
            <button type="button" className={styles["location-name"]} onClick={onToggle}>
              {groupBy === "pr" && location.pullRequest ? (
                <PullRequestGlyph.pullRequest className={`${styles.ico} ${styles.small}`} />
              ) : groupBy === "branch" ? (
                <GitBranchIcon className={`${styles.ico} ${styles.small}`} />
              ) : (
                <FolderGit2Icon className={`${styles.ico} ${styles.small}`} />
              )}
              <span className={styles.truncate}>{heading}</span>
            </button>
          </div>
          <div className={styles["location-meta"]}>
            <ProjectFavicon project={location.project} className="size-3.5" />
            <span>{location.project.title}</span>
            <span>·</span>
            {location.pullRequest ? (
              <button className={styles["pr-ref"]} type="button" onClick={onOpenPr}>
                <PullRequestGlyph.pullRequest className={`${styles.ico} ${styles.tiny}`} />#
                {location.pullRequest.number}
              </button>
            ) : (
              <span>No pull request</span>
            )}
            <span className={styles["worktree-path"]}>·</span>
            <span
              className={`${styles.mono} ${styles["worktree-path"]}`}
              aria-label={location.path}
            >
              {location.path.split(/[\\/]/).at(-1)}
            </span>
          </div>
          <p className={styles["location-summary"]}>
            {summary?.summary ??
              `${location.threads.length} non-settled ${location.threads.length === 1 ? "thread" : "threads"} in this ${groupBy === "pr" ? "group" : groupBy}.`}
          </p>
          <WorkStateCounts threads={location.threads} now={now} />
        </div>
        <div className={styles["location-actions"]}>
          <span className={styles["location-count"]}>
            <MessageSquareIcon className={`${styles.ico} ${styles.small}`} />
            {location.threads.length} {location.threads.length === 1 ? "thread" : "threads"}
          </span>
          <NewAttachedThreadButton thread={location.threads[0]!} />
        </div>
      </div>
      {expanded ? (
        <div className={styles["thread-list"]}>
          {location.threads.map((thread) => (
            <OverviewThreadCard
              key={threadKey(thread)}
              thread={thread}
              now={now}
              summaries={summaries}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function WorkOverviewPage() {
  const search = useSearch({ from: "/_chat/pull-requests" });
  const allThreads = useVisibleThreadShells();
  const projects = useProjects();
  const now = new Date(useNowMinute()).toISOString();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [groupBy, setGroupBy] = useState<WorkGrouping>("worktree");
  const [expansion, setExpansion] = useState(new Map<string, boolean>());
  const [panel, setPanel] = useState<WorkLocation | null>(null);
  const threads = allThreads.filter(
    (thread) =>
      nonSettled(thread) &&
      (!search.environmentId || thread.environmentId === search.environmentId) &&
      (!search.projectId || thread.projectId === search.projectId) &&
      (!projectKey || `${thread.environmentId}:${thread.projectId}` === projectKey),
  );
  const locations = workLocations(threads, projects, groupBy);
  const { summaries, pending, error, refresh } = useWorkspaceSummaries(locations);
  const filtered = locations.flatMap((location) => {
    const matching = location.threads.filter(
      (thread) =>
        (!status || workState(thread, now) === status) &&
        (!query ||
          `${thread.title} ${summaries.threads[threadKey(thread)]?.summary ?? ""} ${summaries.threads[threadKey(thread)]?.role ?? ""} ${location.path} ${location.branch ?? ""} ${location.pullRequest?.number ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())),
    );
    return matching.length ? [{ ...location, threads: matching }] : [];
  });
  const count = new Set(filtered.flatMap((location) => location.threads.map(threadKey))).size;
  const panelPr = panel?.pullRequest
    ? sourceControlClients.parseChangeRequestUrl(panel.pullRequest.url)?.link
    : null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron}>
        <span className="text-sm">Pull requests</span>
      </WorkspacePageHeader>
      <div className={`${styles["t3-work-overview"]} ${styles["work-overview-layout"]}`}>
        <main className={`${styles.page} ${styles["overview-page"]}`}>
          <div className={styles["work-toolbar"]}>
            <WorkViewTabs work />
            <div className={styles["toolbar-right"]}>
              <select
                aria-label="Filter by project"
                className={styles["filter-select"]}
                value={projectKey}
                onChange={(event) => setProjectKey(event.target.value)}
              >
                <option value="">All projects</option>
                {projects
                  .filter((project) => !project.archivedAt)
                  .map((project) => (
                    <option
                      key={`${project.environmentId}:${project.id}`}
                      value={`${project.environmentId}:${project.id}`}
                    >
                      {project.title}
                    </option>
                  ))}
              </select>
              <button
                className={styles["icon-btn"]}
                aria-label="Refresh work overview"
                type="button"
                onClick={refresh}
                disabled={pending}
              >
                <RefreshCwIcon className={`${styles.ico} ${styles.small}`} />
              </button>
            </div>
          </div>
          <div className={styles["overview-intro"]}>
            <div>
              <h1>Work overview</h1>
              <p>What’s happening across your worktrees, branches, and pull requests.</p>
            </div>
            <span className={styles["summary-freshness"]}>
              {pending ? "Updating summaries…" : "Summaries update automatically"}
            </span>
          </div>
          {error ? (
            <p role="status" className={styles["overview-footer"]}>
              {error} Previous summaries are kept. Use Refresh to retry.
            </p>
          ) : null}
          <div className={styles.filters}>
            <label className={styles["filter-search"]}>
              <SearchIcon className={`${styles.ico} ${styles.small}`} />
              <input
                aria-label="Search work"
                placeholder="Search work, branches, or threads…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              className={styles["filter-select"]}
              aria-label="Filter by thread state"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All non-settled</option>
              {(["open", "working", "snoozed"] as const).map((state) => (
                <option key={state} value={state}>
                  {stateLabels[state]}
                </option>
              ))}
            </select>
            <div className={styles["group-by"]}>
              <span>Group by</span>
              {(["worktree", "branch", "pr"] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={groupBy === group}
                  onClick={() => {
                    setGroupBy(group);
                    setExpansion(new Map());
                  }}
                >
                  {group === "pr" ? "PR" : group === "branch" ? "Branch" : "Worktree"}
                </button>
              ))}
            </div>
          </div>
          <div className={styles["overview-legend"]}>
            <span>
              {filtered.length}{" "}
              {groupBy === "pr"
                ? `group${filtered.length === 1 ? "" : "s"}`
                : `${groupBy}${filtered.length === 1 ? "" : "s"}`}
            </span>
            <span>·</span>
            <span>
              {count} non-settled {count === 1 ? "thread" : "threads"}
            </span>
            <span className={styles.right}>
              {groupBy === "pr"
                ? "Pull request / branch"
                : groupBy === "branch"
                  ? "Branch / worktree"
                  : "Worktree / pull request"}
            </span>
          </div>
          {filtered.map((location, index) => (
            <LocationBlock
              key={location.key}
              location={location}
              now={now}
              groupBy={groupBy}
              summaries={summaries}
              expanded={expansion.get(location.key) ?? index === 0}
              onToggle={() =>
                setExpansion((old) =>
                  new Map(old).set(location.key, !(old.get(location.key) ?? index === 0)),
                )
              }
              onOpenPr={() => setPanel(location)}
            />
          ))}
          {!filtered.length ? (
            <div className={styles["empty-state"]}>
              <strong>{query || status ? "No matching work" : "No non-settled threads"}</strong>
              {query || status
                ? "Try another state, project, or search."
                : "New work will appear here automatically."}
            </div>
          ) : null}
          <p className={styles["overview-footer"]}>
            <CircleDotIcon className={`${styles.ico} ${styles.tiny}`} />
            Status is live. Summaries describe each thread’s goal and latest completed responses.
          </p>
        </main>
        {panel && panelPr ? (
          <aside className={styles["work-pr-panel"]} aria-label="Pull request details">
            <button
              type="button"
              className={`${styles["icon-btn"]} ${styles["work-panel-close"]}`}
              aria-label="Close pull request panel"
              onClick={() => setPanel(null)}
            >
              <XIcon className={styles.ico} />
            </button>
            <PullRequestDetailPanel
              key={`${panel.project.environmentId}:${panel.pullRequest?.url}`}
              environmentId={panel.project.environmentId}
              reference={{
                projectId: panel.project.id,
                repository: panelPr.repository,
                number: panelPr.number,
                host: panelPr.host,
              }}
              shortcutsEnabled
              getShortcutContext={() => ({
                terminalFocus: false,
                terminalOpen: false,
                previewFocus: false,
                previewOpen: false,
                modelPickerOpen: false,
                isWeb: !isElectron,
                isDesktop: isElectron,
              })}
              initialTab="threads"
              onClose={() => setPanel(null)}
            />
          </aside>
        ) : null}
      </div>
    </SidebarInset>
  );
}
