import * as cheerio from "cheerio";
import { roundToCents } from "../lib/money.js";
import type { Product, SourceProduct } from "../types.js";
import { parseClubs, parseCustomizeDropdowns } from "./customizations.js";
import { parseBadge, parseDescription, parseSpecs } from "./details.js";
import { readProductConfigs } from "./magento.js";
import { parseMainImage, parseVideos } from "./media.js";
import { parseVariants, sortAttributes, toDropdowns } from "./variants.js";

export function parseProduct(source: SourceProduct, html: string): Omit<Product, "extraction_time_ms" | "scraped_at"> {
  const $ = cheerio.load(html);
  const { product, spConfig, options } = readProductConfigs($);

  const pageSku = product.extension_attributes.ddg_sku;
  if (pageSku.toUpperCase() !== source.sku.toUpperCase()) {
    throw new Error(`unexpected page for SKU "${pageSku}"`);
  }
  if (!product.is_available) throw new Error("out of stock (site shows no price)");

  const startingAt = roundToCents(options?.basePrice ?? spConfig?.prices?.finalPrice.amount ?? 0);
  if (!startingAt) throw new Error("starting price not found");

  const attributes = sortAttributes(spConfig);
  const clubs = parseClubs($, options);

  return {
    sku: source.sku,
    name: product.name,
    brand: source.brand,
    category: source.category,
    model: source.model,
    // The provider's url often leads to the model's listing (new and used
    // clubs); the canonical link is the product page itself.
    url: $('link[rel="canonical"]').attr("href") ?? product.url,
    badge: parseBadge($),
    starting_at: startingAt,
    per_club: Boolean(options?.isIronsetProduct),
    dropdowns: toDropdowns(attributes),
    // The site multiplies the per-club price by the clubs checked.
    irons_in_set: clubs.length
      ? { options: clubs, checked: (options?.clubInformation?.included_clubs ?? []).filter(Boolean) }
      : null,
    customize: { required: options?.forceRequireOptions ?? false, dropdowns: parseCustomizeDropdowns($, options) },
    variants: parseVariants(spConfig, attributes),
    images: parseMainImage(product),
    videos: parseVideos($),
    description: parseDescription($),
    specs: parseSpecs($),
  };
}
