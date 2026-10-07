import * as cheerio from "cheerio";
import { money } from "../lib/money.js";
import type { Product, SourceProduct } from "../types.js";
import { parseCustomizations } from "./customizations.js";
import { productConfigs } from "./magento.js";
import { parseMedia } from "./media.js";
import { parseVariants, sortedAttributes, toOutputAttributes } from "./variants.js";

export function parseProduct(source: SourceProduct, html: string): Omit<Product, "extraction_time_ms"> {
  const $ = cheerio.load(html);
  const { product, spConfig, options } = productConfigs($);

  const pageSku = product.extension_attributes.ddg_sku;
  if (pageSku.toUpperCase() !== source.id.toUpperCase()) {
    throw new Error(`unexpected page for SKU "${pageSku}"`);
  }
  if (!product.is_available) throw new Error("out of stock (site shows no price)");

  const basePrice = money(options?.basePrice ?? spConfig?.prices?.finalPrice.amount ?? 0);
  if (!basePrice) throw new Error("base price not found");

  const attributes = sortedAttributes(spConfig);
  const variants = parseVariants(spConfig, attributes, basePrice);
  const prices = variants.length ? variants.map((v) => v.final_price) : [basePrice];

  return {
    ...source,
    url: product.url,
    title: product.name,
    base_price: basePrice,
    pricing_unit: options?.isIronsetProduct ? "per_club" : "per_item",
    price_range: { min: Math.min(...prices), max: Math.max(...prices) },
    included_clubs: (options?.clubInformation?.included_clubs ?? []).filter(Boolean),
    media: parseMedia(product),
    attributes: toOutputAttributes(attributes),
    variants,
    customizations: parseCustomizations($, options, basePrice),
  };
}
