import { BASE_URL } from "../config.js";
import { fetchText } from "../lib/http.js";
import { roundMs } from "../lib/time.js";
import { parseGallery } from "../extract/media.js";
import { parseProduct } from "../extract/parse-product.js";
import type { Product, SourceProduct } from "../types.js";

// The site serves every product at /<sku-slug>, so no search request is
// needed: "LINK 2.2 PUT" → https://www.2ndswing.com/link-2dot2-put
export const buildProductUrl = (sku: string): string =>
  BASE_URL + sku.trim().toLowerCase().replace(/\./g, "dot").replace(/\s+/g, "-");

// The page loads its photo gallery from a second, small JSON:
// "PRO S4 STS" → https://www.2ndswing.com/gallery/PRO%20S4%20STS.json
const buildGalleryUrl = (sku: string): string => `${BASE_URL}gallery/${encodeURIComponent(sku.trim())}.json`;

export async function scrapeProduct(source: SourceProduct): Promise<Product> {
  const start = performance.now();
  const html = await fetchText(buildProductUrl(source.sku));
  if (!html) throw new Error("product page not found (404)");
  const product = parseProduct(source, html);
  const gallery = await fetchText(buildGalleryUrl(source.sku)); // null (404) = no gallery
  const galleryImages = gallery ? parseGallery(gallery) : [];
  return {
    ...product,
    // The photos are the page's gallery; without one, the page's main photo.
    images: galleryImages.length ? galleryImages : product.images,
    scraped_at: new Date().toISOString(),
    extraction_time_ms: roundMs(performance.now() - start),
  };
}
