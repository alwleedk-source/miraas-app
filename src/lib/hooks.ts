"use client";

import { useEffect, useState } from "react";

/**
 * Returns a self-updating "now" timestamp (ms).
 *
 * React 19's purity rules forbid `Date.now()` directly during render. Use this
 * to render relative times like "منذ 5 دقائق" without tripping the linter.
 *
 * Returns 0 on the first server-render pass; updates to real now() after mount,
 * then refreshes every minute. Callers should treat 0 as "loading" and render
 * an empty string or skeleton.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- subscribe-to-clock pattern
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
