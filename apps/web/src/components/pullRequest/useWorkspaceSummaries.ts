import { useEffect, useState } from "react";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  EMPTY_SUMMARIES,
  locationSource,
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
  const messages = result.value.messages.filter(
    (message) => !message.streaming && (message.role === "user" || message.role === "assistant"),
  );
  const selected = new Set([
    ...messages.filter((message) => message.role === "user").slice(-2),
    ...messages.filter((message) => message.role === "assistant").slice(-4),
  ]);
  return messages
    .filter((message) => selected.has(message))
    .map((message) => ({ role: message.role, text: message.text.slice(-2800) }));
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
  const [summaries, setSummaries] = useState<SummaryData>(EMPTY_SUMMARIES);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const signature = JSON.stringify(locations.map(locationSource).sort());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- signature contains the summary-relevant locations; streaming-only shell changes must not fetch or regenerate
  useEffect(() => {
    const controller = new AbortController();
    const synchronize = async () => {
      try {
        const cached = await summaryRequest(undefined, controller.signal);
        if (controller.signal.aborted) return;
        setError(null);
        setPending(true);
        setSummaries(cached);
        const threads = [
          ...new Map(
            // oxlint-disable-next-line react/exhaustive-effect-dependencies -- semantic inputs are captured by signature; streaming timestamps must not refetch
            locations
              .flatMap((location) => location.threads)
              .map((thread) => [threadKey(thread), thread]),
          ).values(),
        ];
        const missing = threads.filter(
          (thread) => cached.threads[threadKey(thread)]?.source !== summarySource(thread),
        );
        const missingLocations = locations.filter(
          (location) => !cached.locations[locationSource(location)],
        );
        if (!missing.length && !missingLocations.length) return;
        const input: SummaryInput = {
          threads: [],
          locations: missingLocations.map((location) => ({
            key: locationSource(location),
            title: location.branch ?? location.project.title,
            members: location.threads.map(threadKey),
          })),
        };
        // Bound history reads; unrelated native UI and active agents keep their existing throughput.
        for (let index = 0; index < missing.length; index += 4) {
          const contexts = await Promise.all(
            missing.slice(index, index + 4).map(async (thread) => ({
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
        const next = await summaryRequest(input, controller.signal);
        if (!controller.signal.aborted) setSummaries(next);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Summaries could not be updated.");
      }
    };
    void synchronize().finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [signature, revision]);
  return { summaries, pending, error, refresh: () => setRevision((value) => value + 1) };
}
