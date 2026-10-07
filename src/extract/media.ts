import type { ProviderItem } from "./schemas.js";

export function parseMedia(item: ProviderItem): string[] {
  const urls = [...item.images.map((image) => image.url), item.extension_attributes.ddg_image];
  // The same image is repeated once per widget size (?width=…); dropping the
  // query string collapses the repeats into one URL.
  const canonical = urls
    .filter((url): url is string => Boolean(url))
    .map((url) => encodeURI(decodeURI(url.split("?")[0]!)));
  return [...new Set(canonical)];
}
