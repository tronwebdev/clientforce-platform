import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "../src/chunk";
import {
  ExtractionError,
  extractFromDocument,
  extractFromHtml,
  extractFromUrl,
} from "../src/extract";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

describe("extractFromHtml", () => {
  it("extracts main content, strips chrome, keeps block boundaries", () => {
    const html = `<html><head><title>Acme — Growth</title><style>.x{}</style></head>
      <body><nav>Home Pricing</nav>
      <main><h1>We book appointments</h1><p>Acme helps clinics win 15–30 new patients monthly.</p>
      <ul><li>Free audit</li><li>No contracts</li></ul></main>
      <footer>© Acme</footer><script>evil()</script></body></html>`;
    const { text, title } = extractFromHtml(html);
    expect(title).toBe("Acme — Growth");
    expect(text).toContain("We book appointments");
    expect(text).toContain("15–30 new patients");
    expect(text).toContain("Free audit");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("© Acme");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(3);
  });

  it("throws ExtractionError on empty documents", () => {
    expect(() => extractFromHtml("<html><body><script>x()</script></body></html>")).toThrow(
      ExtractionError,
    );
  });
});

describe("extractFromUrl", () => {
  it("fails cleanly on HTTP errors and non-HTML content", async () => {
    const notFound = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(extractFromUrl("https://x.test/dead", notFound)).rejects.toThrow(/HTTP 404/);
    const png = (async () =>
      new Response("bin", {
        status: 200,
        headers: { "content-type": "image/png" },
      })) as unknown as typeof fetch;
    await expect(extractFromUrl("https://x.test/img", png)).rejects.toThrow(
      /Unsupported content-type/,
    );
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(extractFromUrl("https://x.test/down", down)).rejects.toThrow(/Fetch failed/);
  });

  it("extracts from a fetched HTML page", async () => {
    const ok = (async () =>
      new Response("<html><body><main><p>Hello world content.</p></main></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;
    const { text } = await extractFromUrl("https://x.test/page", ok);
    expect(text).toBe("Hello world content.");
  });
});

describe("extractFromDocument", () => {
  it("extracts text from the PDF fixture", async () => {
    const text = await extractFromDocument("sample.pdf", fixture("sample.pdf"));
    expect(text).toContain("Clientforce PDF fixture");
    expect(text).toContain("99 dollars per month");
  });

  it("extracts text from the DOCX fixture", async () => {
    const text = await extractFromDocument("sample.docx", fixture("sample.docx"));
    expect(text).toContain("free 15-minute growth audit");
  });

  it("handles md/txt and rejects unsupported types + oversized files", async () => {
    expect(
      await extractFromDocument("notes.md", Buffer.from("# Title\nSome **bold** fact.")),
    ).toContain("Some bold fact");
    expect(await extractFromDocument("notes.txt", Buffer.from("plain text"))).toBe("plain text");
    await expect(extractFromDocument("img.png", Buffer.from("x"))).rejects.toThrow(
      /Unsupported document type/,
    );
    await expect(extractFromDocument("big.txt", Buffer.alloc(26 * 1024 * 1024))).rejects.toThrow(
      /25 MB/,
    );
  });
});

describe("chunkText", () => {
  it("windows ~1000 tokens with overlap, respecting paragraph boundaries", () => {
    const para = "word ".repeat(200).trim(); // ~250 estimated tokens
    const text = Array.from({ length: 12 }, (_v, i) => `P${i} ${para}`).join("\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(1_100);
    // Overlap: consecutive chunks share at least one paragraph marker.
    const first = chunks[0]!.content.split("\n").at(-1)!;
    expect(chunks[1]!.content).toContain(first.slice(0, 12));
  });

  it("hard-splits an oversized single paragraph on sentence boundaries", () => {
    const sentence = "This is a sentence about growth. ";
    const monster = sentence.repeat(400); // way over one window, no newlines
    const chunks = chunkText(monster);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(1_100);
  });

  it("returns [] on empty input", () => {
    expect(chunkText("  \n  ")).toEqual([]);
  });
});
