// Output fields are snake_case on purpose: they are the file contract. Each one
// is named after what a shopper sees on the product page.

export interface SourceProduct {
  sku: string; // "Parent Item" column, which is the site's SKU
  name: string;
  brand: string;
  category: string;
  model: string;
}

// A dropdown of the page: its label and the options it lists.
export interface Dropdown {
  label: string;
  options: string[];
}

// A dropdown of the Customize section; an option's price is the "+ $2.50"
// shown next to it.
export interface CustomizeDropdown {
  label: string;
  options: { name: string; price: number }[];
}

// A combination of the dropdowns that the store sells as its own SKU.
export interface Variant {
  sku: string;
  selected: Record<string, string>; // dropdown label → option chosen
  product_price: number; // "Product Price"
  ships_in_days: number | null; // 1 = "In stock • Ships in 1 business day"
}

// In the order of the product page.
export interface Product {
  sku: string;
  name: string;
  brand: string;
  category: string;
  model: string;
  url: string;
  badge: string | null; // ribbon over the photos: "NEW ITEM", "PRE ORDER"
  starting_at: number; // "Starting At $215.00"
  per_club: boolean; // "Per Club": iron sets are priced per club
  dropdowns: Dropdown[];
  irons_in_set: { options: string[]; checked: string[] } | null; // iron sets only
  customize: { required: boolean; dropdowns: CustomizeDropdown[] }; // required: the site locks Customize on
  variants: Variant[];
  images: string[]; // the photo gallery
  videos: string[]; // the Videos tab
  description: string; // the Description tab, one paragraph per line
  specs: Record<string, string>[]; // the Specs tab, one table row per entry
  scraped_at: string; // ISO 8601, UTC
  extraction_time_ms: number;
}

export interface Failure {
  sku: string;
  name: string;
  url: string;
  reason: string;
}
