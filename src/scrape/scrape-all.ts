import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS, MAX_ATTEMPTS } from "../config.ts";
import { BlockedError } from "../lib/http.ts";
import { log } from "../lib/log.ts";
import { doneProducts, markDone, markFailed, productState } from "../lib/state.ts";
import type { Failure, Product, SourceProduct } from "../types.ts";
import { buildProductUrl, scrapeProduct } from "./scrape-product.ts";

const MAX_CONSECUTIVE_BLOCKS = 3; // before stopping the run
const STATUS_INTERVAL_MS = 60_000; // like Crawlee's periodic statistics

// Once the IP is blocked, retrying the rest would only hammer the site.
function stopRun(queue: PQueue): void {
  if (queue.isPaused) return;
  log.error(
    { event: "run_stopped", data: { consecutiveBlocks: MAX_CONSECUTIVE_BLOCKS, remaining: queue.size } },
    "The site is blocking this IP, stopping the scraper. Try a US IP, for example through a VPN.",
  );
  queue.pause();
  queue.clear();
}

const toFailure = (source: SourceProduct, reason: string): Failure => ({
  sku: source.sku,
  name: source.name,
  url: buildProductUrl(source.sku),
  reason,
});

// Requires initState(). Products done in earlier runs are skipped and come
// back from the state; products that failed MAX_ATTEMPTS times are abandoned.
export async function scrapeAll(
  sources: SourceProduct[],
  scrape: (source: SourceProduct) => Promise<Product> = scrapeProduct,
): Promise<{ products: Product[]; failures: Failure[] }> {
  const failures: Failure[] = [];
  const pending: SourceProduct[] = [];
  for (const source of sources) {
    const { status, attempts } = productState(source.sku);
    if (status === "done") continue;
    if (attempts >= MAX_ATTEMPTS) failures.push(toFailure(source, `abandoned after ${attempts} failed attempts`));
    else pending.push(source);
  }
  const resumedCount = sources.length - pending.length - failures.length;
  if (pending.length < sources.length) {
    log.info(
      { event: "resumed", data: { done: resumedCount, abandoned: failures.length, pending: pending.length } },
      "Resuming the previous run.",
    );
  }

  const queue = new PQueue({ concurrency: CONCURRENCY, interval: DELAY_MS, intervalCap: 1 });
  let finishedCount = sources.length - pending.length;
  let consecutiveBlocks = 0;
  const nextProgress = () => `[${++finishedCount}/${sources.length}]`;

  const startedAt = performance.now();
  const startCount = finishedCount;
  const status = setInterval(() => {
    const perMinute = Math.round((finishedCount - startCount) / ((performance.now() - startedAt) / 60_000));
    log.info(
      { event: "status", finished: finishedCount, failed: failures.length },
      `Crawled ${finishedCount}/${sources.length} products, ${failures.length} failed requests, ${perMinute}/min.`,
    );
  }, STATUS_INTERVAL_MS);

  const task = async (source: SourceProduct) => {
    try {
      const product = await scrape(source);
      markDone(product);
      consecutiveBlocks = 0;
      const { variants, customize, extraction_time_ms: ms } = product;
      const customizationOptions = customize.dropdowns.reduce((n, d) => n + d.options.length, 0);
      log.info(
        {
          event: "product_ok",
          sku: source.sku,
          data: { variants: variants.length, customization_options: customizationOptions, ms: Math.round(ms) },
        },
        `${nextProgress()} ${source.sku}`,
      );
    } catch (err) {
      // A blocked IP says nothing about the product: it stays pending for the next run.
      if (!(err instanceof BlockedError)) markFailed(source.sku);
      const failure = toFailure(source, err instanceof Error ? err.message : String(err));
      failures.push(failure);
      log.error(
        { event: "product_failed", reason: failure.reason, data: { sku: failure.sku, url: failure.url } },
        `${nextProgress()} Request failed. ${failure.reason}`,
      );
      if (err instanceof BlockedError && ++consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) stopRun(queue);
    }
  };

  for (const source of pending) void queue.add(() => task(source));
  await queue.onIdle();
  clearInterval(status);

  // Products never started because the run was stopped stay pending in the
  // state, so the next run picks them up.
  const order = new Map(sources.map((s, i) => [s.sku, i]));
  const products = doneProducts().filter((p) => order.has(p.sku));
  const reported = new Set([...products, ...failures].map((p) => p.sku));
  for (const source of pending) {
    if (!reported.has(source.sku)) failures.push(toFailure(source, "skipped: run stopped, site blocking requests"));
  }

  products.sort((a, b) => order.get(a.sku)! - order.get(b.sku)!);
  return { products, failures };
}
