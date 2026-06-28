import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarView } from "../components/SidebarView";
import type { Me } from "../lib/types";

const me: Me = {
  user: { id: "u1", email: "owner@demo-agency.test", name: "Jordan Mensah" },
  memberships: [
    { workspaceId: "wsA", role: "OWNER", workspace: { id: "wsA", name: "Mensah Agency", slug: "a", agencyId: "ag1" } },
    { workspaceId: "wsB", role: "ADMIN", workspace: { id: "wsB", name: "BrightSmile", slug: "b", agencyId: "ag1" } },
  ],
  activeWorkspace: { id: "wsA", name: "Mensah Agency", slug: "a", agencyId: "ag1" },
  activeAgencyId: "ag1",
  role: "OWNER",
};

describe("SidebarView", () => {
  it("renders the primary nav, profile, and active workspace; Tools collapsed", () => {
    const html = renderToStaticMarkup(
      <SidebarView me={me} activeKey="contacts" wsOpen={false} toolsOpen={false} />,
    );
    for (const label of ["Dashboard", "Agents", "Contacts", "Stats", "Integrations", "Automations", "Tools", "Settings"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Mensah Agency"); // active workspace
    expect(html).toContain("Jordan Mensah"); // profile
    expect(html).toContain("cf-sb__item--active"); // active item marked
    // Collapsed: tool items + badges are not in the DOM yet.
    expect(html).not.toContain("Lead Finder V2");
    expect(html).not.toContain("cf-sb__tools-menu");
  });

  it("shows the Tools flyout with badge styles when open", () => {
    const html = renderToStaticMarkup(
      <SidebarView me={me} activeKey="proposals" wsOpen={false} toolsOpen />,
    );
    expect(html).toContain("cf-sb__tools-menu");
    expect(html).toContain("Lead Finder V2");
    expect(html).toContain("Auto Prospecting");
    expect(html).toContain("cf-sb__badge--grad"); // gradient badge (Lead Finder)
    expect(html).toContain("cf-sb__badge--cyan"); // cyan badge (Proposals)
  });

  it("lists memberships when the switcher is open", () => {
    const html = renderToStaticMarkup(
      <SidebarView me={me} activeKey="dashboard" wsOpen toolsOpen={false} />,
    );
    expect(html).toContain("Switch workspace");
    expect(html).toContain("BrightSmile");
  });
});
