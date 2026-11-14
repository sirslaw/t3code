import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { makeThreadFixture } from "~/test-fixtures";
import { compactText, locationSource, workLocations, workState } from "./workspaceOverview";

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
      const groups = workLocations([active, settled], [project], grouping);
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
