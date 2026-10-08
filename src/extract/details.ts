// The Description and Specs tabs, and the ribbon over the photos, are plain
// HTML in the same page; no JSON carries them.

import type { CheerioAPI } from "cheerio";

const cleanText = (text: string): string => text.replace(/\s+/g, " ").trim();

// <span id="badge-text">NEW<br>ITEM</span> → "NEW ITEM"; most pages have none.
export function parseBadge($: CheerioAPI): string | null {
  const badge = $("#badge-text").first().clone();
  badge.find("br").replaceWith(" ");
  return cleanText(badge.text()) || null;
}

// One line per paragraph: "Who’s It For?", "Construction: Forged"…
export function parseDescription($: CheerioAPI): string {
  const body = $("#details > .row").clone();
  body.find("br").replaceWith("\n");
  body.find("p, li, h1, h2, h3, h4, h5, h6").after("\n");
  return body.text().split("\n").map(cleanText).filter(Boolean).join("\n");
}

// The first row of each table holds the column names:
// [{ Club: "4", Loft: "24°", Length: "38.75\"" }, …]
export function parseSpecs($: CheerioAPI): Record<string, string>[] {
  return $("#specs table")
    .toArray()
    .flatMap((table) => {
      const [header = [], ...rows] = $(table)
        .find("tr")
        .toArray()
        .map((row) => $(row).find("td, th").map((_, cell) => cleanText($(cell).text())).get());
      return rows
        .filter((cells) => cells.some(Boolean))
        .map((cells) => Object.fromEntries(header.flatMap((key, i) => (key ? [[key, cells[i] ?? ""]] : []))));
    });
}
