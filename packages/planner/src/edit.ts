/**
 * Manual-edit validation gate (W3-4, DEC-076). Every editor write passes the
 * same three-layer discipline planner output does — zod shape, `validateGraph`
 * structure/semantics, and this policy layer — plus the deterministic
 * `repairGraph` pass (the manual analogue of the planner's bounded LLM repair,
 * which repairs MODEL output; the owner's typed words are never rewritten).
 *
 * Policy here is RELATIVE to the previous version: an edit must never REDUCE
 * a structural guarantee the stored graph already had. That keeps legacy
 * (pre-playbook) graphs editable byte-for-byte while blocking regressions on
 * playbook graphs — and it deliberately does NOT re-apply the generation-only
 * copy rails (merge tokens, neverSay, output language): those judge the
 * MODEL's writing; the owner's own typed words stay exempt (the documented
 * M1a stance in `validateAll`, restated by DEC-076).
 */
import {
  GraphValidationError,
  mainSteps,
  validateGraph,
  type BranchNode,
  type CampaignGraph,
  type StepNode,
} from "@clientforce/core";
import { IntentSchema } from "@clientforce/events";

export interface EditContext {
  /** Channels the workspace can SEND today (DEC-061: sms only with an ACTIVE Twilio sender). */
  allowedChannels: string[];
}

function replyBranches(graph: CampaignGraph): BranchNode[] {
  return graph.nodes.filter((n): n is BranchNode => n.type === "branch" && n.on === "reply");
}

function stepsOf(graph: CampaignGraph): StepNode[] {
  return graph.nodes.filter((n): n is StepNode => n.type === "step");
}

/**
 * Validate an edited graph against the previous stored version. Throws
 * {@link GraphValidationError} with an owner-readable message; never persists
 * anything itself. Returns the typed graph on success.
 */
export function validateEditedGraph(
  previous: CampaignGraph | null,
  candidate: unknown,
  ctx: EditContext,
): CampaignGraph {
  const graph = validateGraph(candidate);
  const steps = stepsOf(graph);
  if (steps.length === 0) throw new GraphValidationError("Graph has no step nodes");

  // Channel capability: new steps only send on live channels; channels the
  // previous version already used stay legal (an expired sender must not
  // brick unrelated edits).
  const prevChannels = new Set(previous ? stepsOf(previous).map((s) => s.channel) : []);
  const disallowed = steps.filter(
    (s) => !ctx.allowedChannels.includes(s.channel) && !prevChannels.has(s.channel),
  );
  if (disallowed.length > 0) {
    throw new GraphValidationError(
      `Steps ${disallowed.map((s) => s.id).join(", ")} use channels this workspace can't send on yet (available: ${ctx.allowedChannels.join(", ")})`,
    );
  }

  // A scripted email/sms step with no body would send nothing — reject unless
  // that exact step already looked like this in the stored version (legacy
  // tolerance; generated graphs always carry copy).
  const prevById = new Map(previous ? stepsOf(previous).map((s) => [s.id, s]) : []);
  for (const s of steps) {
    if (s.mode === "guided") continue;
    if (s.channel !== "email" && s.channel !== "sms") continue;
    if (s.content.body?.trim()) continue;
    const prev = prevById.get(s.id);
    if (prev && !prev.content.body?.trim() && prev.mode !== "guided") continue;
    throw new GraphValidationError(
      `Step "${s.id}" has no body copy — write the message (or flip the step to guided) before saving`,
    );
  }

  // Structural guarantees never regress vs the stored version.
  if (previous) {
    const prevDelays = previous.nodes.filter((n) => n.type === "delay").length;
    if (prevDelays > 0 && !graph.nodes.some((n) => n.type === "delay")) {
      throw new GraphValidationError("Graph must contain at least one delay node");
    }
    const prevReply = replyBranches(previous).length;
    const nextReply = replyBranches(graph).length;
    if (nextReply !== prevReply) {
      throw new GraphValidationError(
        `Edits must keep the graph's ${prevReply} reply ${prevReply === 1 ? "branch" : "branches"} — found ${nextReply} (branch structure changes come from the planner/rules, not the step editor)`,
      );
    }

    // Playbook no-regression: every (intent → pipeline / routes-to-step /
    // default) contract the previous reply branches carried must survive.
    // Checked PER BRANCH (matched by stable node id, falling back to the
    // whole set) — a flattened map would let duplicate intents across
    // branches clobber each other (review round, DEC-076).
    const nextReplyBranches = replyBranches(graph);
    const casesOf = (bs: BranchNode[]) =>
      new Map(
        bs.flatMap((b) =>
          b.cases.filter((c) => c.when !== "default").map((c) => [(c.when as { intent: string }).intent, c] as const),
        ),
      );
    const nextStepIds = new Set(steps.map((s) => s.id));
    for (const b of replyBranches(previous)) {
      const counterpart = nextReplyBranches.find((nb) => nb.id === b.id);
      const scope = counterpart ? [counterpart] : nextReplyBranches;
      const nextCases = casesOf(scope);
      const nextHasDefault = scope.some((nb) => nb.cases.some((c) => c.when === "default"));
      for (const c of b.cases) {
        if (c.when === "default") {
          if (!nextHasDefault) {
            throw new GraphValidationError('The reply branch must keep its "default" case');
          }
          continue;
        }
        const intent = c.when.intent;
        const kept = nextCases.get(intent);
        if (!kept) {
          throw new GraphValidationError(
            `The reply branch lost its case for intent "${intent}" — reply-strategy coverage can't be removed by a sequence edit`,
          );
        }
        if ((c.pipeline ?? null) !== (kept.pipeline ?? null)) {
          throw new GraphValidationError(
            `The reply branch case for intent "${intent}" must keep "pipeline":${c.pipeline ? `"${c.pipeline}"` : "none"}`,
          );
        }
        const prevWasStep = previous.nodes.some((n) => n.id === c.goto && n.type === "step");
        if (prevWasStep && !nextStepIds.has(kept.goto)) {
          throw new GraphValidationError(
            `The reply branch case for intent "${intent}" must keep routing to a step (goto "${kept.goto}" is not a step)`,
          );
        }
      }
    }
  } else if (!graph.nodes.some((n) => n.type === "delay")) {
    throw new GraphValidationError("Graph must contain at least one delay node");
  }

  // New/changed case intents come from the ONE bounded taxonomy; intents the
  // stored version already carried stay legal (legacy labels never brick).
  const prevIntents = new Set(
    previous
      ? replyBranches(previous).flatMap((b) =>
          b.cases.filter((c) => c.when !== "default").map((c) => (c.when as { intent: string }).intent),
        )
      : [],
  );
  for (const b of replyBranches(graph)) {
    for (const c of b.cases) {
      if (c.when === "default") continue;
      if (prevIntents.has(c.when.intent)) continue;
      if (!IntentSchema.safeParse(c.when.intent).success) {
        throw new GraphValidationError(
          `Branch case intent "${c.when.intent}" is not a known intent — use only: ${IntentSchema.options.join(", ")}`,
        );
      }
    }
  }

  // The edited graph must still walk: at least one main-path step (an edit
  // can't orphan the whole sequence behind a branch).
  if (mainSteps(graph).length === 0) {
    throw new GraphValidationError("The main sequence needs at least one step");
  }

  return graph;
}
