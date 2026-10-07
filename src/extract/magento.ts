// Magento 2 ships each widget's data as JSON in <script type="text/x-magento-init">,
// keyed by DOM selector, then component name:
//   { "#product_addtocart_form": { "configurable": { "spConfig": {...} } } }

import type { CheerioAPI } from "cheerio";
import {
  IronsetOptionsSchema,
  parseBlock,
  ProviderSchema,
  SpConfigSchema,
  type IronsetOptions,
  type ProviderItem,
  type SpConfig,
} from "./schemas.js";

function magentoBlocks($: CheerioAPI): Record<string, any>[] {
  return $('script[type="text/x-magento-init"]')
    .toArray()
    .flatMap((script) => {
      try {
        return [JSON.parse($(script).text())];
      } catch {
        return []; // a malformed block only breaks its own widget
      }
    });
}

export function productConfigs($: CheerioAPI): {
  product: ProviderItem;
  spConfig?: SpConfig;
  options?: IronsetOptions;
} {
  const blocks = magentoBlocks($);
  const form = blocks.map((b) => b["#product_addtocart_form"]).filter(Boolean);
  const spConfig = form.find((f) => f.configurable)?.configurable.spConfig;
  // ironsetOptions appears twice: an empty stub and the real config.
  const options = form.find((f) => f.ironsetOptions?.optionConfig)?.ironsetOptions;
  const provider = blocks.find((b) => b["*"]?.["Magento_Catalog/js/product/view/provider"])?.["*"][
    "Magento_Catalog/js/product/view/provider"
  ];

  // Missing on generic model pages the site redirects some retired SKUs to.
  if (!provider) throw new Error("not a product page (no provider block)");
  const [product] = Object.values(parseBlock("provider", ProviderSchema, provider).data.items);
  if (!product) throw new Error("not a product page (empty provider block)");

  return {
    product,
    spConfig: spConfig && parseBlock("spConfig", SpConfigSchema, spConfig),
    options: options && parseBlock("ironsetOptions", IronsetOptionsSchema, options),
  };
}
