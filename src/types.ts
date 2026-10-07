// Output fields are snake_case on purpose: they are the file contract.

export interface SourceProduct {
  id: string; // "Parent Item" column, which is also the site's SKU
  name: string;
  brand: string;
  category: string;
  model: string;
}

export interface Attribute {
  code: string;
  label: string;
  options: string[];
}

export interface Variant {
  sku: string;
  options: Record<string, string>; // attribute label → option label
  final_price: number;
  regular_price: number;
  price_modifier: number; // final_price − base_price
}

export interface Customization {
  category: string;
  option_name: string;
  price_modifier: number; // add-on amount; final_price = base_price + price_modifier
  final_price: number;
}

// Fields grouped by topic: identity, price, content, media, configuration.
export interface Product {
  id: string;
  title: string; // name on the site
  name: string; // name in the CSV
  brand: string;
  category: string;
  model: string;
  url: string;
  base_price: number;
  price_range: { min: number; max: number };
  pricing_unit: "per_item" | "per_club"; // iron sets are priced per club
  included_clubs: string[]; // iron sets only
  default_set_price: number | null; // iron sets only: base_price × included clubs
  description: string; // one paragraph per line
  specs: Record<string, string>[]; // one row of the Specs table per entry
  media: string[]; // image URLs
  videos: string[]; // YouTube URLs
  attributes: Attribute[];
  variants: Variant[];
  customizations: Customization[];
  scraped_at: string; // ISO 8601, UTC
  extraction_time_ms: number;
}

export interface Failure {
  id: string;
  name: string;
  url: string;
  reason: string;
}
