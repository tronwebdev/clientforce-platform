"use client";

/**
 * Business core (SURFACE_SPEC_SETTINGS §5) — four tabs over one spine.
 *
 * What she knows · Gaps · Who you are · Where it comes from.
 *
 * The honest parts worth naming: a gap row says which live campaigns need it
 * and how she behaves without it, and NOT how many times it was asked — the
 * gap checker reports status, and nothing on this platform counts demand, so
 * a frequency line would be invented. A source shows the facts it produced,
 * and shows nothing while it is still reading rather than a zero.
 */
import { useState } from "react";
import {
  AddRow,
  EYEBROW,
  PrimaryButton,
  RowList,
  SettingsDrawer,
  type SettingsRow,
} from "../bold-settings-kit";
import type { WorkspaceContextField, WorkspaceSourceRow } from "../bold-settings-live";
import { removeSource, retrySource } from "../bold-settings-live";
import { BoldItemPage, EmptyTab, TabNote, type ItemHeader } from "./BoldItemPage";
import { AddFactDrawer, AddFieldDrawer, AddSourceDrawer, EditFactDrawer } from "./BoldCoreDrawers";
import type { GapUnionRow, SettingsSnapshot } from "./settings-data";

type Drawer =
  | { t: "fact" }
  | { t: "gap"; gap: GapUnionRow }
  | { t: "field" }
  | { t: "source" }
  | { t: "edit"; field: WorkspaceContextField }
  | { t: "sourceDetail"; source: WorkspaceSourceRow };

/** Identity keys — the "Who you are" tab's registry half. */
const IDENTITY_KEYS = new Set(["offer", "usp", "icp", "services", "company_address", "tone"]);

const TABS = ["What she knows", "Gaps", "Who you are", "Where it comes from"];
const ADD_LABEL = [
  "Add something she should know",
  "Answer a gap now",
  "Add a field",
  "Add a knowledge source",
];

function sourceLine(s: WorkspaceSourceRow): string {
  const kind =
    s.kind === "WEBSITE"
      ? "Read weekly"
      : s.kind === "DOCUMENT"
        ? "Uploaded by you"
        : "Typed by you";
  if (s.status === "FAILED") return `${kind} · could not be read`;
  if (s.status !== "READY") return `${kind} · reading it now`;
  // A yield of zero is a real, useful fact: it means nothing came out.
  const yielded =
    s.chunks === null
      ? ""
      : s.chunks === 0
        ? " · nothing usable found"
        : ` · ${s.chunks} facts found`;
  return `${kind}${yielded}`;
}

