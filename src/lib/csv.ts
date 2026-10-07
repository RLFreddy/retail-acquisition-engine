import fs from "node:fs";
import csv from "csv-parser";
import type { SourceProduct } from "../types.js";

export async function loadProducts(file: string): Promise<SourceProduct[]> {
  if (!fs.existsSync(file)) throw new Error(`input CSV not found: ${file}`);
  const products = new Map<string, SourceProduct>();
  const rows = fs.createReadStream(file).pipe(
    // Strip the BOM that Excel adds to the first header.
    csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, "").trim() }),
  );

  for await (const row of rows as AsyncIterable<Record<string, string>>) {
    const get = (key: string) => row[key]?.trim() ?? "";
    const id = get("Parent Item") || get("Name");
    if (!id || products.has(id)) continue;
    products.set(id, {
      id,
      name: get("Name") || id,
      brand: get("Brand"),
      category: get("Category"),
      model: get("Model"),
    });
  }
  return [...products.values()];
}
