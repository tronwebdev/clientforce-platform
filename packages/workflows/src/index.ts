/**
 * @clientforce/workflows — CampaignWorkflow on Temporal (P1.6).
 *
 * Host-side surface only: shared contracts, activities factory, client
 * helpers. Workflow code stays behind `WORKFLOWS_PATH` (or the ./workflows
 * subpath export) and is loaded exclusively by the Temporal worker bundler.
 */
export * from "./shared";
export * from "./activities";
export * from "./client";

/** Pass to `Worker.create({ workflowsPath })` — resolves next to this build. */
export const WORKFLOWS_PATH = require.resolve("./workflows");
