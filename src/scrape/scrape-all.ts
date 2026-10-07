import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS } from "../config.js";
import { BlockedError } from "../lib/http.js";
import { log } from "../lib/log.js";
import { formatDuration } from "../lib/time.js";
import type { Failure, Product, SourceProduct } from "../types.js";
import { buildProductUrl, scrapeProduct } from "./scrape-product.js";

const MAX_CONSECUTIVE_BLOCKS = 3; // before stopping the run

// Once the IP is blocked, retrying the rest would only hammer the site.
function stopRun(queue: PQueue): void {
  if (queue.isPaused) return;
  log.error(
    { event: "run_stopped", remaining: queue.size },
    `⛔ The site is blocking this IP (${MAX_CONSECUTIVE_BLOCKS} products in a row) — stopping. A US IP is required.`,
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
  const startedAt = performance.now();

  // [120/700 · 17% · ~5m 2s left]: the estimate assumes the remaining
  // products take as long, on average, as the finished ones.
  const nextProgress = () => {
    const finished = ++finishedCount;
    const total = sources.length;
    const left = ((performance.now() - startedAt) / finished) * (total - finished);
    const eta = finished < total ? ` · ~${formatDuration(left)} left` : "";
    return `[${finished}/${total} · ${Math.floor((finished / total) * 100)}%${eta}]`;
  };

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
        { event: "product_ok", id: source.id, variants: variants.length, customizations: customizations.length, ms },
        `${nextProgress()} ✓ ${source.id} · ${variants.length} variants · ${customizations.length} options · ${ms}ms`,
      );
    } catch (err) {
      const failure = fail(source, err instanceof Error ? err.message : String(err));
      log.warn({ event: "product_failed", ...failure }, `${nextProgress()} ✗ ${source.id} · ${failure.reason}`);
      if (err instanceof BlockedError && ++consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) stopRun(queue);
    }
  };

  for (const source of sources) void queue.add(() => task(source));
  await queue.onIdle();

  const attempted = new Set([...products, ...failures].map((p) => p.id));
  for (const source of sources) {
    if (!attempted.has(source.id)) fail(source, "skipped: run stopped, site blocking requests");
  }

  // Workers finish out of order.
  const order = new Map(sources.map((s, i) => [s.id, i]));
  products.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { products, failures };
}
