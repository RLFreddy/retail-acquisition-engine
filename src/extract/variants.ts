// spConfig.index lists only the combinations of the dropdowns that exist on the
// site. That is how conditional options are captured (e.g. a shaft only sold
// in Stiff) without simulating clicks.

import { roundToCents } from "../lib/money.ts";
import type { Dropdown, Variant } from "../types.ts";
import type { SpConfig } from "./schemas.ts";

type SpAttribute = SpConfig["attributes"][string];

// Sorted by `position` because JS reorders numeric object keys ("626" before
// "632"), losing the page's selection order.
export const sortAttributes = (spConfig: SpConfig | undefined): SpAttribute[] =>
  Object.values(spConfig?.attributes ?? {}).sort((a, b) => a.position - b.position);

export const toDropdowns = (attributes: SpAttribute[]): Dropdown[] =>
  attributes.map(({ label, options }) => ({ label, options: options.map((o) => o.label) }));

// Days to ship per simple product, repeated under each attribute id:
// { "632": { "8807653": ["1"] } } → 8807653 → 1
const readShipsInDays = (spConfig: SpConfig): Map<string, number> =>
  new Map(
    Object.values(spConfig.leadtimes ?? {}).flatMap((byProduct) =>
      Object.entries(byProduct).flatMap(([productId, [days]]) => (days === undefined ? [] : [[productId, days] as const])),
    ),
  );

export function parseVariants(spConfig: SpConfig | undefined, attributes: SpAttribute[]): Variant[] {
  if (!spConfig) return [];
  const shipsInDays = readShipsInDays(spConfig);
  const variants: Variant[] = [];

  for (const [productId, combo] of Object.entries(spConfig.index)) {
    const price = spConfig.optionPrices[productId]?.finalPrice.amount;
    const selected: Record<string, string> = {};
    for (const attr of attributes) {
      const option = attr.options.find((o) => o.id === combo[attr.id]);
      if (option) selected[attr.label] = option.label;
    }
    // Unpriced or incomplete combinations cannot be bought.
    if (!price || Object.keys(selected).length !== attributes.length) continue;

    variants.push({
      sku: spConfig.sku?.[productId] ?? productId,
      selected,
      product_price: roundToCents(price),
      ships_in_days: shipsInDays.get(productId) ?? null,
    });
  }
  return variants;
}
