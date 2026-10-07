import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Product } from "../src/types.js";

// Config is read at import time: set it first, then import the module.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rae-metrics-"));
process.env.OUTPUT_DIR = tmp;
const { buildMetrics, passesQualityCheck } = await import("../src/scrape/metrics.js");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("quality check: passes with few failures, fails when nothing or too much fails", () => {
  assert.equal(passesQualityCheck(696, 4, 0.1), true);
  assert.equal(passesQualityCheck(0, 700, 0.1), false);
  assert.equal(passesQualityCheck(600, 100, 0.1), false); // 14% > 10%
});

test("speed counts only this run; coverage counts every product", () => {
  const record = (scraped_at: string, ms: number) =>
    ({
      scraped_at,
      extraction_time_ms: ms,
      variants: [{}],
      customizations: [],
      description: "Who’s It For?",
      specs: [],
      media: { images: ["a.jpg"], videos: [] },
    }) as unknown as Product;
  const resumed = record("2026-10-06T10:00:00.000Z", 9000);
  const fresh = record("2026-10-07T22:00:30.000Z", 2000);
  const metrics = buildMetrics([resumed, fresh], [], new Date("2026-10-07T22:00:00.000Z"), 60_000);
  assert.equal(metrics.resumed, 1);
  assert.equal(metrics.products_per_minute, 1);
  assert.equal(metrics.product_ms.max, 2000);
  assert.deepEqual(metrics.coverage, { variants: 2, customizations: 0, description: 2, specs: 0, images: 2, videos: 0 });
});
