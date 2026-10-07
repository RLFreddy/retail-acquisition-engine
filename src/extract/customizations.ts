// Group names and the display order of options are not in any JSON the site
// exposes (x-magento-init or GraphQL); they only exist in the HTML form.

import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import { roundToCents } from "../lib/money.js";
import type { Customization } from "../types.js";
import { parseBlock, type IronsetOptions } from "./schemas.js";

type OptionGroup = IronsetOptions["optionConfig"][string];
type GroupOption = { name: string; amount: number };

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

const readJsonOptions = ($: CheerioAPI, groupId: string, group: OptionGroup): GroupOption[] =>
  sortByPageOrder(Object.keys(group), readOptionOrder($, groupId)).map((id) => ({
    name: group[id]!.name,
    amount: group[id]!.prices.finalPrice.amount,
  }));

// Some pages have no optionConfig JSON, only the <select>. Each <option> has
// the same amount in its price attribute, and its text ends in " + $2.50"
// when the amount is not zero.
const readHtmlOptions = ($: CheerioAPI, groupId: string): GroupOption[] =>
  $(`select[name="options[${groupId}]"] option[value!=""]`)
    .map((_, option) => ({
      name: $(option).text().replace(/\s*\+\s*\$[\d,.]+\s*$/, ""),
      amount: parseBlock("custom option price", z.coerce.number(), $(option).attr("price")),
    }))
    .get();

export function parseCustomizations($: CheerioAPI, options: IronsetOptions | undefined): Customization[] {
  const groups = options?.optionConfig ?? {};
  const labels = readGroupLabels($);
  const groupIds = [...new Set([...Object.keys(groups), ...labels.keys()])];

  return sortByPageOrder(groupIds, [...labels.keys()])
    .map((groupId) => {
      const group = groups[groupId];
      return {
        name: labels.get(groupId) ?? groupId,
        options: (group ? readJsonOptions($, groupId, group) : readHtmlOptions($, groupId))
          .filter((option) => option.name.trim())
          .map((option) => ({ name: option.name.trim(), upcharge: roundToCents(option.amount) })),
      };
    })
    .filter((customization) => customization.options.length);
}
