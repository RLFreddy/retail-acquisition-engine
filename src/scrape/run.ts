import PQueue from "p-queue";
import { CONCURRENCY, DELAY_MS } from "../config.js";
import { BlockedError } from "../lib/http.js";
import { log } from "../lib/log.js";
import type { Failure, Product, SourceProduct } from "../types.js";
import { productUrl, scrapeProduct } from "./product.js";

const MAX_BLOCKED = 3; // consecutive blocked products before stopping the run

export async function run(
  sources: SourceProduct[],
): Promise<{ products: Product[]; failures: Failure[] }> {
  const products: Product[] = [];
  const failures: Failure[] = [];
  const queue = new PQueue({ concurrency: CONCURRENCY, interval: DELAY_MS, intervalCap: 1 });
  let done = 0;
  let blocked = 0;

  const fail = (source: SourceProduct, reason: string) =>
    failures.push({ id: source.id, name: source.name, url: productUrl(source.id), reason });

  const task = async (source: SourceProduct) => {
    const tag = () => `[${++done}/${sources.length}]`;
    try {
      const product = await scrapeProduct(source);
      products.push(product);
      blocked = 0;
      log.info(
        {
          event: "product_ok",
          id: source.id,
          variants: product.variants.length,
          customizations: product.customizations.length,
          ms: product.extraction_time_ms,
        },
        `${tag()} ✓ ${source.id} · ${product.variants.length} variants · ${product.customizations.length} options · ${product.extraction_time_ms}ms`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fail(source, reason);
      log.warn(
        { event: "product_failed", id: source.id, url: productUrl(source.id), reason },
        `${tag()} ✗ ${source.id} · ${reason}`,
      );

      // Once the IP is blocked, retrying the rest would only hammer the site.
      if (err instanceof BlockedError && ++blocked >= MAX_BLOCKED && !queue.isPaused) {
        log.error(
          { event: "run_stopped", remaining: queue.size },
          `⛔ The site is blocking this IP (${MAX_BLOCKED} products in a row) — stopping. A US IP is required.`,
        );
        queue.pause();
        queue.clear();
      }
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
