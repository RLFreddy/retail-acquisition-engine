import { CONCURRENCY, DELAY_MS, INPUT_CSV, LIMIT, OUTPUT_DIR } from "./config.ts";
import { loadProducts } from "./lib/csv.ts";
import { getRequestCount } from "./lib/http.ts";
import { log, LOG_FILE } from "./lib/log.ts";
import { writeOutputs } from "./lib/output.ts";
import { closeState, DB_PATH, initState } from "./lib/state.ts";
import { formatDuration } from "./lib/time.ts";
import { buildMetrics, passesQualityCheck } from "./scrape/metrics.ts";
import { scrapeAll } from "./scrape/scrape-all.ts";

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
      data: { input: INPUT_CSV, products: sources.length, concurrency: CONCURRENCY, delay_ms: DELAY_MS, state: DB_PATH },
    },
    "Starting the scraper.",
  );

  const startedAt = new Date();
  const start = performance.now();
  const { products, failures } = await scrapeAll(sources);
  const totalMs = performance.now() - start;

  const metrics = buildMetrics(products, failures, startedAt, totalMs);
  const files = writeOutputs(OUTPUT_DIR, products, failures, metrics);
  log.info("All products have been processed, the scraper will shut down.");
  log.info({ event: "run_finished", data: metrics }, "Final request statistics:");
  log.info(
    `Finished! Total ${products.length + failures.length} products: ` +
      `${products.length} succeeded, ${failures.length} failed (${getRequestCount()} requests, ${formatDuration(totalMs)}).`,
  );
  log.info({ data: { files: [...files, LOG_FILE] } }, "Output saved:");

  if (!passesQualityCheck(products.length, failures.length)) {
    const total = products.length + failures.length;
    log.error(
      { event: "quality_check_failed", data: { ok: products.length, failed: failures.length } },
      `Run failed the quality check: ${failures.length} of ${total} products failed.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    log.error({ event: "fatal", err }, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closeState);
