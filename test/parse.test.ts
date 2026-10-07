import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProduct } from "../src/extract/product.js";
import { productUrl } from "../src/scrape/product.js";

const source = { id: "S3 PUT", name: "Mizuno S3 Putter", brand: "Mizuno", category: "Putter", model: "S3" };
const init = (json: object) => `<script type="text/x-magento-init">${JSON.stringify(json)}</script>`;
const price = (amount: number) => ({ finalPrice: { amount }, oldPrice: { amount } });
const option = (name: string, amount: number) => ({ name, prices: { finalPrice: { amount } } });

// Minimal page shaped like the live site: attributes out of position order,
// one unpriced variant, option groups out of page order, an empty stub block.
const page = ({ sku = "S3 PUT", available = true } = {}) => `
<label class="label" for="select_10"><span>Grips</span></label>
<select name="options[10]"><option value="">--</option><option value="102">B</option><option value="101">A</option></select>
<label class="label" for="select_20"><span>Lie Angle</span></label>
<select name="options[20]"><option value="201">Standard</option></select>
${init({
  "#product_addtocart_form": {
    configurable: {
      spConfig: {
        attributes: {
          "626": { id: "626", code: "flex", label: "Flex", position: "2", options: [{ id: "s", label: "Stiff" }] },
          "632": { id: "632", code: "hand", label: "Dexterity", position: "1", options: [{ id: "rh", label: "Right" }] },
        },
        index: { "1": { "632": "rh", "626": "s" }, "2": { "632": "rh", "626": "s" } },
        optionPrices: { "1": price(450) },
        sku: { "1": "SKU-1" },
        prices: price(400),
      },
    },
  },
})}
${init({ "#product_addtocart_form": { ironsetOptions: { preSelectedClubs: [] } } })}
${init({
  "*": {
    "Magento_Catalog/js/product/view/provider": {
      data: {
        items: {
          "9": {
            name: "Mizuno S3 Putter",
            url: "https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter/s3-put",
            is_available: available,
            images: [
              { url: "https://www.2ndswing.com/images/standard/S3 PUT.jpg?width=250&height=250" },
              { url: "https://www.2ndswing.com/images/standard/S3 PUT.jpg?width=150&height=150" },
            ],
            extension_attributes: {
              ddg_sku: sku,
              ddg_image: "https://www.2ndswing.com/images/representative/S3 PUT.jpg?width=150",
            },
          },
        },
      },
    },
  },
})}
${init({
  "#product_addtocart_form": {
    ironsetOptions: {
      basePrice: 400,
      optionConfig: { "20": { "201": option("Standard", 0) }, "10": { "101": option("A ", 0), "102": option("B", 29.99) } },
    },
  },
})}`;

const product = parseProduct(source, page());

test("identity comes from the provider JSON", () => {
  assert.equal(product.title, "Mizuno S3 Putter");
  assert.equal(product.url, "https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter/s3-put");
});

test("product URL is the slugified SKU", () => {
  assert.equal(productUrl("LINK 2.2 PUT"), "https://www.2ndswing.com/link-2dot2-put");
});

test("attributes follow position order", () => {
  assert.deepEqual(product.attributes.map((a) => a.label), ["Dexterity", "Flex"]);
});

test("only priced variants, modifier = price − base", () => {
  assert.deepEqual(product.variants, [
    { sku: "SKU-1", options: { Dexterity: "Right", Flex: "Stiff" }, final_price: 450, regular_price: 450, price_modifier: 50 },
  ]);
  assert.deepEqual(product.price_range, { min: 450, max: 450 });
});

test("customizations: add-on pricing, page order and labels", () => {
  assert.deepEqual(
    product.customizations.map((c) => [c.category, c.option_name, c.price_modifier, c.final_price]),
    [
      ["Grips", "B", 29.99, 429.99],
      ["Grips", "A", 0, 400],
      ["Lie Angle", "Standard", 0, 400],
    ],
  );
});

test("media from the provider JSON: canonical, encoded, deduped", () => {
  assert.deepEqual(product.media, [
    "https://www.2ndswing.com/images/standard/S3%20PUT.jpg",
    "https://www.2ndswing.com/images/representative/S3%20PUT.jpg",
  ]);
});

test("rejects a page for another SKU", () => {
  assert.throws(() => parseProduct(source, page({ sku: "S2 PUT" })), /unexpected page for SKU "S2 PUT"/);
});

test("reports out-of-stock products", () => {
  assert.throws(() => parseProduct(source, page({ available: false })), /out of stock/);
});

test("rejects pages without product data", () => {
  assert.throws(() => parseProduct(source, "<html></html>"), /not a product page/);
});

test("fails with the exact field when the site JSON changes", () => {
  const broken = page().replace('"basePrice":400', '"basePrice":"n/a"');
  assert.throws(() => parseProduct(source, broken), /site data changed in ironsetOptions[\s\S]*basePrice/);
});
