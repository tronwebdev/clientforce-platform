"use client";

import { EmptyState } from "@clientforce/ui";

/** §0: designed error state with retry. */
export default function AgentsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="cf-content" style={{ paddingTop: 24 }}>
      <EmptyState
        icon="⚠"
        title="Couldn't load agents"
        body="Something went wrong talking to the API. Your data is safe — try again."
        actions={
          <button type="button" className="cf-button cf-button--secondary" onClick={() => reset()}>
            Retry
          </button>
        }
      />
    </div>
  );
}
