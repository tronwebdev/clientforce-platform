import { Skeleton } from "@clientforce/ui";

/** §0: loading = skeleton rows, never a spinner. */
export default function AgentsLoading() {
  return (
    <div className="cf-content" style={{ paddingTop: 24 }}>
      <Skeleton height={34} width={220} style={{ marginBottom: 10 }} />
      <Skeleton height={16} width={340} style={{ marginBottom: 24 }} />
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, padding: 8 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} height={52} style={{ margin: 8 }} />
        ))}
      </div>
    </div>
  );
}
