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
    { event: "run_started", data: { input: INPUT_CSV, products: sources.length, concurrency: CONCURRENCY } },
    "Starting the scraper.",
  );

  const start = performance.now();
  const { products, failures } = await scrapeAll(sources);
  const totalMs = performance.now() - start;

  const metrics = buildMetrics(products, failures, totalMs);
  const files = writeOutputs(OUTPUT_DIR, products, failures, metrics);
  log.info("All products have been processed, the scraper will shut down.");
  log.info({ event: "run_finished", data: metrics }, "Final request statistics:");
  log.info(
    `Finished! Total ${products.length + failures.length} products: ` +
      `${products.length} succeeded, ${failures.length} failed (${getRequestCount()} requests, ${formatDuration(totalMs)}).`,
  );
  log.info({ data: [...files, LOG_FILE] }, "Output saved:");
}

main().catch((err) => {
  log.error({ event: "fatal", err }, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
