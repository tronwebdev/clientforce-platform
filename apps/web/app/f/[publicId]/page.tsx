import { API_URL } from "../../../lib/config";
import { HostedForm, type HostedFormSpec } from "./HostedForm";

/**
 * B5 (DEC-130): the hosted form page — "we host it, you share the link."
 * PUBLIC by design (a form exists to be filled in by strangers): the server
 * component fetches the SERVER-owned spec from the api's public rail and the
 * client half submits back through the colocated public forward route. A
 * form that is not live renders the closed note, never a stack trace.
 */
export const dynamic = "force-dynamic";

export default async function HostedFormPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  let spec: HostedFormSpec | null = null;
  try {
    const res = await fetch(`${API_URL}/forms/v1/${encodeURIComponent(publicId)}`, {
      cache: "no-store",
    });
    if (res.ok) spec = (await res.json()) as HostedFormSpec;
  } catch {
    spec = null;
  }
  return (
    <main style={{ minHeight: "100vh", background: "#F4F6F4", display: "grid", placeItems: "start center", padding: "48px 16px", fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
      {spec ? (
        <HostedForm publicId={publicId} spec={spec} />
      ) : (
        <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #ECEDEC", borderRadius: 20, padding: "28px 26px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>This form isn&rsquo;t taking responses right now.</div>
          <div style={{ fontSize: 12.5, color: "#8B968F", marginTop: 8 }}>If somebody sent you this link, let them know it&rsquo;s closed.</div>
        </div>
      )}
    </main>
  );
}
