// Product explorer: every scraped product, searchable by SKU or name, laid out
// like the store's page. Reads OUTPUT_DIR/output.json and run-report.json.
//   pnpm explorer   →   http://localhost:4321
// The page loads one product at a time from this API:
//   GET /api/summary        run metrics, failures and one line per product
//   GET /api/products/:sku  the product's record, exactly as in output.json
//   GET /api/variants/:sku  the product and the options selected for a variant SKU (C4592868)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUT_DIR } from "../src/config.js";
import type { Product } from "../src/types.js";

const PUBLIC = fileURLToPath(new URL("public/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

// Reads the output once, and again whenever a new run rewrites it.
function outputReader(outputDir: string) {
  const file = path.join(outputDir, "output.json");
  const reportFile = path.join(outputDir, "run-report.json");
  type VariantHit = { product_sku: string; sku: string; selected: Record<string, string> };
  let cache = { mtimeMs: -1, products: new Map<string, Product>(), variants: new Map<string, VariantHit>(), summary: "" };
  return () => {
    if (!fs.existsSync(file)) throw new Error(`${file} not found: run the scraper first (make dev)`);
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs === cache.mtimeMs) return cache;
    const products: Product[] = JSON.parse(fs.readFileSync(file, "utf8"));
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : {};
    const summary = {
      run: report.metrics ?? null,
      failures: report.failures ?? [],
      products: products.map((p) => ({
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        starting_at: p.starting_at,
        badge: p.badge,
        required: p.customize.required,
        variants: p.variants.length,
        customizations: p.customize.dropdowns.length,
        images: p.images.length,
      })),
    };
    const variants = new Map(
      products.flatMap((p) =>
        p.variants.map((v) => [v.sku.toUpperCase(), { product_sku: p.sku, sku: v.sku, selected: v.selected }] as const),
      ),
    );
    cache = { mtimeMs, products: new Map(products.map((p) => [p.sku, p])), variants, summary: JSON.stringify(summary) };
    return cache;
  };
}

export function createExplorer(outputDir: string = OUTPUT_DIR): http.Server {
  const output = outputReader(outputDir);
  return http.createServer((req, res) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
      res.end(body);
    };
    try {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");
      if (pathname === "/api/summary") return send(200, "application/json", output().summary);
      const productSku = pathname.match(/^\/api\/products\/(.+)$/)?.[1];
      if (productSku !== undefined) {
        const product = output().products.get(decodeURIComponent(productSku));
        return product ? send(200, "application/json", JSON.stringify(product, null, 2)) : send(404, "text/plain", "Not found");
      }
      const sku = pathname.match(/^\/api\/variants\/(.+)$/)?.[1];
      if (sku !== undefined) {
        const hit = output().variants.get(decodeURIComponent(sku).trim().toUpperCase());
        return hit ? send(200, "application/json", JSON.stringify(hit)) : send(404, "text/plain", "Not found");
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      const type = TYPES[path.extname(file)];
      if (type && !file.includes("..") && fs.existsSync(PUBLIC + file)) return send(200, type, fs.readFileSync(PUBLIC + file));
      send(404, "text/plain", "Not found");
    } catch (err) {
      send(500, "text/plain", err instanceof Error ? err.message : String(err));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4321);
  createExplorer().listen(port, "127.0.0.1", () => console.log(`Explorer: http://localhost:${port}  (Ctrl+C to stop)`));
}
