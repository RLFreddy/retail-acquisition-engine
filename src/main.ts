import { CONCURRENCY, INPUT_CSV, LIMIT, OUTPUT_DIR } from "./config.js";
import { loadProducts } from "./lib/csv.js";
import { getRequestCount } from "./lib/http.js";
import { log, LOG_FILE } from "./lib/log.js";
import { writeOutputs } from "./lib/output.js";
import { closeState, DB_PATH, initState } from "./lib/state.js";
import { formatDuration } from "./lib/time.js";
import { buildMetrics } from "./scrape/metrics.js";
import { scrapeAll } from "./scrape/scrape-all.js";

// Ctrl+C: every finished product is already saved, so just close the state
// and say how to continue.
function onInterrupt(signal: string): void {
  log.warn({ event: "interrupted", signal }, `${signal} received. Progress is saved; run again to resume.`);
  closeState();
  process.exit(130);
}

async function main(): Promise<void> {
  initState();
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  const allProducts = await loadProducts(INPUT_CSV);
  const sources = LIMIT > 0 ? allProducts.slice(0, LIMIT) : allProducts;
  log.info(
    {
      event: "run_started",
      data: { input: INPUT_CSV, products: sources.length, concurrency: CONCURRENCY, state: DB_PATH },
    },
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
  log.info({ data: { files: [...files, LOG_FILE] } }, "Output saved:");
}

main()
  .catch((err) => {
    log.error({ event: "fatal", err }, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closeState);
