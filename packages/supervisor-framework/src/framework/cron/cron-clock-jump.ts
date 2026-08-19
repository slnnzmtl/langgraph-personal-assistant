const MINUTE_MS = 60 * 1000;

export type CronSlotMatcher = {
  match(date: Date): boolean;
};

export const isClockJump = (lastSeenMs: number, nowMs: number, thresholdMs: number): boolean =>
  nowMs - lastSeenMs > thresholdMs;

export const findLastMatchingSlot = (
  matcher: CronSlotMatcher,
  now: Date,
  lookbackMs: number,
): Date | undefined => {
  const nowMs = now.getTime();
  const oldestMs = nowMs - lookbackMs;
  let cursorMs = nowMs - (nowMs % MINUTE_MS);

  for (; cursorMs >= oldestMs; cursorMs -= MINUTE_MS) {
    const candidate = new Date(cursorMs);
    if (matcher.match(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

export const shouldCatchUp = (options: {
  lastSlot: Date;
  nextRun: Date | null;
  now: Date;
  toleranceMs: number;
}): boolean => {
  if (!options.nextRun) {
    return false;
  }

  const lateBy = options.now.getTime() - options.lastSlot.getTime();
  if (lateBy <= 0 || lateBy > options.toleranceMs) {
    return false;
  }

  const gap = options.nextRun.getTime() - options.lastSlot.getTime();
  return lateBy < gap;
};

/** True when a run already completed at or after this cron slot (prevents re-catch-up). */
export const alreadyRanSlot = (lastRunAt: Date | undefined, lastSlot: Date): boolean =>
  lastRunAt !== undefined && lastRunAt.getTime() >= lastSlot.getTime();
