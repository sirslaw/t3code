# Workspace overview summaries

Checks compact orchestration summaries using the real fork-local prompt and generator. Cases cover excessive implementation detail, distinct review/build responsibilities, an unapproved research decision, and instructions embedded in conversation data. Fixtures are synthetic.

From the repository root, run `node evals/workspace-overview/run.ts --out tmp/workspace-summary-eval`. It makes three paid generation calls using the signed-in Codex account and the summary model configured in `workspaceSummaryGeneration.ts`. No T3 thread or provider turn is started. Read the saved results for responsibility, uncertainty and current progress; the generator independently enforces character and word limits.

The matching unit tests cover length enforcement, cache preservation on incomplete output, membership isolation, and malformed input rejection. This eval does not establish future model behavior or replace the real client check.
