import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import {
  connectTemporalClient,
  signalEnrollmentReply,
  startCampaignWorkflow,
  type CampaignWorkflowInput,
} from "@clientforce/workflows";

export const WORKFLOW_ENGINE = Symbol("WORKFLOW_ENGINE");

/**
 * Thin seam between the REST surface and Temporal so e2e tests (and any future
 * engine) inject a fake — the controller logic stays identical either way.
 */
export interface WorkflowEngine {
  start(input: CampaignWorkflowInput): Promise<{ workflowId: string; deduped: boolean }>;
  signalReply(enrollmentId: string, intent: string): Promise<void>;
}

@Injectable()
export class TemporalWorkflowEngine implements WorkflowEngine {
  private clientPromise?: Promise<Client | null>;

  private async client(): Promise<Client> {
    this.clientPromise ??= connectTemporalClient();
    const client = await this.clientPromise;
    if (!client) {
      throw new ServiceUnavailableException(
        "Workflow engine offline — TEMPORAL_ADDRESS is not configured in this environment",
      );
    }
    return client;
  }

  async start(input: CampaignWorkflowInput): Promise<{ workflowId: string; deduped: boolean }> {
    return startCampaignWorkflow(await this.client(), input);
  }

  async signalReply(enrollmentId: string, intent: string): Promise<void> {
    await signalEnrollmentReply(await this.client(), enrollmentId, intent);
  }
}
