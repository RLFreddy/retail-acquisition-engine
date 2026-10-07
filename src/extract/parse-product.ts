import * as cheerio from "cheerio";
import { roundToCents } from "../lib/money.js";
import type { Product, SourceProduct } from "../types.js";
import { parseCustomizations } from "./customizations.js";
import { parseDescription, parseSpecs } from "./details.js";
import { readProductConfigs } from "./magento.js";
import { parseMedia, parseVideos } from "./media.js";
import { parseVariants, sortAttributes, toOutputAttributes } from "./variants.js";

export function parseProduct(source: SourceProduct, html: string): Omit<Product, "extraction_time_ms" | "scraped_at"> {
  const $ = cheerio.load(html);
  const { product, spConfig, options } = readProductConfigs($);

  const pageSku = product.extension_attributes.ddg_sku;
  if (pageSku.toUpperCase() !== source.id.toUpperCase()) {
    throw new Error(`unexpected page for SKU "${pageSku}"`);
  }
  if (!product.is_available) throw new Error("out of stock (site shows no price)");

  const basePrice = roundToCents(options?.basePrice ?? spConfig?.prices?.finalPrice.amount ?? 0);
  if (!basePrice) throw new Error("base price not found");

  const attributes = sortAttributes(spConfig);
  const variants = parseVariants(spConfig, attributes, basePrice);
  const prices = variants.length ? variants.map((v) => v.final_price) : [basePrice];
  // The site multiplies the per-club price by the clubs checked; these are checked by default.
  const includedClubs = (options?.clubInformation?.included_clubs ?? []).filter(Boolean);

  return {
    id: source.id,
    title: product.name,
    name: source.name,
    brand: source.brand,
    category: source.category,
    model: source.model,
    // The provider's url often leads to the model's listing (new and used
    // clubs); the canonical link is the product page itself.
    url: $('link[rel="canonical"]').attr("href") ?? product.url,
    base_price: basePrice,
    price_range: { min: Math.min(...prices), max: Math.max(...prices) },
    pricing_unit: options?.isIronsetProduct ? "per_club" : "per_item",
    included_clubs: includedClubs,
    default_set_price:
      options?.isIronsetProduct && includedClubs.length ? roundToCents(basePrice * includedClubs.length) : null,
    description: parseDescription($),
    specs: parseSpecs($),
    media: parseMedia(product),
    videos: parseVideos($),
    attributes: toOutputAttributes(attributes),
    variants,
    customizations: parseCustomizations($, options, basePrice),
  };
}
