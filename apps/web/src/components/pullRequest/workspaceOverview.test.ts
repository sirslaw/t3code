import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { makeThreadFixture } from "~/test-fixtures";
import {
  compactText,
  locationSource,
  planSummaries,
  selectSummaryMessages,
  summarySource,
  threadKey,
  workLocations,
  workState,
  EMPTY_SUMMARIES,
} from "./workspaceOverview";

const projectId = ProjectId.make("project-test");
const environmentId = EnvironmentId.make("environment-test");
const project = {
  id: projectId,
  environmentId,
  title: "App",
  workspaceRoot: "/home/user/app",
  archivedAt: null,
  repositoryIdentity: null,
} as EnvironmentProject;
const now = "2026-11-13T10:00:00Z";

describe("workspace overview membership", () => {
  it("excludes settled work before every grouping, even when snoozed, and removes empty locations", () => {
    const active = makeThreadFixture({
      id: ThreadId.make("active"),
      branch: "feature",
      worktreePath: "/home/user/feature",
    });
    const settled = makeThreadFixture({
      id: ThreadId.make("settled"),
      settledOverride: "settled",
      branch: "settled-only",
      worktreePath: "/home/user/settled",
      snoozedUntil: "2099-01-01T00:00:00Z",
    });
    for (const grouping of ["worktree", "branch", "pr"] as const) {
      const groups = workLocations(
        [
          active,
          settled,
          { ...active, id: ThreadId.make("archived"), archivedAt: now },
          { ...active, id: ThreadId.make("deleted"), deletedAt: now },
        ],
        [project],
        grouping,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]?.threads.map((thread) => thread.id)).toEqual([active.id]);
    }
    expect(workLocations([settled], [project], "worktree")).toEqual([]);
  });

  it("separates distinct checkouts and environments while grouping branches within a repository", () => {
    const first = makeThreadFixture({
      id: ThreadId.make("one"),
      branch: "feature",
      worktreePath: "/home/user/one",
    });
    const second = makeThreadFixture({
      id: ThreadId.make("two"),
      branch: "feature",
      worktreePath: "/home/user/two",
    });
    const elsewhere = makeThreadFixture({
      id: first.id,
      environmentId: EnvironmentId.make("other"),
      branch: first.branch,
      worktreePath: first.worktreePath,
    });
    const projects = [project, { ...project, environmentId: elsewhere.environmentId }];
    expect(workLocations([first, second, elsewhere], projects, "worktree")).toHaveLength(3);
    expect(workLocations([first, second, elsewhere], projects, "branch")).toHaveLength(2);
  });

  it("retains every linked PR exactly once and ignores dismissed stack links", () => {
    const first = {
      projectId,
      linkedAt: now,
      snapshot: null,
      stack: null,
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      repository: "acme/app",
      state: "open" as const,
      source: "manual" as const,
      watching: false,
      watchStartedAt: null,
      host: "github.com",
    };
    const second = { ...first, number: 13, url: "https://github.com/acme/app/pull/13" };
    const thread = makeThreadFixture({
      linkedPullRequest: first,
      pullRequests: [
        first,
        second,
        {
          ...second,
          number: 14,
          url: "https://github.com/acme/app/pull/14",
          source: "stack-dismissed",
        },
      ],
    });
    expect(
      workLocations([thread], [project], "pr").map((group) => group.pullRequest?.number),
    ).toEqual([12, 13]);
  });

  it("invalidates a combined summary when membership or source context changes", () => {
    const one = makeThreadFixture({ id: ThreadId.make("one"), branch: "feature" });
    const two = makeThreadFixture({ id: ThreadId.make("two"), branch: "feature" });
    const group = workLocations([one, two], [project], "branch")[0]!;
    const source = locationSource(group);
    expect(locationSource({ ...group, threads: [two, one] })).toBe(source);
    expect(locationSource({ ...group, threads: [one] })).not.toBe(source);
    expect(
      locationSource({ ...group, threads: [{ ...one, latestUserMessageAt: now }, two] }),
    ).not.toBe(source);
    expect(locationSource({ ...group, threads: [{ ...one, updatedAt: now }, two] })).toBe(source);
    const regrouped = { ...group, key: "same-members-another-grouping" };
    expect(locationSource(regrouped)).toBe(source);
  });

  it("reuses summaries across groupings, skips unfinished turns, and avoids singleton generation", () => {
    const one = makeThreadFixture({
      id: ThreadId.make("one"),
      branch: "feature",
      latestUserMessageAt: now,
    });
    const two = makeThreadFixture({
      id: ThreadId.make("two"),
      branch: "feature",
      latestUserMessageAt: now,
    });
    const location = workLocations([one, two], [project], "worktree")[0]!;
    const initial = planSummaries([location], EMPTY_SUMMARIES);
    expect(initial.threads).toHaveLength(2);
    expect(initial.locations).toHaveLength(1);
    const cached = {
      threads: Object.fromEntries(
        [one, two].map((thread) => [
          threadKey(thread),
          {
            source: summarySource(thread),
            role: "Review",
            summary: "Checking changes.",
            generatedAt: now,
          },
        ]),
      ),
      locations: {
        [initial.locations[0]!.key]: {
          source: initial.locations[0]!.source,
          summary: "Review underway.",
          generatedAt: now,
        },
      },
    };
    expect(planSummaries([{ ...location, key: "branch-group" }], cached)).toEqual({
      threads: [],
      locations: [],
    });
    const renamed = { ...one, title: "A better title" };
    expect(summarySource(renamed)).toBe(summarySource(one));
    const previousFormat = {
      ...cached,
      threads: {
        ...cached.threads,
        [threadKey(one)]: {
          ...cached.threads[threadKey(one)]!,
          source: JSON.stringify([
            one.title,
            one.latestUserMessageAt,
            one.latestRun?.runId,
            one.latestRun?.completedAt,
          ]),
        },
      },
    };
    expect(planSummaries([{ ...location, threads: [renamed, two] }], previousFormat)).toEqual({
      threads: [],
      locations: [],
    });
    const busy = {
      ...one,
      latestUserMessageAt: "2026-11-13T11:00:00Z",
      latestRun: { runId: "new-run", status: "running", completedAt: null },
    } as typeof one;
    expect(planSummaries([{ ...location, threads: [busy, two] }], cached)).toEqual({
      threads: [],
      locations: [],
    });
    const finished = {
      ...busy,
      latestRun: { ...busy.latestRun!, status: "completed", completedAt: "2026-11-13T12:00:00Z" },
    } as typeof one;
    expect(planSummaries([{ ...location, threads: [finished, two] }], cached).threads).toEqual([
      finished,
    ]);
    expect(planSummaries([{ ...location, threads: [one] }], EMPTY_SUMMARIES).locations).toEqual([]);
    expect(
      planSummaries(
        [{ ...location, threads: [{ ...one, latestUserMessageAt: null }] }],
        EMPTY_SUMMARIES,
      ).threads,
    ).toEqual([]);
  });

  it("bounds model context while retaining the goal, newest request and completed response", () => {
    const messages = [
      { role: "user", text: "original ".repeat(1000), streaming: false },
      ...Array.from({ length: 5 }, () => ({
        role: "assistant",
        text: "old ".repeat(1000),
        streaming: false,
      })),
      { role: "user", text: "latest ".repeat(1000), streaming: false },
      { role: "assistant", text: "result ".repeat(1000), streaming: false },
      { role: "assistant", text: "unfinished", streaming: true },
    ];
    const selected = selectSummaryMessages(messages);
    expect(selected.slice(0, 2).map((message) => message.text.slice(0, 6))).toEqual([
      "origin",
      "latest",
    ]);
    expect(selected[2]!.text).toBe(messages[7]!.text.slice(-2400));
    expect(selected.reduce((size, message) => size + message.text.length, 0)).toBeLessThanOrEqual(
      4800,
    );
  });

  it("finishes bounded batches before summarizing a group's complete membership", () => {
    const threads = Array.from({ length: 20 }, (_, index) =>
      makeThreadFixture({
        id: ThreadId.make(`thread-${index}`),
        branch: "feature",
        latestUserMessageAt: now,
      }),
    );
    const location = workLocations(threads, [project], "worktree")[0]!;
    const first = planSummaries([location], EMPTY_SUMMARIES);
    expect(first.threads).toHaveLength(16);
    expect(first.locations).toEqual([]);
    const cached = {
      threads: Object.fromEntries(
        first.threads.map((thread) => [
          threadKey(thread),
          {
            source: summarySource(thread),
            summary: "Checking changes.",
            role: "Review",
            generatedAt: now,
          },
        ]),
      ),
      locations: {},
    };
    const remaining = planSummaries([location], cached);
    expect(remaining.threads).toHaveLength(4);
    expect(remaining.locations).toHaveLength(1);
    expect(remaining.locations[0]!.members).toHaveLength(20);
  });

  it("uses actual snooze state and bounds visible prose without joining paragraphs", () => {
    const snoozed = makeThreadFixture({
      snoozedUntil: "2099-01-01T00:00:00Z",
      snoozedAt: "2026-01-01T00:00:00Z",
    });
    expect(workState(snoozed, now)).toBe("snoozed");
    const summary = compactText("A long implementation detail.\n".repeat(60), 120, 18);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.split(" ").length).toBeLessThanOrEqual(18);
    expect(summary).not.toContain("\n");
  });
});
