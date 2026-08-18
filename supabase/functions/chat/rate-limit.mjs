export function createBestEffortRateLimiter(options = {}) {
  const limit = options.limit ?? 12;
  const windowMs = options.windowMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 5_000;
  const now = options.now ?? Date.now;
  const windows = new Map();

  function pruneExpired(timestamp) {
    for (const [key, entry] of windows) {
      if (timestamp >= entry.resetAt) windows.delete(key);
    }
    while (windows.size >= maxEntries) {
      const oldestKey = windows.keys().next().value;
      if (oldestKey === undefined) break;
      windows.delete(oldestKey);
    }
  }

  return {
    consume(key) {
      const timestamp = now();
      let entry = windows.get(key);
      if (!entry || timestamp >= entry.resetAt) {
        if (windows.size >= maxEntries) pruneExpired(timestamp);
        entry = { count: 0, resetAt: timestamp + windowMs };
        windows.set(key, entry);
      }
      if (entry.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000)),
        };
      }
      entry.count += 1;
      return { allowed: true, remaining: Math.max(0, limit - entry.count), retryAfterSeconds: 0 };
    },
  };
}
