import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGallery } from "../src/extract/media.js";
import { parseProduct } from "../src/extract/parse-product.js";
import { buildProductUrl } from "../src/scrape/scrape-product.js";

const source = { sku: "S3 PUT", name: "S3 Putter", brand: "Mizuno", category: "Putter", model: "S3" };
const init = (json: object) => `<script type="text/x-magento-init">${JSON.stringify(json)}</script>`;
const price = (amount: number) => ({ finalPrice: { amount }, oldPrice: { amount } });
const option = (name: string, amount: number) => ({ name, prices: { finalPrice: { amount } } });

// Minimal page shaped like the live site: attributes out of position order,
// one unpriced variant, option groups out of page order, an empty stub block.
const page = ({ sku = "S3 PUT", available = true, optionsJson = true, ironset = false } = {}) => `
<link rel="canonical" href="https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter/s3-put" />
<label class="label" for="select_10"><span>Grips</span></label>
<select name="options[10]"><option value="">--</option><option value="102" price="29.99">B +
  $29.99</option><option value="101" price="0">A </option></select>
<label class="label" for="select_20"><span>Lie Angle</span></label>
<select name="options[20]"><option value="201" price="0">Standard</option></select>
<div id="details"><div class="row"><p><p><strong>Who’s It For?</strong></p><p>Golfers who <span>putt</span>.<br>Often.</p>
<ul><li>Forged</li></ul></div></div>
<div id="specs"><table><tr><td>Club</td><td>Loft</td></tr><tr><td>4</td><td>24°</td></tr><tr><td>5</td><td>27°</td></tr></table></div>
<div id="video"><div class="video-container youtube-player" data-id="abc123">
<noscript><iframe src="//www.youtube.com/embed/abc123"></iframe></noscript></div></div>
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
            url: "https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter", // the model listing
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
${optionsJson ? init({
  "#product_addtocart_form": {
    ironsetOptions: {
      basePrice: 400,
      isIronsetProduct: ironset ? 1 : 0,
      clubInformation: { included_clubs: ["7 Iron", "8 Iron", "9 Iron"] },
      optionConfig: { "20": { "201": option("Standard", 0) }, "10": { "101": option("A ", 0), "102": option("B", 29.99) } },
    },
  },
}) : ""}`;

const product = parseProduct(source, page());

test("name from the provider JSON, URL from the canonical link (not the model listing)", () => {
  assert.equal(product.name, "Mizuno S3 Putter");
  assert.equal(product.url, "https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter/s3-put");
});

test("product URL is the slugified SKU", () => {
  assert.equal(buildProductUrl("LINK 2.2 PUT"), "https://www.2ndswing.com/link-2dot2-put");
});

test("options follow position order", () => {
  assert.deepEqual(product.options, [
    { code: "hand", name: "Dexterity", values: ["Right"] },
    { code: "flex", name: "Flex", values: ["Stiff"] },
  ]);
});

test("only priced variants, upcharge = price − base price", () => {
  assert.deepEqual(product.variants, [
    { sku: "SKU-1", options: { Dexterity: "Right", Flex: "Stiff" }, price: 450, regular_price: 450, upcharge: 50 },
  ]);
  assert.deepEqual(product.price_range, { min: 450, max: 450 });
});

test("customizations: one per dropdown, labels, page order and upcharges", () => {
  assert.deepEqual(product.customizations, [
    { name: "Grips", options: [{ name: "B", upcharge: 29.99 }, { name: "A", upcharge: 0 }] },
    { name: "Lie Angle", options: [{ name: "Standard", upcharge: 0 }] },
  ]);
});

test("customizations come from the HTML select when the page has no options JSON", () => {
  assert.deepEqual(parseProduct(source, page({ optionsJson: false })).customizations, product.customizations);
});

test("iron sets: default set price = per-club price × included clubs", () => {
  const ironset = parseProduct(source, page({ ironset: true }));
  assert.equal(ironset.pricing_unit, "per_club");
  assert.equal(ironset.default_set_price, 1200);
  assert.equal(product.default_set_price, null);
});

test("description and specs from the page tabs", () => {
  assert.equal(product.description, "Who’s It For?\nGolfers who putt.\nOften.\nForged");
  assert.deepEqual(product.specs, [
    { Club: "4", Loft: "24°" },
    { Club: "5", Loft: "27°" },
  ]);
});

test("images from the provider JSON: canonical, encoded, deduped", () => {
  assert.deepEqual(product.media.images, [
    "https://www.2ndswing.com/images/standard/S3%20PUT.jpg",
    "https://www.2ndswing.com/images/representative/S3%20PUT.jpg",
  ]);
});

test("gallery: one image per name, encoded like the site does", () => {
  assert.deepEqual(parseGallery('{"imageNames":["S3 PUT.jpg","S3 PUT_2.jpg"]}'), [
    "https://www.2ndswing.com/images/representative/S3%20PUT.jpg",
    "https://www.2ndswing.com/images/representative/S3%20PUT_2.jpg",
  ]);
  assert.throws(() => parseGallery("<html>blocked</html>"), /site data changed in gallery/);
});

test("videos from the Videos tab", () => {
  assert.deepEqual(product.media.videos, ["https://www.youtube.com/watch?v=abc123"]);
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
