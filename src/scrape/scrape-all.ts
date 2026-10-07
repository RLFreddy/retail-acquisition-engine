import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS, MAX_ATTEMPTS } from "../config.js";
import { BlockedError } from "../lib/http.js";
import { log } from "../lib/log.js";
import { doneProducts, markDone, markFailed, productState } from "../lib/state.js";
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

const toFailure = (source: SourceProduct, reason: string): Failure => ({
  id: source.id,
  name: source.name,
  url: buildProductUrl(source.id),
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
    const { status, attempts } = productState(source.id);
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
      markFailed(source.id);
      const failure = toFailure(source, err instanceof Error ? err.message : String(err));
      failures.push(failure);
      log.error(
        { event: "product_failed", reason: failure.reason, data: { id: failure.id, url: failure.url } },
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
  const order = new Map(sources.map((s, i) => [s.id, i]));
  const products = doneProducts().filter((p) => order.has(p.id));
  const reported = new Set([...products, ...failures].map((p) => p.id));
  for (const source of pending) {
    if (!reported.has(source.id)) failures.push(toFailure(source, "skipped: run stopped, site blocking requests"));
  }

  products.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { products, failures };
}
