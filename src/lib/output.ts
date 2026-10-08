import fs from "node:fs";
import path from "node:path";
import type { Failure, Product } from "../types.ts";

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
    ["product_sku", "product_name", "sku", "selected", "starting_at", "product_price", "ships_in_days", "per_club"],
    products.flatMap((p) =>
      p.variants.map((v) => [
        p.sku,
        p.name,
        v.sku,
        JSON.stringify(v.selected),
        p.starting_at,
        v.product_price,
        v.ships_in_days ?? "",
        p.per_club,
      ]),
    ),
  );

  writeCsv(
    files.customizations,
    ["product_sku", "product_name", "required", "dropdown", "option", "price", "per_club"],
    products.flatMap((p) =>
      p.customize.dropdowns.flatMap((d) =>
        d.options.map((o) => [p.sku, p.name, p.customize.required, d.label, o.name, o.price, p.per_club]),
      ),
    ),
  );

  return Object.values(files);
}
