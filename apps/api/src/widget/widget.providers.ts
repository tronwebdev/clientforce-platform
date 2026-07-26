/**
 * The widget's answer seam (WID2, DEC-102).
 *
 * "Ask a question" is a GROUNDED answer: retrieve from the workspace's own
 * knowledge, then compose strictly from what came back. Both halves are
 * capability-gated, and the gate is honest in both directions:
 *
 *  - No completion provider configured in this process (the API ships an
 *    embeddings-only gateway — completions live in the planner/voice workers)
 *    ⇒ the answerer refuses. The endpoint returns AGENT_UNAVAILABLE and the
 *    panel says the assistant is unavailable. It does NOT improvise.
 *  - Retrieval finds nothing ⇒ the composer is told to say so. An empty result
 *    is never a licence to invent: the visitor is a stranger on a customer's
 *    marketing page, and a confident wrong answer there is the worst possible
 *    failure for the tenant.
 */
import type { Provider } from "@nestjs/common";
import { AiGateway, AnthropicProvider, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import { retrieve } from "@clientforce/knowledge";
import type { WidgetMessage } from "@clientforce/core";
import { PrismaService } from "../db/prisma.service";

export const WIDGET_ANSWERER = "WIDGET_ANSWERER";

export interface WidgetAnswerRequest {
  workspaceId: string;
  agentId: string;
  sessionId: string;
  question: string;
  history: WidgetMessage[];
}

export interface WidgetAnswerer {
  answer(req: WidgetAnswerRequest): Promise<string>;
}

/** How many knowledge chunks ground one answer. Small on purpose: a widget
 *  reply is two sentences, not an essay, and an unbounded fetch on a public
 *  endpoint is an abuse surface. */
const GROUNDING_CHUNKS = 5;

const SYSTEM = [
  "You are a website assistant answering a visitor on the business's own site.",
  "Answer ONLY from the CONTEXT below. If the context does not contain the answer,",
  "say you don't have that detail and offer to pass the question on — never guess,",
  "never invent prices, availability, policies or credentials.",
  "Two or three sentences, plain text, no markdown, no emoji.",
].join(" ");

class GroundedAnswerer implements WidgetAnswerer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
  ) {}

  async answer(req: WidgetAnswerRequest): Promise<string> {
    // `retrieve` tenant-scopes its own reads (withTenant inside), and the
    // agent scope keeps an agent's knowledge separate from a sibling's.
    const chunks = await retrieve(this.prisma.app, this.gateway, req.workspaceId, req.question, {
      k: GROUNDING_CHUNKS,
      scope: { agentId: req.agentId, includeWorkspace: true },
    });

    const context = chunks.length
      ? chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n")
      : "(no matching knowledge on file)";

    const transcript = req.history
      .slice(-6)
      .map((m) => `${m.role === "agent" ? "Assistant" : "Visitor"}: ${m.text}`)
      .join("\n");

    return this.gateway.complete("widget", {
      system: SYSTEM,
      prompt: `CONTEXT:\n${context}\n\nCONVERSATION:\n${transcript}\n\nAnswer the visitor's last message.`,
    });
  }
}

/** The refusing answerer — what a process with no completion provider gets. */
class UnavailableAnswerer implements WidgetAnswerer {
  async answer(): Promise<string> {
    throw new Error("no completion provider configured in this process");
  }
}

export const widgetProviders: Provider[] = [
  {
    provide: WIDGET_ANSWERER,
    inject: [PrismaService],
    useFactory: (prisma: PrismaService): WidgetAnswerer => {
      // The planner's gate, verbatim: a key or nothing. Never a silent stub.
      if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
        return new UnavailableAnswerer();
      }
      return new GroundedAnswerer(
        prisma,
        new AiGateway({
          provider: new AnthropicProvider(),
          embeddings: new OpenAiEmbeddingsProvider(),
        }),
      );
    },
  },
];
