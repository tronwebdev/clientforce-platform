import type { FleetHealthView, VersionPins } from "@clientforce/core";
import { fetchFleetHealth, fetchVersionPins } from "../../../../lib/backoffice";

/**
 * Fleet health (FR-ADMIN-04/06), read-only. Sender-health scores are CONSUMED
 * from P5-W1's endpoint — when it isn't wired the panel says "pending P5-W1"
 * rather than inventing a second computation. Abuse/deliverability outliers ARE
 * a backoffice concern (bounce/spam/SMS-failure counts from the event ledger).
 * Model/prompt version pins are platform-scope visibility, never editable here.
 */
export default async function FleetPage() {
  const [health, pins] = await Promise.all([fetchFleetHealth(), fetchVersionPins()]);

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Fleet health
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 22px", maxWidth: 720 }}>
        Sender health is consumed from the deliverability service (P5-W1); the backoffice never recomputes
        it. Outliers and version pins are read-only.
      </p>

      <SenderHealth health={health} />
      <Outliers health={health} />
      <Pins pins={pins} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>{title}</h2>
      <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

function SenderHealth({ health }: { health: FleetHealthView | null }) {
  if (!health) {
    return (
      <Card title="Sender health">
        <div style={{ padding: 20, color: "#8a938d", fontSize: 13 }}>Unavailable.</div>
      </Card>
    );
  }
  if (!health.health.wired) {
    return (
      <Card title="Sender health">
        <div style={{ padding: "16px 20px", fontSize: 13, color: "#5b6560", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: "#c9a13f", flexShrink: 0 }} />
          <span>
            <strong style={{ color: "#0e1512" }}>Sender health temporarily unavailable.</strong> The ledger
            read failed this pass — scores come from P5-W1&rsquo;s shared computation, never recomputed here.
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Sender health">
      {health.health.scores.length === 0 ? (
        <div style={{ padding: 20, color: "#8a938d", fontSize: 13 }}>No senders reported.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
              <Th>Sender</Th>
              <Th>Workspace</Th>
              <Th>Score</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {health.health.scores.map((s) => (
              <tr key={s.senderId} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                <Td mono>{s.senderId}</Td>
                <Td mono>{s.workspaceId}</Td>
                <Td>{s.score ?? "—"}</Td>
                <Td>{s.status}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Outliers({ health }: { health: FleetHealthView | null }) {
  const outliers = health?.outliers ?? [];
  return (
    <Card title="Abuse & deliverability outliers">
      {health?.lowData ? (
        <div style={{ padding: "10px 20px", fontSize: 12, color: "#8a6d3b", borderBottom: "1px solid var(--cf-color-hairline, #ebe3d6)", background: "rgba(208,245,107,0.2)" }}>
          Low data — too few signals in the last 7 days to read into these numbers.
        </div>
      ) : null}
      {outliers.length === 0 ? (
        <div style={{ padding: 20, color: "#8a938d", fontSize: 13 }}>
          No workspaces over the bounce/spam/failure threshold in the last 7 days.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
              <Th>Agency</Th>
              <Th>Workspace</Th>
              <Th>Signal</Th>
              <Th>Count (7d)</Th>
            </tr>
          </thead>
          <tbody>
            {outliers.map((o, i) => (
              <tr key={`${o.workspaceId}-${o.metric}-${i}`} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                <Td mono>{o.agencyId}</Td>
                <Td mono>{o.workspaceId}</Td>
                <Td>{o.metric}</Td>
                <Td><strong>{o.count.toLocaleString()}</strong></Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Pins({ pins }: { pins: VersionPins | null }) {
  if (!pins) {
    return (
      <Card title="Model & prompt pins">
        <div style={{ padding: 20, color: "#8a938d", fontSize: 13 }}>Unavailable.</div>
      </Card>
    );
  }
  return (
    <Card title="Model & prompt pins">
      <div style={{ padding: "12px 20px", fontSize: 12, color: "#5b6560", borderBottom: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
        Platform-scope, read-only. Model routing is env-overridable per deploy; prompt versions are code-pinned.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ padding: "14px 20px", borderRight: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#8a938d", fontWeight: 700, marginBottom: 8 }}>Models</div>
          {pins.models.map((m) => (
            <div key={m.task} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
              <span style={{ color: "#5b6560", textTransform: "capitalize" }}>{m.task}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{m.model}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderTop: "1px dashed var(--cf-color-hairline, #ebe3d6)", marginTop: 4 }}>
            <span style={{ color: "#5b6560" }}>embedding</span>
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>{pins.embeddingModel}</span>
          </div>
        </div>
        <div style={{ padding: "14px 20px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#8a938d", fontWeight: 700, marginBottom: 8 }}>Prompts</div>
          {pins.prompts.map((p) => (
            <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#5b6560" }}>{p.name}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>v{p.version}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "9px 16px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{ padding: "9px 16px", ...(mono ? { fontFamily: "monospace", fontSize: 12 } : {}) }}>{children}</td>
  );
}
