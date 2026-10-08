import type { CheerioAPI } from "cheerio";
import { BASE_URL } from "../config.ts";
import { GallerySchema, parseBlock, type ProviderItem } from "./schemas.ts";

const GALLERY_IMAGES = `${BASE_URL}images/representative/`;

// The page's own JSON only has the main photo, for widgets such as "recently
// viewed": the gallery's copy (ddg_image) and resized ones in /images/standard/.
// It stands in for a product without a gallery.
export function parseMainImage(item: ProviderItem): string[] {
  const url = item.extension_attributes.ddg_image ?? item.images[0]?.url;
  return url ? [encodeURI(decodeURI(url.split("?")[0]!))] : []; // without ?width=…
}

// Every photo of the page's gallery: { "imageNames": ["PRO S4 STS.jpg", "PRO S4 STS_2.jpg", …] }
export function parseGallery(json: string): string[] {
  let data: unknown = null;
  try {
    data = JSON.parse(json);
  } catch {
    // left null: parseBlock reports it as a site change
  }
  return parseBlock("gallery", GallerySchema, data).imageNames.map((name) => GALLERY_IMAGES + encodeURIComponent(name));
}

// The Videos tab holds YouTube players by id; their iframes only exist in <noscript>.
export function parseVideos($: CheerioAPI): string[] {
  const ids = $("#video .youtube-player[data-id]")
    .map((_, player) => $(player).attr("data-id"))
    .get();
  return [...new Set(ids)].map((id) => `https://www.youtube.com/watch?v=${id}`);
}
