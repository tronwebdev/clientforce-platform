"use client";

/**
 * Business core's four add/edit drawers (SURFACE_SPEC_SETTINGS §5).
 *
 * Every one of them is the SAME right-hand drawer with different steps — the
 * unit's first rule, made structural: there is no inline form in this file and
 * nowhere to put one.
 *
 * Each drawer resolves its own data from what it was handed. The edit drawer
 * takes a full field row rather than an id-plus-hope, because a drawer that
 * reads a field its row never carried is how a sibling surface threw a
 * TypeError on three fields at once.
 */
import { useState } from "react";
import {
  ChoiceRow,
  DrawerError,
  PrimaryButton,
  SettingsDrawer,
  StepDots,
  StepPrompt,
  Well,
} from "../bold-settings-kit";
import {
  addTypedSource,
  addWebsiteSource,
  addCoreField,
  editFact,
  forgetFact,
  teachFact,
  type WorkspaceContextField,
} from "../bold-settings-live";
import type { GapUnionRow } from "./settings-data";

interface Done {
  onDone: (toast: string) => Promise<void>;
  onClose: () => void;
}

/* ------------------------------------------------------------- add a fact */

/**
 * "Add something she should know" and "Answer a gap now" are the same two
 * steps; a gap arrives with its question already known and its registry key
 * carried through, so answering CLOSES that gap instead of creating a
 * near-duplicate beside it.
 */
