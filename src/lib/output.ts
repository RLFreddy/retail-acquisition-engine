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

  writeCsv(
    files.variants,
    ["id", "name", "sku", "options", "base_price", "price_modifier", "final_price", "pricing_unit"],
    products.flatMap((p) =>
      p.variants.map((v) => [
        p.id,
        p.name,
        v.sku,
        JSON.stringify(v.options),
        p.base_price,
        v.price_modifier,
        v.final_price,
        p.pricing_unit,
      ]),
    ),
  );

  writeCsv(
    files.customizations,
    ["id", "name", "category", "option_name", "price_modifier", "final_price", "pricing_unit"],
    products.flatMap((p) =>
      p.customizations.map((c) => [
        p.id,
        p.name,
        c.category,
        c.option_name,
        c.price_modifier,
        c.final_price,
        p.pricing_unit,
      ]),
    ),
  );

  return Object.values(files);
}
