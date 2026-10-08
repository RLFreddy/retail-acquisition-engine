import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import Sqlite from "better-sqlite3";
import type { Product, SourceProduct } from "../src/types.ts";

// Config is read at import time: set it first, then import the modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rae-run-"));
process.env.OUTPUT_DIR = tmp;
process.env.CONCURRENCY = "2";
process.env.DELAY_MS = "0";
process.env.MAX_ATTEMPTS = "2";
const { BlockedError } = await import("../src/lib/http.ts");
const { closeState, initState, productState } = await import("../src/lib/state.ts");
const { scrapeAll } = await import("../src/scrape/scrape-all.ts");

// Every test starts from an empty state.
let run = 0;
beforeEach(() => {
  closeState();
  initState(path.join(tmp, `state-${++run}.db`));
});
after(() => {
  closeState();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sources: SourceProduct[] = Array.from({ length: 10 }, (_, i) => ({
  sku: `P${i}`,
  name: `Product ${i}`,
  brand: "",
  category: "",
  model: "",
}));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const product = (source: SourceProduct) =>
  ({ ...source, variants: [], customize: { required: false, dropdowns: [] }, extraction_time_ms: 0 }) as unknown as Product;

test("keeps CSV order although workers finish out of order", async () => {
  // Earlier products take longer, so they finish last.
  const { products } = await scrapeAll(sources, async (s) => {
    await sleep(50 - Number(s.sku.slice(1)) * 5);
    return product(s);
  });
  assert.deepEqual(products.map((p) => p.sku), sources.map((s) => s.sku));
});

test("a failed product does not stop the run", async () => {
  const { products, failures } = await scrapeAll(sources, async (s) => {
    if (s.sku === "P3") throw new Error("boom");
    return product(s);
  });
  assert.equal(products.length, 9);
  assert.deepEqual(failures.map((f) => [f.sku, f.reason]), [["P3", "boom"]]);
});

test("stops and skips the rest when the site keeps blocking", async () => {
  const { products, failures } = await scrapeAll(sources, async (s) => {
    throw new BlockedError(s.sku);
  });
  const skipped = failures.filter((f) => f.reason.startsWith("skipped"));
  assert.equal(products.length, 0);
  assert.equal(failures.length, sources.length);
  assert.ok(skipped.length > 0, "the queue should stop before trying every product");
});

test("a blocked IP does not count as a failed attempt", async () => {
  const blocked = async (s: SourceProduct): Promise<Product> => {
    throw new BlockedError(s.sku);
  };
  await scrapeAll(sources, blocked);
  await scrapeAll(sources, blocked); // as many blocked runs as MAX_ATTEMPTS
  const { products, failures } = await scrapeAll(sources, async (s) => product(s));
  assert.equal(products.length, 10);
  assert.deepEqual(failures, []);
});

test("drops a resume state saved by an older version", () => {
  const file = path.join(tmp, "old-version.db");
  const old = new Sqlite(file);
  old.exec("CREATE TABLE products (id TEXT PRIMARY KEY, status TEXT, attempts INTEGER, data TEXT)");
  old.prepare(`INSERT INTO products VALUES ('P0', 'done', 0, '{"id":"P0"}')`).run();
  old.close();
  closeState();
  initState(file);
  assert.deepEqual(productState("P0"), { status: "pending", attempts: 0 });
});

test("resumes: a second run only scrapes what is missing and returns everything", async () => {
  await scrapeAll(sources, async (s) => {
    if (s.sku === "P3") throw new Error("boom");
    return product(s);
  });

  const scraped: string[] = [];
  const { products, failures } = await scrapeAll(sources, async (s) => {
    scraped.push(s.sku);
    return product(s);
  });
  assert.deepEqual(scraped, ["P3"]);
  assert.equal(products.length, 10);
  assert.equal(failures.length, 0);
});

test("abandons a product after MAX_ATTEMPTS failed runs", async () => {
  const failP3 = async (s: SourceProduct) => {
    if (s.sku === "P3") throw new Error("boom");
    return product(s);
  };
  await scrapeAll(sources, failP3);
  await scrapeAll(sources, failP3); // 2nd failure = MAX_ATTEMPTS

  const scraped: string[] = [];
  const { failures } = await scrapeAll(sources, async (s) => {
    scraped.push(s.sku);
    return product(s);
  });
  assert.deepEqual(scraped, []);
  assert.deepEqual(failures.map((f) => [f.sku, f.reason]), [["P3", "abandoned after 2 failed attempts"]]);
});
