"use client";

/**
 * B5 (DEC-130): the hosted form's client half — renders the server-owned
 * spec, posts through the colocated public forward route, and follows the
 * routing verdict (redirect or the inline thank-you).
 */
import { useState } from "react";
import { formPlaceholder } from "../../../lib/form-placeholders";

export interface HostedFormSpec {
  title: string;
  intro: string | null;
  submitLabel: string;
  fields: Array<{
    key: string;
    label: string;
    type: "text" | "phone" | "email" | "choice" | "longtext";
    required: boolean;
    options?: string[];
  }>;
}

export function HostedForm({ publicId, spec }: { publicId: string; spec: HostedFormSpec }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/f/${encodeURIComponent(publicId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirectUrl?: string | null; message?: string }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.message ?? "That didn't go through — check the starred fields.");
        setState("error");
        return;
      }
      if (body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }
      setState("done");
    } catch {
      setError("The connection dropped — try again.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div style={{ maxWidth: 440, width: "100%", background: "#fff", border: "1px solid #ECEDEC", borderRadius: 20, padding: "28px 26px", textAlign: "center" }} data-testid="hosted-form-done">
        <div style={{ fontWeight: 900, fontSize: 19 }}>Got it — thank you.</div>
        <div style={{ fontSize: 12.5, color: "#8B968F", marginTop: 8 }}>Your details are in; somebody picks this up from here.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, width: "100%", background: "#fff", border: "1px solid #ECEDEC", borderRadius: 22, overflow: "hidden" }} data-testid="hosted-form">
      <div style={{ height: 3, background: "linear-gradient(90deg,#36D7ED,#35E834 55%,#D0F56B)" }} />
      <div style={{ padding: "24px 26px 26px" }}>
        <h1 style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.03em", margin: 0 }}>{spec.title}</h1>
        {spec.intro ? <p style={{ fontSize: 13, color: "#5A6660", lineHeight: 1.5, margin: "8px 0 0" }}>{spec.intro}</p> : null}
        {spec.fields.map((f) => (
          <label key={f.key} style={{ display: "block", marginTop: 15 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              {f.label}
              {f.required ? <span style={{ color: "#146B33" }}> *</span> : null}
            </span>
            {f.type === "choice" ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                {(f.options ?? []).map((o) => (
                  <span
                    key={o}
                    onClick={() => setAnswers((a) => ({ ...a, [f.key]: o }))}
                    style={{ fontSize: 12, border: `1px solid ${answers[f.key] === o ? "#146B33" : "#E4E6E5"}`, background: answers[f.key] === o ? "#EAF5EE" : "#FCFCFC", color: answers[f.key] === o ? "#146B33" : "#5A6660", fontWeight: 600, borderRadius: 999, padding: "7px 13px", cursor: "pointer" }}
                  >
                    {o}
                  </span>
                ))}
              </div>
            ) : f.type === "longtext" ? (
              <textarea
                rows={3}
                value={answers[f.key] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                placeholder={formPlaceholder(f)}
                style={{ width: "100%", marginTop: 7, fontSize: 13, border: "1px solid #E4E6E5", borderRadius: 11, padding: "10px 12px", resize: "vertical", fontFamily: "inherit" }}
              />
            ) : (
              <input
                type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                value={answers[f.key] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                placeholder={formPlaceholder(f)}
                style={{ width: "100%", marginTop: 7, fontSize: 13, border: "1px solid #E4E6E5", borderRadius: 11, padding: "10px 12px", fontFamily: "inherit" }}
              />
            )}
          </label>
        ))}
        {error ? <div style={{ fontSize: 12, color: "#B0483A", marginTop: 12 }}>{error}</div> : null}
        <button
          onClick={() => void submit()}
          data-testid="hosted-form-submit"
          style={{ width: "100%", marginTop: 18, fontSize: 13.5, fontWeight: 800, color: "#fff", background: "#146B33", border: "none", borderRadius: 12, padding: "13px 0", cursor: "pointer", opacity: state === "sending" ? 0.7 : 1, fontFamily: "inherit" }}
        >
          {state === "sending" ? "Sending…" : spec.submitLabel}
        </button>
      </div>
    </div>
  );
}
