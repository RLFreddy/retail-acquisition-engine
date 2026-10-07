import { BASE_URL } from "../config.js";
import { fetchHtml } from "../lib/http.js";
import { roundMs } from "../lib/time.js";
import { parseProduct } from "../extract/parse-product.js";
import type { Product, SourceProduct } from "../types.js";

// The site serves every product at /<sku-slug>, so no search request is
// needed: "LINK 2.2 PUT" → https://www.2ndswing.com/link-2dot2-put
export const buildProductUrl = (id: string): string =>
  BASE_URL + id.trim().toLowerCase().replace(/\./g, "dot").replace(/\s+/g, "-");

export async function scrapeProduct(source: SourceProduct): Promise<Product> {
  const start = performance.now();
  const url = buildProductUrl(source.id);
  const html = await fetchHtml(url);
  if (!html) throw new Error("product page not found (404)");
  return {
    ...parseProduct(source, html),
    extraction_time_ms: roundMs(performance.now() - start),
  };
}
