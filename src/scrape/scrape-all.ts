import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS } from "../config.js";
import { BlockedError } from "../lib/http.js";
import { log } from "../lib/log.js";
import type { Failure, Product, SourceProduct } from "../types.js";
import { buildProductUrl, scrapeProduct } from "./scrape-product.js";

const MAX_CONSECUTIVE_BLOCKS = 3; // before stopping the run
const STATUS_INTERVAL_MS = 60_000; // like Crawlee's periodic statistics

// Once the IP is blocked, retrying the rest would only hammer the site.
function stopRun(queue: PQueue): void {
  if (queue.isPaused) return;
  log.error(
    { event: "run_stopped", data: { consecutiveBlocks: MAX_CONSECUTIVE_BLOCKS, remaining: queue.size } },
    "The site is blocking this IP, stopping the scraper. A US IP is required.",
  );
  queue.pause();
  queue.clear();
}

export async function scrapeAll(
  sources: SourceProduct[],
  scrape: (source: SourceProduct) => Promise<Product> = scrapeProduct,
): Promise<{ products: Product[]; failures: Failure[] }> {
  const products: Product[] = [];
  const failures: Failure[] = [];
  const queue = new PQueue({ concurrency: CONCURRENCY, interval: DELAY_MS, intervalCap: 1 });
  let finishedCount = 0;
  let consecutiveBlocks = 0;

  const nextProgress = () => `[${++finishedCount}/${sources.length}]`;

  const startedAt = performance.now();
  const status = setInterval(() => {
    const perMinute = Math.round(finishedCount / ((performance.now() - startedAt) / 60_000));
    log.info(
      { event: "status", finished: finishedCount, failed: failures.length },
      `Crawled ${finishedCount}/${sources.length} products, ${failures.length} failed requests, ${perMinute}/min.`,
    );
  }, STATUS_INTERVAL_MS);

  const fail = (source: SourceProduct, reason: string): Failure => {
    const failure = { id: source.id, name: source.name, url: buildProductUrl(source.id), reason };
    failures.push(failure);
    return failure;
  };

  const task = async (source: SourceProduct) => {
    try {
      const product = await scrape(source);
      products.push(product);
      consecutiveBlocks = 0;
      const { variants, customizations, extraction_time_ms: ms } = product;
      log.info(
        {
          event: "product_ok",
          id: source.id,
          data: { variants: variants.length, options: customizations.length, ms: Math.round(ms) },
        },
        `${nextProgress()} ${source.id}`,
      );
    } catch (err) {
      const failure = fail(source, err instanceof Error ? err.message : String(err));
      log.error(
        { event: "product_failed", reason: failure.reason, data: { id: failure.id, url: failure.url } },
        `${nextProgress()} Request failed. ${failure.reason}`,
      );
      if (err instanceof BlockedError && ++consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) stopRun(queue);
    }
  };

  for (const source of sources) void queue.add(() => task(source));
  await queue.onIdle();
  clearInterval(status);

  const attempted = new Set([...products, ...failures].map((p) => p.id));
  for (const source of sources) {
    if (!attempted.has(source.id)) fail(source, "skipped: run stopped, site blocking requests");
  }

  // Workers finish out of order.
  const order = new Map(sources.map((s, i) => [s.id, i]));
  products.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { products, failures };
}
