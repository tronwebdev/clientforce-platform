/**
 * P3.1 deploy (DEC-090) — media-stream URL + token extraction for the
 * deployed service's access gate. The token rides the URL *path*
 * (`/media/<token>`), never only the query string: Twilio's <Stream> noun is
 * not contractually guaranteed to preserve query parameters on the
 * WebSocket handshake, and a stripped query would make the gate refuse
 * Twilio itself (the 2026-07-21 1s-drop signature). Query form stays
 * accepted for rig/harness compatibility.
 */

/** The wss endpoint the TwiML advertises; path-form token when gated. */
export function mediaStreamUrl(host: string, token: string | undefined): string {
  return token ? `wss://${host}/media/${token}` : `wss://${host}/media`;
}

/**
 * Parse a /media upgrade request URL: returns the presented token (path
 * segment first, `?t=` fallback) — or null when the path isn't /media at
 * all (the caller refuses the upgrade outright).
 */
export function parseMediaRequest(reqUrl: string): { isMedia: boolean; token: string | null } {
  let pathname: string;
  let query: URLSearchParams;
  try {
    const u = new URL(reqUrl, "http://placeholder");
    pathname = u.pathname;
    query = u.searchParams;
  } catch {
    return { isMedia: false, token: null };
  }
  if (pathname === "/media") return { isMedia: true, token: query.get("t") };
  if (pathname.startsWith("/media/")) {
    const seg = pathname.slice("/media/".length);
    return { isMedia: true, token: seg.length > 0 && !seg.includes("/") ? seg : null };
  }
  return { isMedia: false, token: null };
}
