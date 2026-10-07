import type { CheerioAPI } from "cheerio";
import { BASE_URL } from "../config.js";
import { GallerySchema, parseBlock, type ProviderItem } from "./schemas.js";

const GALLERY_IMAGES = `${BASE_URL}images/representative/`;

export function parseImages(item: ProviderItem): string[] {
  const urls = [...item.images.map((image) => image.url), item.extension_attributes.ddg_image];
  // The same image is repeated once per widget size (?width=…); dropping the
  // query string collapses the repeats into one URL.
  const canonical = urls
    .filter((url): url is string => Boolean(url))
    .map((url) => encodeURI(decodeURI(url.split("?")[0]!)));
  return [...new Set(canonical)];
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
