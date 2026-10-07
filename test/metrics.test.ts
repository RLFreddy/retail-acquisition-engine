import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Config is read at import time: set it first, then import the module.
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rae-metrics-"));
const { passesQualityCheck } = await import("../src/scrape/metrics.js");

test("quality check: passes with few failures, fails when nothing or too much fails", () => {
  assert.equal(passesQualityCheck(696, 4), true);
  assert.equal(passesQualityCheck(0, 700), false);
  assert.equal(passesQualityCheck(600, 100), false); // 14% > 10%
});
