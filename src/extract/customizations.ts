// Group names and the display order of options are not in any JSON the site
// exposes (x-magento-init or GraphQL); they only exist in the HTML form.

import type { CheerioAPI } from "cheerio";
import { roundToCents } from "../lib/money.js";
import type { Customization } from "../types.js";
import type { IronsetOptions } from "./schemas.js";

const sortByPageOrder = (ids: string[], order: string[]): string[] => {
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : Infinity);
  return [...ids].sort((a, b) => rank(a) - rank(b));
};

function readGroupLabels($: CheerioAPI): Map<string, string> {
  const labels = new Map<string, string>();
  $('label[for^="select_"]').each((_, label) => {
    const id = $(label).attr("for")!.replace("select_", "");
    labels.set(id, $(label).text().replace(/\s+/g, " ").trim());
  });
  return labels;
}

const readOptionOrder = ($: CheerioAPI, groupId: string): string[] =>
  $(`select[name="options[${groupId}]"] option[value!=""]`)
    .map((_, option) => $(option).attr("value"))
    .get();

export function parseCustomizations(
  $: CheerioAPI,
  options: IronsetOptions | undefined,
  basePrice: number,
): Customization[] {
  const groups = options?.optionConfig ?? {};
  const labels = readGroupLabels($);

  return sortByPageOrder(Object.keys(groups), [...labels.keys()]).flatMap((groupId) => {
    const group = groups[groupId]!;
    return sortByPageOrder(Object.keys(group), readOptionOrder($, groupId))
      .map((id) => group[id]!)
      .filter((option) => option.name.trim())
      .map((option) => {
        const modifier = roundToCents(option.prices.finalPrice.amount);
        return {
          category: labels.get(groupId) ?? groupId,
          option_name: option.name.trim(),
          price_modifier: modifier,
          final_price: roundToCents(basePrice + modifier),
        };
      });
  });
}
