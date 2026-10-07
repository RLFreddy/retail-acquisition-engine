// Rounds to cents: 399.99 + 29.99 is 429.97999… in floating point.
export const roundToCents = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
