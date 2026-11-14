import { useEffect, useState } from "react";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useConnectedEnvironmentIds } from "~/state/environments";
import {
  EMPTY_SUMMARIES,
  locationKey,
  planSummaries,
  selectSummaryMessages,
  summaryReady,
  summarySource,
  threadKey,
  workState,
  type SummaryData,
  type SummaryInput,
  type WorkLocation,
} from "./workspaceOverview";

const readProjection = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "workspace-overview:read-history",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
});

async function readContext(thread: WorkLocation["threads"][number]) {
  const result = await runAtomCommand(
    appAtomRegistry,
    readProjection,
    { environmentId: thread.environmentId, input: { threadId: thread.id } },
    { label: "Read overview context", reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return selectSummaryMessages(result.value.messages);
}

async function summaryRequest(input?: SummaryInput, signal?: AbortSignal): Promise<SummaryData> {
  const response = await fetch("/__workspace/summaries", {
    method: input ? "POST" : "GET",
    ...(input
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
      : {}),
    signal: signal ?? null,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? "Summaries are temporarily unavailable.");
  }
  return response.json() as Promise<SummaryData>;
}

export function useWorkspaceSummaries(locations: readonly WorkLocation[]) {
  const connected = useConnectedEnvironmentIds();
  const available = locations.filter((location) =>
    connected.includes(location.project.environmentId),
  );
  const [summaries, setSummaries] = useState<SummaryData>(EMPTY_SUMMARIES);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const signature = JSON.stringify(
    available
      .map((location) => [
        locationKey(location),
        location.threads
          .map((thread) => [threadKey(thread), summaryReady(thread) ? summarySource(thread) : null])
          .sort(),
      ])
      .sort(),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- signature contains the summary-relevant locations; streaming-only shell changes must not fetch or regenerate
  useEffect(() => {
    const controller = new AbortController();
    const synchronize = async () => {
      try {
        let cached = await summaryRequest(undefined, controller.signal);
        if (controller.signal.aborted) return;
        setError(null);
        setPending(true);
        setSummaries(cached);
        while (!controller.signal.aborted) {
          // oxlint-disable-next-line react/exhaustive-effect-dependencies -- signature captures membership and completed context; streaming-only changes must not restart reads
          const plan = planSummaries(available, cached);
          if (!plan.threads.length && !plan.locations.length) return;
          const input: SummaryInput = { threads: [], locations: plan.locations };
          for (let index = 0; index < plan.threads.length; index += 4) {
            const contexts = await Promise.all(
              plan.threads.slice(index, index + 4).map(async (thread) => ({
                key: threadKey(thread),
                source: summarySource(thread),
                title: thread.title,
                state: workState(thread, new Date().toISOString()),
                messages: await readContext(thread),
              })),
            );
            if (controller.signal.aborted) return;
            input.threads.push(...contexts);
          }
          cached = await summaryRequest(input, controller.signal);
          if (!controller.signal.aborted) setSummaries(cached);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Summaries could not be updated.");
      }
    };
    const timer = setTimeout(() => {
      void synchronize().finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    }, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [signature, revision]);
  return { summaries, pending, error, refresh: () => setRevision((value) => value + 1) };
}
