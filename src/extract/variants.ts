// spConfig.index lists only the attribute combinations that exist on the site.
// That is how conditional options are captured (e.g. a shaft only sold in
// Stiff) without simulating clicks.

import { roundToCents } from "../lib/money.js";
import type { ProductOption, Variant } from "../types.js";
import type { SpConfig } from "./schemas.js";

type SpAttribute = SpConfig["attributes"][string];

// Sorted by `position` because JS reorders numeric object keys ("626" before
// "632"), losing the page's selection order.
export const sortAttributes = (spConfig: SpConfig | undefined): SpAttribute[] =>
  Object.values(spConfig?.attributes ?? {}).sort((a, b) => a.position - b.position);

export const toProductOptions = (attributes: SpAttribute[]): ProductOption[] =>
  attributes.map(({ code, label, options }) => ({
    code,
    name: label,
    values: options.map((o) => o.label),
  }));

export function parseVariants(
  spConfig: SpConfig | undefined,
  attributes: SpAttribute[],
  basePrice: number,
): Variant[] {
  if (!spConfig) return [];
  const variants: Variant[] = [];

  for (const [productId, combo] of Object.entries(spConfig.index)) {
    const prices = spConfig.optionPrices[productId];
    const options: Record<string, string> = {};
    for (const attr of attributes) {
      const option = attr.options.find((o) => o.id === combo[attr.id]);
      if (option) options[attr.label] = option.label;
    }
    // Unpriced or incomplete combinations cannot be bought.
    if (!prices?.finalPrice.amount || Object.keys(options).length !== attributes.length) continue;

    const final = prices.finalPrice.amount;
    variants.push({
      sku: spConfig.sku?.[productId] ?? productId,
      options,
      price: roundToCents(final),
      regular_price: roundToCents(prices.oldPrice?.amount || final),
      upcharge: roundToCents(final - basePrice),
    });
  }
  return variants;
}
