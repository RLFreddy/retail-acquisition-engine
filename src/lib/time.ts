export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

// 45000 → "45s", 636000 → "10m 36s"
export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
