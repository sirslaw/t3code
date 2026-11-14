// @effect-diagnostics nodeBuiltinImport:off - Loopback-only fork Vite middleware, separate from native T3.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type * as NodeHttp from "node:http";
import type { Plugin } from "vite-plus";
import {
  EMPTY_SUMMARIES,
  type SummaryData,
  type SummaryInput,
} from "../src/components/pullRequest/workspaceOverview.ts";
import { generateSummaries } from "./workspaceSummaryGeneration.ts";

export function validateSummaryInput(value: unknown): SummaryInput {
  if (!value || typeof value !== "object") throw new Error("Invalid summary request.");
  const input = value as SummaryInput;
  if (
    !Array.isArray(input.threads) ||
    !Array.isArray(input.locations) ||
    input.threads.length > 200 ||
    input.locations.length > 200
  )
    throw new Error("Invalid summary request.");
  const string = (value: unknown, limit: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= limit;
  for (const thread of input.threads) {
    if (
      !string(thread.key, 500) ||
      !string(thread.source, 3000) ||
      !string(thread.title, 1000) ||
      !string(thread.state, 100) ||
      !Array.isArray(thread.messages) ||
      thread.messages.length > 6 ||
      thread.messages.some(
        (message) =>
          !["user", "assistant"].includes(message.role) ||
          typeof message.text !== "string" ||
          message.text.length > 2800,
      )
    )
      throw new Error("Invalid thread summary input.");
  }
  for (const location of input.locations) {
    if (
      !string(location.key, 100_000) ||
      !string(location.title, 1000) ||
      !Array.isArray(location.members) ||
      location.members.length > 200 ||
      location.members.some((key) => !string(key, 500))
    )
      throw new Error("Invalid location summary input.");
  }
  return input;
}

async function requestBody(request: NodeHttp.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 2_000_000) throw new Error("Too much summary context in one request.");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function workspaceSummariesPlugin(directory: string): Plugin {
  let cached: SummaryData = EMPTY_SUMMARIES;
  let queue = Promise.resolve();
  const cachePath = NodePath.join(directory, "summaries.json");
  return {
    name: "workspace-client-summaries",
    async configureServer(server) {
      server.middlewares.use("/__workspace/client", (_request, response) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ directory }));
      });
      await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        const saved = JSON.parse(await NodeFSP.readFile(cachePath, "utf8")) as SummaryData;
        if (saved.threads && saved.locations) cached = saved;
      } catch {
        /* An absent cache starts empty; native data is never read here. */
      }
      server.middlewares.use("/__workspace/summaries", (request, response) => {
        const reply = (status: number, body: unknown) => {
          response.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          response.end(JSON.stringify(body));
        };
        if (
          request.headers.origin &&
          new URL(request.headers.origin).host !== request.headers.host
        ) {
          reply(403, { error: "This endpoint is available only to this local client." });
          return;
        }
        if (request.method === "GET") {
          reply(200, cached);
          return;
        }
        if (request.method !== "POST") {
          reply(405, { error: "Unsupported summary request." });
          return;
        }
        void requestBody(request)
          .then(validateSummaryInput)
          .then((input) => {
            const run = queue.then(async () => {
              const missing: SummaryInput = {
                threads: input.threads.filter(
                  (thread) => cached.threads[thread.key]?.source !== thread.source,
                ),
                locations: input.locations.filter((location) => !cached.locations[location.key]),
              };
              if (missing.threads.length || missing.locations.length) {
                const next = await generateSummaries(missing, cached, directory);
                const temporary = `${cachePath}.tmp`;
                await NodeFSP.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
                await NodeFSP.rename(temporary, cachePath);
                cached = next;
              }
              reply(200, cached);
            });
            queue = run.catch((cause) => {
              reply(503, {
                error: cause instanceof Error ? cause.message : "Summary generation failed.",
              });
            });
          })
          .catch((cause) =>
            reply(400, {
              error: cause instanceof Error ? cause.message : "Invalid summary request.",
            }),
          );
      });
    },
  };
}
