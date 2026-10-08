import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadProducts } from "../src/lib/csv.js";
import { writeOutputs } from "../src/lib/output.js";
import type { Product } from "../src/types.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rae-csv-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("input CSV: Parent Item is the SKU, behind Excel's BOM too; repeated SKUs are skipped", async () => {
  const file = path.join(dir, "input.csv");
  fs.writeFileSync(
    file,
    "\uFEFFParent Item,Name,Model,Category,Brand\n" +
      "PRO S4 STS,Mizuno Pro S-4 Iron Set,Pro S-4,Iron Set,Mizuno\n" +
      "PRO S4 STS,Mizuno Pro S-4 Iron Set,Pro S-4,Iron Set,Mizuno\n",
  );
  assert.deepEqual(await loadProducts(file), [
    { sku: "PRO S4 STS", name: "Mizuno Pro S-4 Iron Set", brand: "Mizuno", category: "Iron Set", model: "Pro S-4" },
  ]);
});

test("output CSVs: one row per variant and per customization option, led by their product", () => {
  const product = {
    sku: "PRO S4 STS",
    name: "Mizuno Pro S-4 Iron Set",
    starting_at: 215,
    per_club: true,
    variants: [{ sku: "C4605039", selected: { Dexterity: "Left Handed" }, product_price: 275, ships_in_days: 21 }],
    customize: { required: false, dropdowns: [{ label: "Ferrule", options: [{ name: "ICON (Black/Blue/White)", price: 2.5 }] }] },
  } as unknown as Product;
  writeOutputs(dir, [product], [], {});
  const lines = (file: string) => fs.readFileSync(path.join(dir, file), "utf8").split("\n");
  assert.deepEqual(lines("variants.csv"), [
    '"product_sku","product_name","sku","selected","starting_at","product_price","ships_in_days","per_club"',
    '"PRO S4 STS","Mizuno Pro S-4 Iron Set","C4605039","{""Dexterity"":""Left Handed""}","215","275","21","true"',
  ]);
  assert.deepEqual(lines("customizations.csv"), [
    '"product_sku","product_name","required","dropdown","option","price","per_club"',
    '"PRO S4 STS","Mizuno Pro S-4 Iron Set","false","Ferrule","ICON (Black/Blue/White)","2.5","true"',
  ]);
});
