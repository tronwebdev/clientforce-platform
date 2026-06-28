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
  it("renders the primary nav, profile, and active workspace", () => {
    const html = renderToStaticMarkup(<SidebarView me={me} activeKey="contacts" wsOpen={false} />);
    for (const label of ["Dashboard", "Agents", "Contacts", "Stats", "Integrations", "Automations", "Settings"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Mensah Agency"); // active workspace
    expect(html).toContain("Jordan Mensah"); // profile
    expect(html).toContain("cf-sb__item--active"); // an active item is marked
  });

  it("lists memberships when the switcher is open", () => {
    const html = renderToStaticMarkup(<SidebarView me={me} activeKey="dashboard" wsOpen />);
    expect(html).toContain("Switch workspace");
    expect(html).toContain("BrightSmile");
  });
});
