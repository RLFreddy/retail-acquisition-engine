import fs from "node:fs";
import path from "node:path";
import type { Failure, Product } from "../types.js";

// Every cell quoted and inner quotes doubled (RFC 4180).
const toCsvRow = (cells: unknown[]): string =>
  cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");

const writeCsv = (file: string, header: string[], rows: unknown[][]): void =>
  fs.writeFileSync(file, [header, ...rows].map(toCsvRow).join("\n"));

export function writeOutputs(
  dir: string,
  products: Product[],
  failures: Failure[],
  metrics: object,
): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    json: path.join(dir, "output.json"),
    report: path.join(dir, "run-report.json"),
    variants: path.join(dir, "variants.csv"),
    customizations: path.join(dir, "customizations.csv"),
  };

  fs.writeFileSync(files.json, JSON.stringify(products, null, 2));
  fs.writeFileSync(files.report, JSON.stringify({ metrics, failures }, null, 2));

  // One row per variant and per customization option, led by their product.
  writeCsv(
    files.variants,
    ["product_sku", "product_name", "sku", "options", "base_price", "upcharge", "price", "pricing_unit"],
    products.flatMap((p) =>
      p.variants.map((v) => [
        p.sku,
        p.name,
        v.sku,
        JSON.stringify(v.options),
        p.base_price,
        v.upcharge,
        v.price,
        p.pricing_unit,
      ]),
    ),
  );

  writeCsv(
    files.customizations,
    ["product_sku", "product_name", "customization", "required", "option", "upcharge", "pricing_unit"],
    products.flatMap((p) =>
      p.customizations.flatMap((c) =>
        c.options.map((o) => [p.sku, p.name, c.name, c.required, o.name, o.upcharge, p.pricing_unit]),
      ),
    ),
  );

  return Object.values(files);
}
