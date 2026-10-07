import { CONCURRENCY, DELAY_MS, MAX_FAILURE_RATE } from "../config.js";
import { getRequestCount } from "../lib/http.js";
import { roundMs } from "../lib/time.js";
import type { Failure, Product } from "../types.js";

// Nearest-rank percentile over an ascending-sorted list, p in 0..1.
const percentile = (sorted: number[], p: number): number =>
  roundMs(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0);

// A run fails when nothing was extracted or too many products failed
// (blocked IP, site layout changed…), so schedulers and CI notice it.
export const passesQualityCheck = (ok: number, failed: number, maxFailureRate = MAX_FAILURE_RATE): boolean =>
  ok > 0 && failed / (ok + failed) <= maxFailureRate;

export function buildMetrics(products: Product[], failures: Failure[], startedAt: Date, totalMs: number) {
  // Speed counts only this run: products resumed from an earlier run took no time now.
  const fresh = products.filter((p) => p.scraped_at >= startedAt.toISOString());
  const times = fresh.map((p) => p.extraction_time_ms).sort((a, b) => a - b);
  const count = (has: (p: Product) => boolean) => products.filter(has).length;
  return {
    started_at: startedAt.toISOString(),
    finished_at: new Date(startedAt.getTime() + totalMs).toISOString(),
    total_ms: roundMs(totalMs),
    concurrency: CONCURRENCY,
    delay_ms: DELAY_MS,
    products: products.length + failures.length,
    ok: products.length,
    failed: failures.length,
    resumed: products.length - fresh.length,
    http_requests: getRequestCount(),
    products_per_minute: roundMs(((fresh.length + failures.length) / totalMs) * 60_000),
    product_ms: {
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      max: percentile(times, 1),
    },
    variants: products.reduce((n, p) => n + p.variants.length, 0),
    customization_options: products.reduce((n, p) => n + p.customizations.reduce((m, c) => m + c.options.length, 0), 0),
    // Products with each part: a drop between runs points to a site change
    // that left a field empty without failing the product.
    coverage: {
      variants: count((p) => p.variants.length > 0),
      customizations: count((p) => p.customizations.length > 0),
      description: count((p) => p.description !== ""),
      specs: count((p) => p.specs.length > 0),
      images: count((p) => p.media.images.length > 0),
      videos: count((p) => p.media.videos.length > 0),
    },
  };
}
