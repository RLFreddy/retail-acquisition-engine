// Only the fields we read are declared. If the site changes one, parsing fails
// naming the exact field instead of silently producing empty data.

import { z } from "zod";

// PHP encodes an empty map as [] instead of {}.
const phpRecord = <T extends z.ZodType>(value: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) && v.length === 0 ? {} : v),
    z.record(z.string(), value),
  );

// Amounts arrive as numbers or numeric strings.
const AmountSchema = z.object({ amount: z.coerce.number() });

export const SpConfigSchema = z.object({
  attributes: phpRecord(
    z.object({
      id: z.coerce.string(),
      code: z.string(),
      label: z.string(),
      position: z.coerce.number().default(0),
      options: z.array(z.object({ id: z.coerce.string(), label: z.string() })),
    }),
  ),
  index: phpRecord(phpRecord(z.coerce.string())), // simple product id → attribute id → option id
  optionPrices: phpRecord(z.object({ finalPrice: AmountSchema })),
  prices: z.object({ finalPrice: AmountSchema }).optional(),
  sku: phpRecord(z.string()).optional(), // simple product id → SKU
  leadtimes: phpRecord(phpRecord(z.array(z.coerce.number()))).optional(), // attribute id → simple product id → [days to ship]
});

export const IronsetOptionsSchema = z.object({
  basePrice: z.coerce.number(),
  isIronsetProduct: z.coerce.number().default(0),
  forceRequireOptions: z.boolean().default(false), // every Customize dropdown is required
  clubInformation: z.object({ included_clubs: z.array(z.string()) }).optional(),
  optionConfig: phpRecord(
    phpRecord(
      z.object({
        name: z.string(),
        option_type: z.string().optional(), // "select" or "grips"; "clubs" for Irons In Set
        prices: z.object({ finalPrice: AmountSchema }), // an add-on amount, not a total price
      }),
    ),
  ),
});

export const ProviderSchema = z.object({
  data: z.object({
    items: phpRecord(
      z.object({
        name: z.string(),
        url: z.string(),
        is_available: z.boolean().default(true),
        images: z.array(z.object({ url: z.string() })).default([]),
        extension_attributes: z.object({
          ddg_sku: z.string(), // parent SKU = the CSV "Parent Item"
          ddg_image: z.string().optional(),
        }),
      }),
    ),
  }),
});

// /gallery/<SKU>.json, which the page loads for its photo gallery.
export const GallerySchema = z.object({ imageNames: z.array(z.string()) });

export type SpConfig = z.infer<typeof SpConfigSchema>;
export type IronsetOptions = z.infer<typeof IronsetOptionsSchema>;
export type ProviderItem = z.infer<typeof ProviderSchema>["data"]["items"][string];

export function parseBlock<T extends z.ZodType>(name: string, schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`site data changed in ${name}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
