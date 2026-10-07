import { CONCURRENCY, INPUT_CSV, LIMIT, OUTPUT_DIR } from "./config.js";
import { loadProducts } from "./lib/csv.js";
import { requestsSent } from "./lib/http.js";
import { log, LOG_FILE } from "./lib/log.js";
import { writeOutputs } from "./lib/output.js";
import { buildMetrics } from "./scrape/metrics.js";
import { run } from "./scrape/run.js";

async function main(): Promise<void> {
  const all = await loadProducts(INPUT_CSV);
  const sources = LIMIT > 0 ? all.slice(0, LIMIT) : all;
  log.info(
    { event: "run_started", input: INPUT_CSV, products: sources.length, concurrency: CONCURRENCY },
    `${all.length} unique products · scraping ${sources.length} · concurrency ${CONCURRENCY}`,
  );

  const start = performance.now();
  const { products, failures } = await run(sources);
  const totalMs = performance.now() - start;

  const metrics = buildMetrics(products, failures, totalMs);
  const files = writeOutputs(OUTPUT_DIR, products, failures, metrics);
  log.info(
    { event: "run_finished", ...metrics },
    `Done in ${(totalMs / 1000).toFixed(1)}s · ${products.length} ok · ${failures.length} failed · ${requestsSent()} requests`,
  );
  for (const file of [...files, LOG_FILE]) log.info(`→ ${file}`);
}

main().catch((err) => {
  log.error({ event: "fatal", err }, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
