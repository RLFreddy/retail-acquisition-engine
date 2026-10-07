// Output fields are snake_case on purpose: they are the file contract.

export interface SourceProduct {
  sku: string; // "Parent Item" column, which is the site's SKU
  name: string;
  brand: string;
  category: string;
  model: string;
}

// A dropdown that picks the variant, e.g. Dexterity: Left Handed, Right Handed.
export interface ProductOption {
  code: string;
  name: string;
  values: string[];
}

export interface Variant {
  sku: string;
  options: Record<string, string>; // option name → value
  price: number;
  regular_price: number;
  upcharge: number; // price − base_price
}

// A dropdown of the Customize section; its upcharge adds to the variant's price.
export interface Customization {
  name: string;
  required: boolean; // the site makes every Customize dropdown required on some products
  options: { name: string; upcharge: number }[];
}

// Fields grouped by topic: identity, price, content, media, configuration.
export interface Product {
  sku: string;
  name: string;
  brand: string;
  category: string;
  model: string;
  url: string;
  base_price: number;
  price_range: { min: number; max: number };
  pricing_unit: "per_item" | "per_club"; // iron sets are priced per club
  clubs: string[]; // iron sets only: the Irons In Set checkboxes
  included_clubs: string[]; // iron sets only: the clubs checked by default
  default_set_price: number | null; // iron sets only: base_price × included clubs
  description: string; // one paragraph per line
  specs: Record<string, string>[]; // one row of the Specs table per entry
  media: { images: string[]; videos: string[] }; // image and YouTube URLs
  options: ProductOption[];
  variants: Variant[];
  customizations: Customization[];
  scraped_at: string; // ISO 8601, UTC
  extraction_time_ms: number;
}

export interface Failure {
  sku: string;
  name: string;
  url: string;
  reason: string;
}
