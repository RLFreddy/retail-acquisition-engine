import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS } from "../config.js";
import { BlockedError } from "../lib/http.js";
import { log } from "../lib/log.js";
import type { Failure, Product, SourceProduct } from "../types.js";
import { productUrl, scrapeProduct } from "./product.js";

const MAX_BLOCKED = 3; // consecutive blocked products before stopping the run

// Once the IP is blocked, retrying the rest would only hammer the site.
function stopRun(queue: PQueue): void {
  if (queue.isPaused) return;
  log.error(
    { event: "run_stopped", remaining: queue.size },
    `⛔ The site is blocking this IP (${MAX_BLOCKED} products in a row) — stopping. A US IP is required.`,
  );
  queue.pause();
  queue.clear();
}

export async function run(
  sources: SourceProduct[],
  scrape: (source: SourceProduct) => Promise<Product> = scrapeProduct,
): Promise<{ products: Product[]; failures: Failure[] }> {
  const products: Product[] = [];
  const failures: Failure[] = [];
  const queue = new PQueue({ concurrency: CONCURRENCY, interval: DELAY_MS, intervalCap: 1 });
  let done = 0;
  let blocked = 0;

  const fail = (source: SourceProduct, reason: string): Failure => {
    const failure = { id: source.id, name: source.name, url: productUrl(source.id), reason };
    failures.push(failure);
    return failure;
  };

  const task = async (source: SourceProduct) => {
    const tag = () => `[${++done}/${sources.length}]`;
    try {
      const product = await scrape(source);
      products.push(product);
      blocked = 0;
      const { variants, customizations, extraction_time_ms: ms } = product;
      log.info(
        { event: "product_ok", id: source.id, variants: variants.length, customizations: customizations.length, ms },
        `${tag()} ✓ ${source.id} · ${variants.length} variants · ${customizations.length} options · ${ms}ms`,
      );
    } catch (err) {
      const failure = fail(source, err instanceof Error ? err.message : String(err));
      log.warn({ event: "product_failed", ...failure }, `${tag()} ✗ ${source.id} · ${failure.reason}`);
      if (err instanceof BlockedError && ++blocked >= MAX_BLOCKED) stopRun(queue);
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
