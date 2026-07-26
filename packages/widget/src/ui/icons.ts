/**
 * Line icons — the mock's build note is explicit: "the legacy widget's emoji
 * became line icons + the ✦ mark." Stroke-only SVG on `currentColor`, so every
 * icon inherits the surrounding token color and nothing here carries a value
 * of its own.
 *
 * Geometry is standard 24×24 stroke iconography (the repo's lucide vocabulary —
 * see PROGRESS's icon map); rendered inline because the embed ships as one
 * self-contained bundle with no asset requests.
 */

const NS = "http://www.w3.org/2000/svg";

type Shape = [tag: string, attrs: Record<string, string>];

/** PROGRESS icon-map names → the shapes that draw them. */
const ICONS: Record<string, Shape[]> = {
  calendar: [
    ["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }],
    ["line", { x1: "16", y1: "2", x2: "16", y2: "6" }],
    ["line", { x1: "8", y1: "2", x2: "8", y2: "6" }],
    ["line", { x1: "3", y1: "10", x2: "21", y2: "10" }],
  ],
  phone: [
    [
      "path",
      {
        d: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
      },
    ],
  ],
  "file-text": [
    ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
    ["polyline", { points: "14 2 14 8 20 8" }],
    ["line", { x1: "16", y1: "13", x2: "8", y2: "13" }],
    ["line", { x1: "16", y1: "17", x2: "8", y2: "17" }],
  ],
  mic: [
    ["path", { d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" }],
    ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2" }],
    ["line", { x1: "12", y1: "19", x2: "12", y2: "23" }],
    ["line", { x1: "8", y1: "23", x2: "16", y2: "23" }],
  ],
  send: [
    ["line", { x1: "22", y1: "2", x2: "11", y2: "13" }],
    ["polygon", { points: "22 2 15 22 11 13 2 9 22 2" }],
  ],
  x: [
    ["line", { x1: "18", y1: "6", x2: "6", y2: "18" }],
    ["line", { x1: "6", y1: "6", x2: "18", y2: "18" }],
  ],
};

export type IconName = keyof typeof ICONS;

export function iconEl(doc: Document, name: IconName, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("data-icon", name);
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const shape = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.appendChild(shape);
  }
  return svg;
}

/** Quick-action kind → icon (the mock's flow list, mapped to iconography). */
export const QUICK_ACTION_ICON: Record<string, IconName> = {
  book_call: "calendar",
  call_me_back: "phone",
  get_proposal: "file-text",
};
