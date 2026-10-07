// Magento 2 ships each widget's data as JSON in <script type="text/x-magento-init">,
// keyed by DOM selector, then component name:
//   { "#product_addtocart_form": { "configurable": { "spConfig": {...} } } }

import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import {
  IronsetOptionsSchema,
  parseBlock,
  ProviderSchema,
  SpConfigSchema,
  type IronsetOptions,
  type ProviderItem,
  type SpConfig,
} from "./schemas.js";

const FORM = "#product_addtocart_form";
const PROVIDER = "Magento_Catalog/js/product/view/provider";

type Block = Record<string, Record<string, unknown> | undefined>;

function magentoBlocks($: CheerioAPI): Block[] {
  return $('script[type="text/x-magento-init"]')
    .toArray()
    .flatMap((script) => {
      try {
        return [JSON.parse($(script).text()) as Block];
      } catch {
        return []; // a malformed block only breaks its own widget
      }
    });
}

const components = (blocks: Block[], selector: string, name: string): unknown[] =>
  blocks.map((block) => block[selector]?.[name]).filter((config) => config !== undefined);

const hasKey = (value: unknown, key: string): boolean =>
  typeof value === "object" && value !== null && key in value;

export function productConfigs($: CheerioAPI): {
  product: ProviderItem;
  spConfig?: SpConfig;
  options?: IronsetOptions;
} {
  const blocks = magentoBlocks($);
  const configurable = components(blocks, FORM, "configurable").find((c) => hasKey(c, "spConfig"));
  // ironsetOptions appears twice: an empty stub and the real config.
  const options = components(blocks, FORM, "ironsetOptions").find((c) => hasKey(c, "optionConfig"));
  const [provider] = components(blocks, "*", PROVIDER);

  // Missing on generic model pages the site redirects some retired SKUs to.
  if (!provider) throw new Error("not a product page (no provider block)");
  const [product] = Object.values(parseBlock("provider", ProviderSchema, provider).data.items);
  if (!product) throw new Error("not a product page (empty provider block)");

  return {
    product,
    spConfig: configurable
      ? parseBlock("spConfig", z.object({ spConfig: SpConfigSchema }), configurable).spConfig
      : undefined,
    options: options ? parseBlock("ironsetOptions", IronsetOptionsSchema, options) : undefined,
  };
}
