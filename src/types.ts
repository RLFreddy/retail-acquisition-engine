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

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  model: string;
  url: string;
  title: string;
  base_price: number;
  pricing_unit: "per_item" | "per_club"; // iron sets are priced per club
  price_range: { min: number; max: number };
  included_clubs: string[]; // iron sets only
  media: string[];
  attributes: Attribute[];
  variants: Variant[];
  customizations: Customization[];
  extraction_time_ms: number;
  scraped_at: string; // ISO 8601, UTC
}

export interface Failure {
  id: string;
  name: string;
  url: string;
  reason: string;
}