export function AddFactDrawer({ gap, onDone, onClose }: Done & { gap?: GapUnionRow | null }) {
  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState(gap?.label ?? "");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answeringGap = Boolean(gap);

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await teachFact({
      question: question.trim(),
      answer: answer.trim(),
      ...(gap ? { gapKey: gap.key } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone("She knows it now.");
  }

  return (
    <SettingsDrawer
      label={answeringGap ? "ANSWER A GAP" : "TEACH HER SOMETHING"}
      title={answeringGap ? "Fill the gap" : "Add something she should know"}
      onClose={onClose}
      testid="bold-drawer-fact"
      footer={
        <>
          {step === 1 ? (
            <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(0)} />
          ) : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={2} />
          {step === 0 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-fact-next"
              onClick={() => question.trim().length >= 2 && setStep(1)}
            />
          ) : (
            <PrimaryButton
              label="Teach her"
              busy={busy}
              testid="bold-drawer-fact-finish"
              onClick={() => void finish()}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt
            prompt="What is the question people ask?"
            help={
              answeringGap
                ? `Your live campaigns keep needing this one${gap!.campaigns.length ? ` — ${gap!.campaigns.join(", ")}` : ""}.`
                : "Write it the way a customer would ask it. She matches on meaning, not wording."
            }
          />
          <Well
            label="THE QUESTION"
            value={question}
            onChange={setQuestion}
            placeholder="Do you take my insurance?"
            testid="bold-drawer-fact-question"
            autoFocus
            onEnter={() => question.trim().length >= 2 && setStep(1)}
          />
        </>
      ) : (
        <>
          <StepPrompt
            prompt="And what should she answer? Say it the way you would say it."
            help="She quotes this as written and never guesses around it."
          />
          <Well
            label="THE ANSWER"
            value={answer}
            onChange={setAnswer}
            placeholder="Delta, Cigna and Aetna — we are in network with all three."
            multiline
            testid="bold-drawer-fact-answer"
            autoFocus
          />
          <DrawerError message={error} />
        </>
      )}
    </SettingsDrawer>
  );
}

/* ------------------------------------------------------------ add a field */

/** "Add a field" — a named thing she quotes exactly (§5, add-field drawer). */
export function AddFieldDrawer({ onDone, onClose }: Done) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await addCoreField({ name: name.trim(), value: value.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone(`${name.trim()} saved.`);
  }

  return (
    <SettingsDrawer
      label="NEW FIELD"
      title="Add a field"
      onClose={onClose}
      testid="bold-drawer-field"
      footer={
        <>
          {step === 1 ? (
            <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(0)} />
          ) : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={2} />
          {step === 0 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-field-next"
              onClick={() => name.trim().length >= 2 && setStep(1)}
            />
          ) : (
            <PrimaryButton
              label="Save the field"
              busy={busy}
              testid="bold-drawer-field-finish"
              onClick={() => void finish()}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt prompt="Name the thing. She quotes it exactly as you write it, and never guesses around it." />
          <Well
            label="THE FIELD"
            value={name}
            onChange={setName}
            placeholder="Parking"
            testid="bold-drawer-field-name"
            autoFocus
            onEnter={() => name.trim().length >= 2 && setStep(1)}
          />
        </>
      ) : (
        <>
          <StepPrompt prompt="What goes in it?" />
          <Well
            label="THE VALUE"
            value={value}
            onChange={setValue}
            placeholder="Free lot behind the building, entrance on 5th."
            multiline
            testid="bold-drawer-field-value"
            autoFocus
          />
          <DrawerError message={error} />
        </>
      )}
    </SettingsDrawer>
  );
}

/* -------------------------------------------------------------- edit fact */

/**
 * Editing a row. It receives the WHOLE row it was opened from, so it renders
 * from fields that row definitely carries; a registry field keeps its label
 * (the business core owns that word) and only its value is editable.
 */
export function EditFactDrawer({
  field,
  onDone,
  onClose,
}: Done & { field: WorkspaceContextField }) {
  const [question, setQuestion] = useState(field.label);
  const [answer, setAnswer] = useState(field.value);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await editFact({
      key: field.key,
      ...(field.taught ? { question: question.trim() } : {}),
      answer: answer.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone("Updated — she uses the new wording from now on.");
  }

  async function forget() {
    setBusy(true);
    setError(null);
    const res = await forgetFact(field.key);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone("Forgotten — she will stop quoting it.");
  }

  return (
    <SettingsDrawer
      label={field.taught ? "SOMETHING YOU TAUGHT HER" : "FROM YOUR BUSINESS CORE"}
      title={field.label}
      onClose={onClose}
      testid="bold-drawer-editfact"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <PrimaryButton
            label="Save"
            busy={busy}
            testid="bold-drawer-editfact-save"
            onClick={() => void save()}
          />
        </>
      }
    >
      {field.taught ? (
        <div style={{ marginBottom: 16 }}>
          <Well
            label="THE QUESTION"
            value={question}
            onChange={setQuestion}
            testid="bold-drawer-editfact-question"
          />
        </div>
      ) : (
        <div
          style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginBottom: 16 }}
        >
          This one is part of your business core, so its name is fixed. You can change what she
          says.
        </div>
      )}
      <Well
        label="WHAT SHE SAYS"
        value={answer}
        onChange={setAnswer}
        multiline
        testid="bold-drawer-editfact-answer"
      />

      {field.taught ? (
        <div
          style={{ marginTop: 26, borderTop: "1px solid var(--cvb-line-inner)", paddingTop: 18 }}
        >
          {confirmForget ? (
            <>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--cvb-danger)",
                  lineHeight: 1.55,
                  marginBottom: 12,
                }}
              >
                She stops quoting this immediately. Anyone who asks it goes back to your front desk.
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <PrimaryButton
                  label="Forget it"
                  tone="danger"
                  busy={busy}
                  testid="bold-drawer-editfact-forget-confirm"
                  onClick={() => void forget()}
                />
                <PrimaryButton
                  label="Keep it"
                  tone="quiet"
                  onClick={() => setConfirmForget(false)}
                />
              </div>
            </>
          ) : (
            <span
              onClick={() => setConfirmForget(true)}
              role="button"
              data-testid="bold-drawer-editfact-forget"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--cvb-danger)",
                cursor: "pointer",
              }}
            >
              Make her forget this
            </span>
          )}
        </div>
      ) : null}
      <DrawerError message={error} />
    </SettingsDrawer>
  );
}

/* ------------------------------------------------------------- add source */

