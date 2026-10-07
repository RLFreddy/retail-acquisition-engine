import { CONCURRENCY, INPUT_CSV, LIMIT, OUTPUT_DIR } from "./config.js";
import { loadProducts } from "./lib/csv.js";
import { getRequestCount } from "./lib/http.js";
import { log, LOG_FILE } from "./lib/log.js";
import { formatDuration } from "./lib/time.js";
import { writeOutputs } from "./lib/output.js";
import { buildMetrics } from "./scrape/metrics.js";
import { scrapeAll } from "./scrape/scrape-all.js";

async function main(): Promise<void> {
  const allProducts = await loadProducts(INPUT_CSV);
  const sources = LIMIT > 0 ? allProducts.slice(0, LIMIT) : allProducts;
  log.info(
    { event: "run_started", input: INPUT_CSV, products: sources.length, concurrency: CONCURRENCY },
    `Starting the scraper · ${sources.length} of ${allProducts.length} products · concurrency ${CONCURRENCY}`,
  );

  const start = performance.now();
  const { products, failures } = await scrapeAll(sources);
  const totalMs = performance.now() - start;

  const metrics = buildMetrics(products, failures, totalMs);
  const files = writeOutputs(OUTPUT_DIR, products, failures, metrics);
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  log.info({ event: "run_finished", ...metrics }, "All products processed. Final statistics:");
  log.info(
    `finished ${products.length} · failed ${failures.length} · ${Math.round(metrics.products_per_minute)}/min · ` +
      `p50 ${seconds(metrics.product_ms.p50)} · p95 ${seconds(metrics.product_ms.p95)} · ` +
      `${getRequestCount()} requests · total ${formatDuration(totalMs)}`,
  );
  log.info(`Output: ${[...files, LOG_FILE].join(", ")}`);
}

main().catch((err) => {
  log.error({ event: "fatal", err }, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
