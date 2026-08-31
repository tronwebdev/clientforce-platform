"use client";

/**
 * Settings & Business core — one surface, six doors (SURFACE_SPEC_SETTINGS).
 *
 * B7 shipped the read layer of this family: the layout landed, most of the
 * ACTIONS did not. This is the write layer. A user can now teach Ada a fact,
 * answer a gap, add a knowledge source, add an email sender or ask for a
 * number, invite a colleague and change what they may do, move a guardrail,
 * and see where their credits went.
 *
 * Two rules decide every hard call in this family, and they are worth stating
 * where the router for it lives:
 *
 *  1. **Every add and every edit opens the right-hand drawer.** No inline
 *     forms, no modals — including the credits buy flow, whose prototype is a
 *     centred modal. The rule is the newer decision and it wins.
 *  2. **A number without a source is absent with a stated reason.** Not zero,
 *     not a placeholder, not a plausible-looking estimate.
 *
 * All six doors read ONE snapshot, so the hub's counts and the page inside can
 * never disagree.
 */
import { useCallback, useState } from "react";
import { BoldSettingsHub, type HubTarget } from "./settings/BoldSettingsHub";
import { BoldCoreItem } from "./settings/BoldCoreItem";
import { BoldGuardItem } from "./settings/BoldGuardItem";
import { BoldSendersItem } from "./settings/BoldSendersItem";
import { BoldTeamItem } from "./settings/BoldTeamItem";
import type { ItemHeader } from "./settings/BoldItemPage";
import { useSettingsData } from "./settings/settings-data";

type Item = "core" | "senders" | "team" | "guard";

export function BoldWsSettingsView({
  onOpenCredits,
  onOpenIntegrations,
  onOpenCampaign,
  onHeader,
  flash,
}: {
  onOpenCredits: () => void;
  onOpenIntegrations: () => void;
  onOpenCampaign: (agentId: string) => void;
  /** The open item page owns the canvas header (see `BoldItemPage`). */
  onHeader: (h: ItemHeader | null) => void;
  flash: (msg: string) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const { data, reload } = useSettingsData();

  // Stable, so publishing the header does not re-fire on every render.
  const back = useCallback(() => setItem(null), []);
  const shared = { data, reload, flash, onBack: back, onHeader };

  if (item === null) {
    return (
      <BoldSettingsHub
        data={data}
        onOpen={(t: HubTarget) => {
          if (t === "credits") onOpenCredits();
          else if (t === "integrations") onOpenIntegrations();
          else setItem(t);
        }}
      />
    );
  }
  if (item === "core") return <BoldCoreItem {...shared} />;
  if (item === "senders") return <BoldSendersItem {...shared} />;
  if (item === "team") return <BoldTeamItem {...shared} />;
  return <BoldGuardItem {...shared} onOpenCampaign={onOpenCampaign} />;
}
