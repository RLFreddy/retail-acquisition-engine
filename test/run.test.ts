import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Product, SourceProduct } from "../src/types.js";

// Config is read at import time: set it first, then import the modules.
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rae-run-"));
process.env.CONCURRENCY = "2";
process.env.DELAY_MS = "0";
const { BlockedError } = await import("../src/lib/http.js");
const { run } = await import("../src/scrape/run.js");

const sources: SourceProduct[] = Array.from({ length: 10 }, (_, i) => ({
  id: `P${i}`,
  name: `Product ${i}`,
  brand: "",
  category: "",
  model: "",
}));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const product = (source: SourceProduct) =>
  ({ ...source, variants: [], customizations: [], extraction_time_ms: 0 }) as unknown as Product;

test("keeps CSV order although workers finish out of order", async () => {
  // Earlier products take longer, so they finish last.
  const { products } = await run(sources, async (s) => {
    await sleep(50 - Number(s.id.slice(1)) * 5);
    return product(s);
  });
  assert.deepEqual(products.map((p) => p.id), sources.map((s) => s.id));
});

test("a failed product does not stop the run", async () => {
  const { products, failures } = await run(sources, async (s) => {
    if (s.id === "P3") throw new Error("boom");
    return product(s);
  });
  assert.equal(products.length, 9);
  assert.deepEqual(failures.map((f) => [f.id, f.reason]), [["P3", "boom"]]);
});

test("stops and skips the rest when the site keeps blocking", async () => {
  const { products, failures } = await run(sources, async (s) => {
    throw new BlockedError(s.id);
  });
  const skipped = failures.filter((f) => f.reason.startsWith("skipped"));
  assert.equal(products.length, 0);
  assert.equal(failures.length, sources.length);
  assert.ok(skipped.length > 0, "the queue should stop before trying every product");
});
