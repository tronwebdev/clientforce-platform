import { parseHTML } from "linkedom";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

/** Typed, non-retryable extraction failure → the source goes FAILED with this reason. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const MAX_FETCH_BYTES = 5 * 1024 * 1024; // 5 MB of HTML is plenty
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // Brand-kit prototype: "up to 25 MB each"

/** Tags whose text content is never prose. */
const STRIP_TAGS = [
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "form",
  "iframe",
];

/**
 * WEBSITE: fetch + readability-style main-content extraction. Keeps it
 * dependency-light: strip chrome tags, prefer <main>/<article>, collapse
 * whitespace, keep heading/paragraph boundaries as newlines.
 */
export async function extractFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; title: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: { "user-agent": "clientforce-knowledge/1.0 (+https://clientforce.io)" },
    });
  } catch (err) {
    throw new ExtractionError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ExtractionError(`Fetch failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text/plain")) {
    throw new ExtractionError(`Unsupported content-type: ${contentType || "unknown"}`);
  }
  const body = await res.text();
  if (body.length > MAX_FETCH_BYTES) throw new ExtractionError("Page exceeds the 5 MB fetch cap");
  if (contentType.includes("text/plain")) return { text: normalize(body), title: null };
  return extractFromHtml(body);
}

export function extractFromHtml(html: string): { text: string; title: string | null } {
  const { document } = parseHTML(html);
  const title = document.querySelector("title")?.textContent?.trim() || null;
  for (const tag of STRIP_TAGS) {
    for (const el of [...document.querySelectorAll(tag)]) el.remove();
  }
  const rootEl =
    document.querySelector("main") ??
    document.querySelector("article") ??
    document.querySelector("body");
  const blocks: string[] = [];
  const BLOCK = "h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,figcaption,dt,dd";
  for (const el of rootEl ? [...rootEl.querySelectorAll(BLOCK)] : []) {
    // Skip containers whose text is already captured by a nested block element.
    if (el.querySelector(BLOCK)) continue;
    const t = el.textContent?.replace(/\s+/g, " ").trim();
    if (t) blocks.push(t);
  }
  const text = blocks.length > 0 ? blocks.join("\n") : normalize(rootEl?.textContent ?? "");
  if (!text.trim()) throw new ExtractionError("No extractable text content");
  return { text, title };
}

/** DOCUMENT: extraction dispatch by filename extension. */
export async function extractFromDocument(filename: string, data: Buffer): Promise<string> {
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new ExtractionError("File exceeds the 25 MB limit");
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf": {
      const parsed = await pdfParse(data).catch((e: unknown) => {
        throw new ExtractionError(
          `PDF parse failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      const text = normalize(parsed.text);
      if (!text) throw new ExtractionError("PDF contains no extractable text");
      return text;
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer: data }).catch((e: unknown) => {
        throw new ExtractionError(
          `DOCX parse failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      const text = normalize(result.value);
      if (!text) throw new ExtractionError("DOCX contains no extractable text");
      return text;
    }
    case "txt":
    case "md": {
      let text = data.toString("utf8");
      if (ext === "md") {
        text = text
          .replace(/```[\s\S]*?```/g, " ") // fenced code
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
          .replace(/^#{1,6}\s+/gm, "") // headings
          .replace(/[*_`>#]+/g, " "); // remaining markup
      }
      const out = normalize(text);
      if (!out) throw new ExtractionError("File contains no text");
      return out;
    }
    default:
      throw new ExtractionError(`Unsupported document type ".${ext}" — use PDF, DOCX, TXT or MD`);
  }
}

const normalize = (s: string): string =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
