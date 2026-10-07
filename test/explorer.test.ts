import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createExplorer } from "../explorer/server.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rae-explorer-"));
const product = {
  id: "S3 PUT",
  title: "Mizuno S3 Putter",
  brand: "Mizuno",
  category: "Putter",
  media: ["https://www.2ndswing.com/images/standard/S3%20PUT.jpg"],
  variants: [{ sku: "A" }, { sku: "B" }],
  customizations: [{ option_name: "Standard" }],
};
fs.writeFileSync(path.join(dir, "output.json"), JSON.stringify([product]));
fs.writeFileSync(
  path.join(dir, "run-report.json"),
  JSON.stringify({ metrics: { ok: 1 }, failures: [{ id: "KM2 PUT", reason: "product page not found (404)" }] }),
);

const server = createExplorer(dir).listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("serves the page, its script and its styles", async () => {
  for (const [url, type] of [["/", "text/html"], ["/app.js", "text/javascript"], ["/style.css", "text/css"]] as const) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.startsWith(type));
  }
});

test("summary: one line per product, the run metrics and the failures", async () => {
  type Summary = { products: unknown[]; run: unknown; failures: { id: string }[] };
  const summary = (await (await fetch(`${base}/api/summary`)).json()) as Summary;
  assert.deepEqual(summary.products, [
    { id: "S3 PUT", title: "Mizuno S3 Putter", brand: "Mizuno", category: "Putter", variants: 2, customizations: 1, media: 1 },
  ]);
  assert.deepEqual(summary.run, { ok: 1 });
  assert.deepEqual(summary.failures.map((f) => f.id), ["KM2 PUT"]);
});

test("a product's full record by SKU; 404 for unknown products and other files", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/products/${encodeURIComponent("S3 PUT")}`)).json(), product);
  assert.equal((await fetch(`${base}/api/products/NOPE`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});
