import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

export type WorkState = "open" | "working" | "snoozed";
export type WorkGrouping = "worktree" | "branch" | "pr";
export const THREAD_SUMMARY_LIMIT = 120;
export const LOCATION_SUMMARY_LIMIT = 160;

export function compactText(value: string, characters: number, words: number): string {
  const text = value.replace(/\s+/g, " ").trim().split(" ").slice(0, words).join(" ");
  if (text.length <= characters) return text;
  const cut = text.slice(0, characters - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > characters / 2 ? boundary : cut.length).trimEnd()}…`;
}

export function nonSettled(thread: EnvironmentThreadShell): boolean {
  return (
    thread.deletedAt === null && thread.archivedAt === null && thread.settledOverride !== "settled"
  );
}

export function workState(thread: EnvironmentThreadShell, now: string): WorkState {
  if (effectiveSnoozed(thread, { now })) return "snoozed";
  return isThreadWorking(thread) ? "working" : "open";
}

export function threadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return `${thread.environmentId}:${thread.id}`;
}

export function summarySource(thread: EnvironmentThreadShell): string {
  return JSON.stringify([
    thread.title,
    thread.latestUserMessageAt,
    thread.latestRun?.runId,
    thread.latestRun?.completedAt,
  ]);
}

export interface ThreadSummary {
  role: string;
  summary: string;
  generatedAt: string;
  source: string;
}
export interface SummaryData {
  threads: Record<string, ThreadSummary>;
  locations: Record<string, { summary: string; generatedAt: string }>;
}
export const EMPTY_SUMMARIES: SummaryData = { threads: {}, locations: {} };

function primaryPullRequest(thread: EnvironmentThreadShell) {
  return (
    thread.linkedPullRequest ??
    thread.branchPullRequest ??
    thread.pullRequests.find((link) => link.source !== "stack-dismissed") ??
    null
  );
}

export interface WorkLocation {
  key: string;
  project: EnvironmentProject;
  branch: string | null;
  path: string;
  worktreePath: string | null;
  pullRequest: ReturnType<typeof primaryPullRequest>;
  threads: EnvironmentThreadShell[];
}

export function locationSource(location: Pick<WorkLocation, "key" | "threads">): string {
  return JSON.stringify([
    location.key,
    location.threads
      .map((thread) => [threadKey(thread), summarySource(thread)])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
  ]);
}

export function workLocations(
  threads: readonly EnvironmentThreadShell[],
  projects: readonly EnvironmentProject[],
  groupBy: WorkGrouping,
): WorkLocation[] {
  const projectMap = new Map(
    projects
      .filter((project) => !project.archivedAt)
      .map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  const locations = new Map<string, WorkLocation>();
  for (const thread of threads
    .filter(nonSettled)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const project = projectMap.get(`${thread.environmentId}:${thread.projectId}`);
    if (!project) continue;
    const primary = primaryPullRequest(thread);
    const links =
      groupBy === "pr"
        ? [
            ...new Map(
              [
                ...(primary ? [primary] : []),
                ...thread.pullRequests.filter((link) => link.source !== "stack-dismissed"),
              ].map((link) => [link.url.toLowerCase(), link]),
            ).values(),
          ]
        : [primary];
    for (const pullRequest of links.length ? links : [null]) {
      const path = thread.worktreePath ?? project.workspaceRoot;
      const repository = project.repositoryIdentity ?? project.workspaceRoot;
      const key = JSON.stringify([
        thread.environmentId,
        repository,
        groupBy,
        groupBy === "pr" && pullRequest
          ? pullRequest.url.toLowerCase()
          : groupBy === "branch"
            ? (thread.branch ?? path)
            : path,
        groupBy === "worktree" ? thread.branch : null,
      ]);
      const location = locations.get(key) ?? {
        key,
        project,
        branch: thread.branch,
        path,
        worktreePath: thread.worktreePath,
        pullRequest,
        threads: [],
      };
      location.threads.push(thread);
      locations.set(key, location);
    }
  }
  return [...locations.values()];
}

export interface SummaryThreadInput {
  key: string;
  source: string;
  title: string;
  state: string;
  messages: Array<{ role: string; text: string }>;
}
export interface SummaryLocationInput {
  key: string;
  title: string;
  members: string[];
}
export interface SummaryInput {
  threads: SummaryThreadInput[];
  locations: SummaryLocationInput[];
}
