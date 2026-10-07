// Rounds to cents: 399.99 + 29.99 is 429.97999… in floating point.
export const money = (n: number): number =>
  Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
