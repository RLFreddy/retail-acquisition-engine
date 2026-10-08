import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Config is read at import time, and scrape-product opens the run's log file:
// point OUTPUT_DIR at a temp dir first, then import the modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rae-extract-"));
process.env.OUTPUT_DIR = tmp;
const { parseGallery } = await import("../src/extract/media.js");
const { parseProduct } = await import("../src/extract/parse-product.js");
const { buildProductUrl } = await import("../src/scrape/scrape-product.js");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const source = { sku: "S3 PUT", name: "S3 Putter", brand: "Mizuno", category: "Putter", model: "S3" };
const init = (json: object) => `<script type="text/x-magento-init">${JSON.stringify(json)}</script>`;
const price = (amount: number) => ({ finalPrice: { amount } });
const option = (name: string, amount: number, option_type = "select") => ({ name, option_type, prices: { finalPrice: { amount } } });

// Minimal page shaped like the live site: attributes out of position order,
// one unpriced variant, option groups out of page order, an empty stub block.
const page = ({ sku = "S3 PUT", available = true, optionsJson = true, ironset = false, forceRequire = false, badge = false } = {}) => `
<link rel="canonical" href="https://www.2ndswing.com/golf-clubs/putters/mizuno-s3-putter/s3-put" />
${badge ? '<span class="pdp-badge new-item-badge"><span id="badge-text">NEW<br>ITEM</span></span>' : ""}
<label class="label" for="select_10"><span>Grips</span></label>
<select name="options[10]"><option value="">--</option><option value="102" price="29.99">B +
  $29.99</option><option value="101" price="0">A </option></select>
<label class="label" for="select_20"><span>Lie Angle</span></label>
<select name="options[20]"><option value="201" price="0">Standard</option></select>
${ironset ? '<label class="label" for="select_30"><span>Irons In Set</span></label>' : ""}
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
        leadtimes: { "632": { "1": ["1"] }, "626": { "1": ["1"] } }, // days as the site sends them: numbers or strings
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
      forceRequireOptions: forceRequire,
      clubInformation: { included_clubs: ironset ? ["7 Iron", "8 Iron", "9 Iron"] : [] },
      optionConfig: {
        "20": { "201": option("Standard", 0) },
        "10": { "101": option("A ", 0, "grips"), "102": option("B", 29.99, "grips") },
        ...(ironset && {
          "30": { "301": option("7 Iron", 0, "clubs"), "302": option("8 Iron", 0, "clubs"),
                  "303": option("9 Iron", 0, "clubs"), "304": option("PW", 0, "clubs") },
        }),
      },
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

test("badge: the ribbon over the photos, or null", () => {
  assert.equal(parseProduct(source, page({ badge: true })).badge, "NEW ITEM");
  assert.equal(product.badge, null);
});

test("dropdowns follow position order", () => {
  assert.deepEqual(product.dropdowns, [
    { label: "Dexterity", options: ["Right"] },
    { label: "Flex", options: ["Stiff"] },
  ]);
});

test("only priced variants, with the options selected, price and days to ship", () => {
  assert.equal(product.starting_at, 400);
  assert.deepEqual(product.variants, [
    { sku: "SKU-1", selected: { Dexterity: "Right", Flex: "Stiff" }, product_price: 450, ships_in_days: 1 },
  ]);
});

test("customize: one dropdown per label, in page order, with each option's price", () => {
  assert.deepEqual(product.customize, {
    required: false,
    dropdowns: [
      { label: "Grips", options: [{ name: "B", price: 29.99 }, { name: "A", price: 0 }] },
      { label: "Lie Angle", options: [{ name: "Standard", price: 0 }] },
    ],
  });
});

test("customize is required where the site locks it on", () => {
  assert.equal(parseProduct(source, page({ forceRequire: true })).customize.required, true);
});

test("customize comes from the HTML select when the page has no options JSON", () => {
  assert.deepEqual(parseProduct(source, page({ optionsJson: false })).customize.dropdowns, product.customize.dropdowns);
});

test("iron sets: priced per club, with the Irons In Set checkboxes apart from Customize", () => {
  const ironset = parseProduct(source, page({ ironset: true }));
  assert.equal(ironset.per_club, true);
  assert.deepEqual(ironset.irons_in_set, { options: ["7 Iron", "8 Iron", "9 Iron", "PW"], checked: ["7 Iron", "8 Iron", "9 Iron"] });
  assert.deepEqual(ironset.customize.dropdowns.map((d) => d.label), ["Grips", "Lie Angle"]);
  assert.equal(product.per_club, false);
  assert.equal(product.irons_in_set, null);
});

test("description and specs from the page tabs", () => {
  assert.equal(product.description, "Who’s It For?\nGolfers who putt.\nOften.\nForged");
  assert.deepEqual(product.specs, [
    { Club: "4", Loft: "24°" },
    { Club: "5", Loft: "27°" },
  ]);
});

test("the page JSON gives one main photo: the gallery's copy, encoded, without ?width", () => {
  assert.deepEqual(product.images, ["https://www.2ndswing.com/images/representative/S3%20PUT.jpg"]);
});

test("gallery: one image per name, encoded like the site does", () => {
  assert.deepEqual(parseGallery('{"imageNames":["S3 PUT.jpg","S3 PUT_2.jpg"]}'), [
    "https://www.2ndswing.com/images/representative/S3%20PUT.jpg",
    "https://www.2ndswing.com/images/representative/S3%20PUT_2.jpg",
  ]);
  assert.throws(() => parseGallery("<html>blocked</html>"), /site data changed in gallery/);
});

test("videos from the Videos tab", () => {
  assert.deepEqual(product.videos, ["https://www.youtube.com/watch?v=abc123"]);
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
