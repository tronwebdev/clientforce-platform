"use client";

/**
 * B5 (DEC-130): the Forms surface on the REAL form spine — grid + detail per
 * the prototype's vCards anatomy, every number a query. Honest departures,
 * each flagged in the ledger/scope note:
 *  - card kind eyebrows state the field count (the prototype's BOOKING/
 *    ENQUIRY kinds are fixture flavour with no stored home);
 *  - the meta strip's booked/drop-off stats have no attribution spine yet —
 *    they say so instead of inventing numbers;
 *  - Share = the REAL hosted page link; the inline-script embed arrives with
 *    the bundle publish step (Q-093's family).
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchFormDetail,
  fetchForms,
  patchForm,
  type BoldFormField,
  type BoldFormRow,
  type BoldFormSubmissionRow,
} from "./bold-live";
import type { BoldDrawerState } from "./BoldDrawer";
import { BoldCardGrid, BoldCoverCard, BoldMetaStrip, BoldSegRow, mono } from "./bold-cards";

const TABS = ["Preview", "Responses", "Fields", "Where it goes", "Share"] as const;

export function BoldFormsView({
  onOpenDrawer,
  onBuild,
  onCounts,
  flash,
}: {
  onOpenDrawer: (d: BoldDrawerState) => void;
  onBuild: () => void;
  onCounts: (forms: number, responses: number) => void;
  flash: (msg: string) => void;
}) {
  const [forms, setForms] = useState<BoldFormRow[] | null>(null);
  const [seg, setSeg] = useState("Live");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Preview");
  const [detail, setDetail] = useState<{
    form: BoldFormRow;
    responses: number;
    submissions: BoldFormSubmissionRow[];
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetchForms();
    if (res) {
      setForms(res.forms);
      onCounts(res.forms.length, res.forms.reduce((n, f) => n + (f.responses ?? 0), 0));
    }
  }, [onCounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const openForm = useCallback(async (id: string) => {
    setOpenId(id);
    setTab("Preview");
    const d = await fetchFormDetail(id);
    if (d) setDetail(d);
  }, []);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, note: string) => {
      const res = await patchForm(id, body);
      if (!res.ok) {
        flash(res.error);
        return;
      }
      flash(note);
      const d = await fetchFormDetail(id);
      if (d) setDetail(d);
      void load();
    },
    [flash, load],
  );

  /* ---------------------------------------------------------------- grid */
  if (!openId || !detail) {
    const rows = (forms ?? []).filter((f) => (seg === "Live" ? f.status === "live" : true));
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-forms">
        <BoldSegRow
          segments={["Live", "All"]}
          active={seg}
          onPick={setSeg}
          cta="Ask Ada to build"
          onCta={onBuild}
          ctaTestId="bold-forms-build"
        />
        {forms && forms.length === 0 ? (
          <div style={{ marginTop: 26, border: "1px dashed var(--cvb-line-ctl)", borderRadius: 18, padding: 26, textAlign: "center", color: "var(--cvb-faint)", fontSize: 12.5 }}>
            No forms yet — build the first one and it goes live on a hosted page.
          </div>
        ) : (
          <BoldCardGrid>
            {rows.map((f, i) => (
              <BoldCoverCard
                key={f.id}
                index={i}
                kind={`${f.fields.length} FIELDS`}
                title={f.title}
                live={f.status === "live"}
                pillTone={f.status === "live" ? "live" : "draft"}
                pillText={f.status === "live" ? `${f.responses ?? 0} responses` : "Not published"}
                value={f.status === "live" ? String(f.responses ?? 0) : "—"}
                who={f.publicId ? `/f/${f.publicId}` : "Draft — not published"}
                onOpen={() => void openForm(f.id)}
                testId={`bold-form-card-${i}`}
              />
            ))}
          </BoldCardGrid>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------- detail */
  const { form, responses, submissions } = detail;
  const back = () => {
    setOpenId(null);
    setDetail(null);
    void load();
  };
  return (
    <div data-testid="bold-form-detail">
      <BoldMetaStrip
        items={[
          ["RESPONSES", String(responses), form.status === "live" ? "and counting" : "while it was live"],
          ["BOOKED FROM IT", "—", "attribution arrives with reporting"],
          ["DROP-OFF", "—", "field analytics arrive with reporting"],
        ]}
      />
      <div style={{ display: "flex", gap: 18, padding: "14px 40px 0", borderBottom: "1px solid var(--cvb-line-inner)", alignItems: "center" }}>
        <span onClick={back} data-testid="bold-form-back" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)" }}>
          ← All forms
        </span>
        {TABS.map((t) => (
          <span
            key={t}
            onClick={() => setTab(t)}
            style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "6px 2px 12px", color: tab === t ? "var(--cvb-ink,#101613)" : "var(--cvb-faint)", borderBottom: tab === t ? "2px solid var(--cvb-forest)" : "2px solid transparent" }}
          >
            {t}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span
          onClick={() =>
            void patch(
              form.id,
              { status: form.status === "live" ? "draft" : "live" },
              form.status === "live" ? "Taken down — the page now says it is closed." : "Live — the hosted page is up.",
            )
          }
          data-testid="bold-form-publish"
          style={{ fontSize: 12, fontWeight: 800, color: form.status === "live" ? "var(--cvb-faint)" : "#fff", background: form.status === "live" ? "var(--cvb-panel)" : "var(--cvb-forest)", border: form.status === "live" ? "1px solid var(--cvb-line-ctl)" : "1px solid var(--cvb-forest)", borderRadius: 11, padding: "8px 14px", cursor: "pointer", marginBottom: 6 }}
        >
          {form.status === "live" ? "Take it down" : "Publish"}
        </span>
      </div>

      <div style={{ padding: "22px 40px 40px" }}>
        {tab === "Preview" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,440px) 1fr", gap: 26 }}>
            <div style={{ border: "1px solid var(--cvb-line)", borderRadius: 22, overflow: "hidden", background: "var(--cvb-card)" }}>
              <div style={{ height: 3, background: "var(--cvb-gradient-signature, linear-gradient(90deg,#36D7ED,#35E834 55%,#D0F56B))" }} />
              <div style={{ padding: "22px 24px" }}>
                <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.03em" }}>{form.title}</div>
                {form.design.intro ? <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", marginTop: 6, lineHeight: 1.5 }}>{form.design.intro}</div> : null}
                {form.fields.map((f) => (
                  <div key={f.key} style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                      {f.label}
                      {f.required ? <span style={{ color: "var(--cvb-forest)" }}> *</span> : null}
                    </div>
                    {f.type === "choice" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {(f.options ?? []).map((o) => (
                          <span key={o} style={{ fontSize: 11, border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "5px 11px", color: "var(--cvb-faint)" }}>{o}</span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ height: f.type === "longtext" ? 64 : 40, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-inner)", borderRadius: 10, marginTop: 6 }} />
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 18, textAlign: "center", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "12px 0" }}>
                  {form.design.submitLabel ?? "Send"}
                </div>
              </div>
            </div>
            <div>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>WHAT THEY SEE</div>
              <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 10, maxWidth: 380 }}>
                {form.status === "live" && form.publicId
                  ? "This is the live form on its hosted page. Required fields carry a star — change which ones in the Fields tab."
                  : "This is the draft. Publish it and the hosted page goes up at its own address."}
              </div>
              {form.status === "live" && form.publicId ? (
                <a href={`/f/${form.publicId}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 14, fontSize: 12, fontWeight: 700, color: "var(--cvb-forest)", border: "1px solid var(--cvb-mint-line)", borderRadius: 11, padding: "8px 13px", textDecoration: "none" }}>
                  Open the real page
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "Responses" ? (
          <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 16, overflow: "hidden" }} data-testid="bold-form-responses">
            {submissions.length === 0 ? (
              <div style={{ padding: 22, fontSize: 12.5, color: "var(--cvb-faint)" }}>Nothing yet — responses land here the moment one arrives.</div>
            ) : (
              submissions.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() =>
                    s.contactId &&
                    onOpenDrawer({
                      t: "person",
                      contact: {
                        id: s.contactId,
                        firstName: s.contactName?.split(" ")[0] ?? null,
                        lastName: s.contactName?.split(" ").slice(1).join(" ") || null,
                        email: null,
                      },
                    })
                  }
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 16px", borderBottom: i === submissions.length - 1 ? "none" : "1px solid var(--cvb-line-inner)", cursor: s.contactId ? "pointer" : "default" }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700, color: "var(--cvb-forest)", flex: "none" }}>
                    {(s.contactName ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{s.contactName ?? "Someone"}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {Object.values(s.answers).filter(Boolean).slice(0, 3).join(" · ")}
                    </div>
                  </div>
                  <span style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", flex: "none" }}>
                    {new Date(s.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "Fields" ? (
          <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 16, overflow: "hidden", maxWidth: 640 }}>
            {form.fields.map((f, i) => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderBottom: i === form.fields.length - 1 ? "none" : "1px solid var(--cvb-line-inner)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "var(--cvb-ghost)", marginTop: 2 }}>
                    {f.type === "choice" ? `Choice · ${(f.options ?? []).length} options` : `${f.type === "longtext" ? "Long text" : f.type[0]!.toUpperCase() + f.type.slice(1)} · ${f.required ? "required" : "optional"}`}
                  </div>
                </div>
                <span
                  onClick={() => {
                    const fields: BoldFormField[] = form.fields.map((x) => (x.key === f.key ? { ...x, required: !x.required } : x));
                    void patch(form.id, { fields }, f.required ? `${f.label} — optional` : `${f.label} — required`);
                  }}
                  data-testid={`bold-form-field-${f.key}`}
                  role="switch"
                  aria-checked={f.required}
                  style={{ width: 42, height: 24, borderRadius: 13, flex: "none", background: f.required ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: "pointer" }}
                >
                  <span style={{ position: "absolute", top: 3, left: f.required ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.2)", transition: "left .15s ease" }} />
                </span>
              </div>
            ))}
            <div style={{ padding: "11px 15px", fontSize: 11.5, color: "var(--cvb-ghost)", borderTop: "1px solid var(--cvb-line-inner)" }}>
              The toggle is required-or-not. Adding and re-ordering fields arrives with the field editor.
            </div>
          </div>
        ) : null}

        {tab === "Where it goes" ? (
          <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 16, overflow: "hidden", maxWidth: 640 }} data-testid="bold-form-routing">
            <RouteRow label="New contacts land in" value={form.routing.campaignId ? "The routed campaign — enrolled on submit" : "No campaign — just a contact"} chip={form.routing.campaignId ? "Campaign" : "None"} />
            <RouteRow label="Tagged" value={form.routing.tag ? `“${form.routing.tag}” on every contact this form writes` : "No tag"} chip={form.routing.tag ? "Live" : "None"} />
            <RouteRow label="After submit, show" value={form.routing.redirectUrl ?? "The built-in thank-you note"} chip={form.routing.redirectUrl ? "Redirect" : "Default"} />
            <div style={{ padding: "12px 15px", fontSize: 11.5, color: "var(--cvb-ghost)", lineHeight: 1.55 }}>
              Everything else a submission should cause — Slack, calendar writes, webhooks — rides
              Automations: every submit fires the “a lead is captured” trigger, so build the rule
              there and it applies to this form too.
            </div>
          </div>
        ) : null}

        {tab === "Share" ? (
          <div style={{ maxWidth: 640 }} data-testid="bold-form-share">
            {form.status === "live" && form.publicId ? (
              <>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>THE HOSTED PAGE</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                  <code style={{ flex: 1, fontSize: 12.5, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 11, padding: "11px 13px" }}>{`${typeof window !== "undefined" ? window.location.origin : ""}/f/${form.publicId}`}</code>
                  <span
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${window.location.origin}/f/${form.publicId}`);
                      flash("Link copied");
                    }}
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-forest)", border: "1px solid var(--cvb-mint-line)", borderRadius: 11, padding: "9px 13px", cursor: "pointer" }}
                  >
                    Copy
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 12, lineHeight: 1.55 }}>
                  We host it, you share the link. The drop-it-in-your-page script embed arrives with
                  the embed publish step — the hosted page is the live door today.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>Publish the form first — the hosted page and its link appear here.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RouteRow({ label, value, chip }: { label: string; value: string; chip: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 2 }}>{value}</div>
      </div>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 8px" }}>{chip}</span>
    </div>
  );
}
