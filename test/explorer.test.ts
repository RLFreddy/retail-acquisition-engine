import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createExplorer } from "../explorer/server.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rae-explorer-"));
const product = {
  sku: "S3 PUT",
  name: "Mizuno S3 Putter",
  brand: "Mizuno",
  category: "Putter",
  starting_at: 189.99,
  badge: "NEW ITEM",
  images: ["https://www.2ndswing.com/images/standard/S3%20PUT.jpg"],
  videos: [],
  variants: [
    { sku: "C4613215", selected: { Dexterity: "Left Handed" } },
    { sku: "C4613216", selected: { Dexterity: "Right Handed" } },
  ],
  customize: { required: false, dropdowns: [{ label: "Grips", options: [{ name: "Standard", price: 0 }] }] },
};
fs.writeFileSync(path.join(dir, "output.json"), JSON.stringify([product]));
fs.writeFileSync(
  path.join(dir, "run-report.json"),
  JSON.stringify({ metrics: { ok: 1 }, failures: [{ sku: "KM2 PUT", reason: "product page not found (404)" }] }),
);

const server = createExplorer(dir).listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("serves the pages, their scripts and their styles", async () => {
  const files = [["/", "text/html"], ["/app.js", "text/javascript"], ["/style.css", "text/css"], ["/clone.html", "text/html"], ["/alternative.js", "text/javascript"]] as const;
  for (const [url, type] of files) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.startsWith(type));
  }
});

test("summary: one line per product, the run metrics and the failures", async () => {
  type Summary = { products: unknown[]; run: unknown; failures: { sku: string }[] };
  const summary = (await (await fetch(`${base}/api/summary`)).json()) as Summary;
  assert.deepEqual(summary.products, [
    {
      sku: "S3 PUT", name: "Mizuno S3 Putter", brand: "Mizuno", category: "Putter",
      starting_at: 189.99, badge: "NEW ITEM", required: false, variants: 2, customizations: 1, images: 1,
    },
  ]);
  assert.deepEqual(summary.run, { ok: 1 });
  assert.deepEqual(summary.failures.map((f) => f.sku), ["KM2 PUT"]);
});

test("a product's full record by SKU; 404 for unknown products and other files", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/products/${encodeURIComponent("S3 PUT")}`)).json(), product);
  assert.equal((await fetch(`${base}/api/products/NOPE`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});

test("a variant SKU leads to its product and the options selected, in any case", async () => {
  const hit = { product_sku: "S3 PUT", sku: "C4613216", selected: { Dexterity: "Right Handed" } };
  assert.deepEqual(await (await fetch(`${base}/api/variants/C4613216`)).json(), hit);
  assert.deepEqual(await (await fetch(`${base}/api/variants/c4613216`)).json(), hit);
  assert.equal((await fetch(`${base}/api/variants/C0000000`)).status, 404);
});
