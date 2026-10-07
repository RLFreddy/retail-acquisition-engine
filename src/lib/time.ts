export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const roundMs = (ms: number): number => Math.round(ms * 10) / 10;