/** "Add a knowledge source" — a choice step, then the address or the text. */
export function AddSourceDrawer({ onDone, onClose }: Done) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"website" | "document" | "typed">("website");
  const [uri, setUri] = useState("");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const res =
      kind === "website"
        ? await addWebsiteSource(uri.trim(), label.trim() || undefined)
        : await addTypedSource(label.trim() || "Typed by you", text.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone(
      kind === "website"
        ? "Reading started — it lands on the sources tab as it goes."
        : "Saved — she is reading it now.",
    );
  }

  const canFinish = kind === "website" ? uri.trim().length > 3 : text.trim().length > 0;

  return (
    <SettingsDrawer
      label="NEW KNOWLEDGE SOURCE"
      title="Add a knowledge source"
      onClose={onClose}
      testid="bold-drawer-source"
      footer={
        <>
          {step === 1 ? (
            <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(0)} />
          ) : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={2} />
          {step === 0 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-source-next"
              onClick={() => setStep(1)}
            />
          ) : (
            <PrimaryButton
              label="Start reading it"
              busy={busy}
              testid="bold-drawer-source-finish"
              onClick={() => canFinish && void finish()}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt prompt="Where should she read from?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <ChoiceRow
              title="A website"
              sub="She re-reads it weekly, so changes on your site reach her without you doing anything."
              selected={kind === "website"}
              onSelect={() => setKind("website")}
              testid="bold-drawer-source-website"
            />
            <ChoiceRow
              title="A document"
              sub="A PDF, Word file or deck. She reads it once — replace the file when it changes."
              selected={kind === "document"}
              onSelect={() => setKind("document")}
              testid="bold-drawer-source-document"
            />
            <ChoiceRow
              title="Typed by you"
              sub="Paste it in. Best for the things that live in your head rather than on a page."
              selected={kind === "typed"}
              onSelect={() => setKind("typed")}
              testid="bold-drawer-source-typed"
            />
          </div>
        </>
      ) : kind === "website" ? (
        <>
          <StepPrompt
            prompt="Which address?"
            help="I re-read a website weekly; a file only when you replace it."
          />
          <Well
            label="THE ADDRESS"
            value={uri}
            onChange={setUri}
            placeholder="https://brightsmile.com/pricing"
            testid="bold-drawer-source-uri"
            autoFocus
          />
          <div style={{ marginTop: 14 }}>
            <Well
              label="CALL IT (OPTIONAL)"
              value={label}
              onChange={setLabel}
              placeholder="Pricing page"
              testid="bold-drawer-source-label"
            />
          </div>
          <DrawerError message={error} />
        </>
      ) : kind === "document" ? (
        <>
          <StepPrompt
            prompt="Uploading a file happens from a campaign's knowledge step."
            help="Documents go through the upload path so the file itself is stored and re-readable. Type the same content here instead and she has it immediately."
          />
          <div style={{ marginTop: 14 }}>
            <Well
              label="CALL IT"
              value={label}
              onChange={setLabel}
              placeholder="Price list 2026"
              testid="bold-drawer-source-doc-label"
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <Well
              label="WHAT IT SAYS"
              value={text}
              onChange={setText}
              placeholder="Paste the part she needs…"
              multiline
              testid="bold-drawer-source-doc-text"
            />
          </div>
          <DrawerError message={error} />
        </>
      ) : (
        <>
          <StepPrompt
            prompt="Type what she should know."
            help="She reads this once — edit the source to change it."
          />
          <div>
            <Well
              label="CALL IT"
              value={label}
              onChange={setLabel}
              placeholder="Consult script"
              testid="bold-drawer-source-typed-label"
              autoFocus
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <Well
              label="WHAT IT SAYS"
              value={text}
              onChange={setText}
              placeholder="We answer the phone within three rings…"
              multiline
              testid="bold-drawer-source-typed-text"
            />
          </div>
          <DrawerError message={error} />
        </>
      )}
    </SettingsDrawer>
  );
}
