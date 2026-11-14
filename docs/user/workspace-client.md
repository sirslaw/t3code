# T3 Workspace

T3 Workspace is this fork's independent macOS client. It connects to the already-running native T3 environment, so projects, threads, providers, accounts, rules and skills continue to use the same server and filesystem. The official application stays installed and running normally.

Open `.workspace-client/T3 Workspace.app` after the first development launch. It starts this fork's frontend when needed. UI edits hot reload in the window. Closing the custom window does not close native T3.

## Work overview

Open **Pull requests → Work overview**. Group non-settled threads by worktree, branch or PR, then search or filter by project and current state. Settled and archived threads are excluded, including locations containing only settled work. Work without a PR remains visible.

Each location has a short combined summary, live state counts and expandable thread cards. Click anywhere on a card to open its conversation. **New attached thread** opens a fresh draft using that section's existing branch and checkout, with the same behavior as the existing thread context-menu action. It does not create a new worktree or copy conversation history.

Automatic summaries identify each thread's responsibility and latest completed progress. Thread descriptions are limited to 120 characters and 18 words; combined descriptions to 160 characters and 24 words. Live status is shown separately. Summaries update when the overview is open and a turn finishes; reopening catches up. Starting or streaming a turn spends no summary tokens. Results are reused across groupings, and a one-thread location reuses its thread summary. A failed generation keeps the previous useful text and shows a retry action. Titles remain visible immediately.

Summary generation uses T3's default short-text model through the signed-in local Codex CLI in ephemeral, read-only mode with shell tools, plugins, apps and delegation disabled. Context is limited to 4,800 characters per thread, and requests are batched. Unchanged results cost no model call. Queued requests are discarded when their view closes; an already-running generation finishes and caches its result for reuse. It uses model allowance, creates no T3 thread, and saves only the custom summary metadata in `.workspace-client/summaries`. It never changes thread titles, ordering or settlement. Browser preferences and drafts remain specific to this client; the native sidebar implementation is unchanged.

## Development setup

Use the repository's pinned Node and package manager, install dependencies with `vp install --frozen-lockfile`, then run `vp run workspace:dev`. The launcher discovers the existing native server from its runtime metadata. It starts Vite and a separate packaged client, without starting another T3 backend. The generated profile, summaries and runtime files are ignored by Git.

For isolated verification, pass `--server http://127.0.0.1:<test-port> --port <client-port>`. `--web` runs just the frontend. Normal pairing authorizes each environment; keep pairing credentials out of source and logs. No shared SQLite database or Chromium profile is opened by the second client.

The fork currently checks against `0.1.10-nightly.20261113.4643`. If native T3 updates, check the fork's compatibility against that release before changing the launcher's verified version. The launcher refuses a different release rather than replacing or restarting native T3. Keep fork changes on their own branch and use the `upstream` remote for upstream changes.
