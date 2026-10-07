import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Config is read at import time: set it first, then import the module.
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rae-http-"));
process.env.RETRIES = "2";
process.env.RETRY_DELAY_MS = "1";
const { BlockedError, fetchHtml } = await import("../src/lib/http.js");

const hits: Record<string, number> = {};
const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  hits[url] = (hits[url] ?? 0) + 1;
  const status =
    { "/ok": 200, "/missing": 404, "/blocked": 406, "/bad": 400 }[url] ??
    (url === "/flaky" && hits[url]! <= 2 ? 503 : 200);
  res.writeHead(status).end(`<html>${url}</html>`);
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("returns the HTML on 200", async () => {
  assert.equal(await fetchHtml(`${base}/ok`), "<html>/ok</html>");
});

test("returns null on 404 without retrying", async () => {
  assert.equal(await fetchHtml(`${base}/missing`), null);
  assert.equal(hits["/missing"], 1);
});

test("retries transient errors until it succeeds", async () => {
  assert.equal(await fetchHtml(`${base}/flaky`), "<html>/flaky</html>");
  assert.equal(hits["/flaky"], 3);
});

test("throws BlockedError when 406 survives every retry", async () => {
  await assert.rejects(fetchHtml(`${base}/blocked`), BlockedError);
  assert.equal(hits["/blocked"], 3); // 1 attempt + RETRIES
});

test("does not retry other client errors", async () => {
  await assert.rejects(fetchHtml(`${base}/bad`));
  assert.equal(hits["/bad"], 1);
});
