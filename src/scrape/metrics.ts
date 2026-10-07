import { CONCURRENCY } from "../config.js";
import { requestsSent } from "../lib/http.js";
import { roundMs } from "../lib/time.js";
import type { Failure, Product } from "../types.js";

// Nearest-rank percentile over an ascending-sorted list, p in 0..1.
const percentile = (sorted: number[], p: number): number =>
  roundMs(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0);

export function buildMetrics(products: Product[], failures: Failure[], totalMs: number) {
  const total = products.length + failures.length;
  const times = products.map((p) => p.extraction_time_ms).sort((a, b) => a - b);
  return {
    total_ms: roundMs(totalMs),
    concurrency: CONCURRENCY,
    products: total,
    ok: products.length,
    failed: failures.length,
    http_requests: requestsSent(),
    products_per_minute: roundMs((total / totalMs) * 60_000),
    product_ms: {
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      max: percentile(times, 1),
    },
    variants: products.reduce((n, p) => n + p.variants.length, 0),
    customizations: products.reduce((n, p) => n + p.customizations.length, 0),
  };
}