export function BoldCoreItem({
  data,
  reload,
  flash,
  onBack,
  onHeader,
}: {
  data: SettingsSnapshot;
  reload: () => Promise<void>;
  flash: (m: string) => void;
  onBack: () => void;
  onHeader: (h: ItemHeader | null) => void;
}) {
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);

  const fields = data.fields ?? [];
  const gaps = data.gaps ?? [];
  const sources = data.sources ?? [];
  const identity = fields.filter((f) => IDENTITY_KEYS.has(f.key));
  const touchedDays =
    data.touchedAt === null
      ? null
      : Math.floor((Date.now() - new Date(data.touchedAt).getTime()) / 86_400_000);

  async function done(toast: string) {
    setDrawer(null);
    flash(toast);
    await reload();
  }

  const stats = [
    {
      label: "FACTS SHE KNOWS",
      value: String(fields.length),
      sub: "all verified by you",
      tone: "forest" as const,
    },
    {
      label: "GAPS",
      value: String(gaps.length),
      sub: gaps.length === 0 ? "nothing missing" : "she will not invent them",
      tone: gaps.length === 0 ? ("forest" as const) : ("amber" as const),
    },
    {
      label: "LAST TOUCHED",
      value: touchedDays === null ? "—" : touchedDays === 0 ? "today" : `${touchedDays}d`,
      sub: data.touchedLabel ?? "the workspace layer",
      tone: "ink" as const,
    },
  ];

  /* The ✦ note is derived from THIS page's data — the biggest gap by campaign
     demand, or the source that produced nothing. A generic sentence here is a
     defect, so with nothing to observe it renders nothing. */
  const worstGap = [...gaps].sort((a, b) => b.campaigns.length - a.campaigns.length)[0];
  const emptySource = sources.find((s) => s.status === "READY" && s.chunks === 0);
  const failedSource = sources.find((s) => s.status === "FAILED");
  const ada: { note: string | null; actionLabel?: string; onAct?: () => void } = worstGap
    ? {
        note: `${worstGap.label} is missing, and ${worstGap.campaigns.length === 1 ? `${worstGap.campaigns[0]} needs it` : `${worstGap.campaigns.length} of your live campaigns need it`}. Until it is filled she deflects every time it comes up.`,
        actionLabel: "Answer it now",
        onAct: () => {
          setTab(1);
          setDrawer({ t: "gap", gap: worstGap });
        },
      }
    : failedSource
      ? {
          note: `I could not read ${failedSource.label}, so nothing from it reached her. Everything else on this page is unaffected.`,
          actionLabel: "Try it again",
          onAct: () => {
            void (async () => {
              const res = await retrySource(failedSource.id);
              flash(res.ok ? "Reading it again." : res.error);
              await reload();
            })();
          },
        }
      : emptySource
        ? {
            note: `${emptySource.label} read cleanly but produced no facts she can quote. It is probably a page of images, or a login wall.`,
            actionLabel: "Read it again",
            onAct: () => {
              void (async () => {
                const res = await retrySource(emptySource.id);
                flash(res.ok ? "Reading it again." : res.error);
                await reload();
              })();
            },
          }
        : { note: null };

  const factRows: SettingsRow[] = fields.map((f) => ({
    t: "chip",
    key: f.key,
    n: f.label,
    sub: f.value,
    chip: f.taught
      ? "You taught her"
      : f.source === "typed"
        ? "You told her"
        : f.source === "ai_decides"
          ? "Ada decides"
          : "Core",
    tone: f.taught || f.source === "typed" ? "live" : "mute",
    onOpen: () => setDrawer({ t: "edit", field: f }),
  }));

  const gapRows: SettingsRow[] = gaps.map((g) => ({
    t: "chip",
    key: g.key,
    n: g.label,
    // What is TRUE about a gap: who needs it, and what she does without it.
    sub:
      g.campaigns.length === 1
        ? `${g.campaigns[0]!} needs it — she deflects until you answer`
        : `${g.campaigns.length} live campaigns need it — she deflects until you answer`,
    chip: "Gap",
    tone: "warn",
    onOpen: () => setDrawer({ t: "gap", gap: g }),
  }));

  const identityRows: SettingsRow[] = identity.map((f) => ({
    t: "chip",
    key: f.key,
    n: f.label,
    sub: f.value,
    chip: "Core",
    tone: "live",
    onOpen: () => setDrawer({ t: "edit", field: f }),
  }));

  const sourceRows: SettingsRow[] = sources.map((s) => ({
    t: "chip",
    key: s.id,
    // Plum tile; the glyph is the DOCUMENT mark for a file, the disc for a
    // crawled site — Console Bold.dc.html:4743-4747 keys it off the extension.
    ic: /\.(pdf|docx?)$/i.test(s.label) ? "\u25EB" : "\u25CD",
    tint: "plum",
    n: s.label,
    sub: sourceLine(s),
    chip:
      s.status === "FAILED"
        ? "Could not read"
        : s.status !== "READY"
          ? "Reading"
          : s.kind === "WEBSITE"
            ? "Live"
            : "Core",
    tone:
      s.status === "FAILED"
        ? "danger"
        : s.status !== "READY"
          ? "cyan"
          : s.kind === "WEBSITE"
            ? "live"
            : "mute",
    onOpen: () => setDrawer({ t: "sourceDetail", source: s }),
  }));

  return (
    <>
      <BoldItemPage
        kind="WORKSPACE"
        title="Business core"
        status={
          gaps.length > 0
            ? { label: `${gaps.length} gap${gaps.length === 1 ? "" : "s"}`, tone: "warn" }
            : { label: "Nothing missing", tone: "live" }
        }
        stats={stats}
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        onBack={onBack}
        onHeader={onHeader}
        ada={ada}
        testid="bold-wss-core-item"
      >
        {tab === 0 ? (
          fields.length === 0 ? (
            <EmptyTab
              testid="bold-core-facts-none"
              line="She knows nothing yet. Teach her one thing below, or point her at your website and she reads it herself."
            />
          ) : (
            <RowList rows={factRows} testid="bold-core-facts" />
          )
        ) : null}

        {tab === 1 ? (
          gaps.length === 0 ? (
            <EmptyTab
              testid="bold-core-gaps-none"
              line="Nothing is missing for your live campaigns. A new campaign may ask for more — its gaps show up here."
            />
          ) : (
            <>
              <RowList rows={gapRows} testid="bold-core-gaps" />
              <TabNote>
                A GAP IS WHAT A LIVE CAMPAIGN ASKED FOR AND DID NOT FIND. HOW OFTEN CUSTOMERS ASK IT
                IS NOT COUNTED ANYWHERE YET, SO THIS PAGE DOES NOT CLAIM A NUMBER.
              </TabNote>
            </>
          )
        ) : null}

        {tab === 2 ? (
          <>
            {identity.length === 0 ? (
              <EmptyTab
                testid="bold-core-who-none"
                line="Who you are — what you sell, who you want — lands here as you answer it."
              />
            ) : (
              <RowList rows={identityRows} testid="bold-core-who" />
            )}
            {data.icpShape ? (
              <TabNote>
                YOUR LEAD FINDER SEARCHES AS{" "}
                {String(data.icpShape).replace(/_/g, " ").toUpperCase()}
                {data.icpVertical
                  ? ` · ${String(data.icpVertical).replace(/_/g, " ").toUpperCase()}`
                  : ""}{" "}
                — CHANGE THAT FROM THE LEAD FINDER&rsquo;S OWN BRIEF.
              </TabNote>
            ) : null}
          </>
        ) : null}

        {tab === 3 ? (
          sources.length === 0 ? (
            <EmptyTab
              testid="bold-core-sources-none"
              line="Nothing has been read yet. Everything she knows was typed by you — add your website and she starts reading it."
            />
          ) : (
            <RowList rows={sourceRows} testid="bold-core-sources" />
          )
        ) : null}

        <AddRow
          label={ADD_LABEL[tab]!}
          testid="bold-core-add"
          onClick={() =>
            setDrawer(
              tab === 1
                ? gaps.length > 0
                  ? { t: "gap", gap: gaps[0]! }
                  : { t: "fact" }
                : tab === 2
                  ? { t: "field" }
                  : tab === 3
                    ? { t: "source" }
                    : { t: "fact" },
            )
          }
        />
      </BoldItemPage>

      {drawer?.t === "fact" ? (
        <AddFactDrawer onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.t === "gap" ? (
        <AddFactDrawer gap={drawer.gap} onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.t === "field" ? (
        <AddFieldDrawer onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.t === "source" ? (
        <AddSourceDrawer onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.t === "edit" ? (
        <EditFactDrawer field={drawer.field} onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.t === "sourceDetail" ? (
        <SourceDrawer
          source={drawer.source}
          onClose={() => setDrawer(null)}
          onDone={done}
          flash={flash}
        />
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- source detail */

/**
 * The source drawer: what was read, when, how many facts came from it, re-read
 * now, remove. It renders from the row it was opened with — every field below
 * is one that row carries.
 */
function SourceDrawer({
  source,
  onClose,
  onDone,
  flash,
}: {
  source: WorkspaceSourceRow;
  onClose: () => void;
  onDone: (toast: string) => Promise<void>;
  flash: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const read = new Date(source.updatedAt);

  return (
    <SettingsDrawer
      label={source.kind === "WEBSITE" ? "WEBSITE SHE RE-READS" : "SOMETHING SHE READ"}
      title={source.label}
      onClose={onClose}
      testid="bold-drawer-sourcedetail"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <PrimaryButton
            label="Read it again"
            busy={busy}
            testid="bold-drawer-source-retry"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const res = await retrySource(source.id);
                setBusy(false);
                if (!res.ok) {
                  flash(res.error);
                  return;
                }
                await onDone("Reading it again — the count updates when it finishes.");
              })();
            }}
          />
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <DetailLine label="WHERE" value={source.uri ?? "Typed into this workspace"} />
        <DetailLine
          label="LAST READ"
          value={
            source.status === "READY"
              ? read.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : source.status === "FAILED"
                ? "The last attempt failed"
                : "Reading it now"
          }
        />
        <DetailLine
          label="FACTS FROM IT"
          value={
            source.chunks === null
              ? "Not known until it finishes"
              : source.chunks === 0
                ? "None — nothing usable came out"
                : String(source.chunks)
          }
        />
        <DetailLine
          label="CADENCE"
          value={source.kind === "WEBSITE" ? "Re-read weekly" : "Read once — replace it to update"}
        />
      </div>

      <div style={{ marginTop: 26, borderTop: "1px solid var(--cvb-line-inner)", paddingTop: 18 }}>
        {confirm ? (
          <>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--cvb-danger)",
                lineHeight: 1.55,
                marginBottom: 12,
              }}
            >
              Every fact that came from this source goes with it. She stops quoting them from the
              moment you remove it.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <PrimaryButton
                label="Remove it"
                tone="danger"
                busy={busy}
                testid="bold-drawer-source-remove-confirm"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const res = await removeSource(source.id);
                    setBusy(false);
                    if (!res.ok) {
                      flash(res.error);
                      return;
                    }
                    await onDone("Removed — and everything it taught her went with it.");
                  })();
                }}
              />
              <PrimaryButton label="Keep it" tone="quiet" onClick={() => setConfirm(false)} />
            </div>
          </>
        ) : (
          <span
            onClick={() => setConfirm(true)}
            role="button"
            data-testid="bold-drawer-source-remove"
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--cvb-danger)",
              cursor: "pointer",
            }}
          >
            Remove this source
          </span>
        )}
      </div>
    </SettingsDrawer>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ ...EYEBROW, fontSize: 9, letterSpacing: ".14em" }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 5 }}>{value}</div>
    </div>
  );
}
