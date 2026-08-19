import { describe, expect, it } from "vitest";

import {
  alreadyRanSlot,
  findLastMatchingSlot,
  isClockJump,
  shouldCatchUp,
} from "../../../src/framework/cron/cron-clock-jump.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("isClockJump", () => {
  it("is false for a normal sample interval", () => {
    expect(isClockJump(1_000, 31_000, 60_000)).toBe(false);
  });

  it("is true when elapsed exceeds the threshold", () => {
    expect(isClockJump(1_000, 61_001, 60_000)).toBe(true);
  });

  it("is false when the clock moves backwards", () => {
    expect(isClockJump(100_000, 10_000, 60_000)).toBe(false);
  });
});

describe("findLastMatchingSlot", () => {
  const hourlyOnTheHourUtc = {
    match: (date: Date) => date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0,
  };

  it("returns the most recent matching minute within the lookback window", () => {
    const now = new Date("2026-08-18T14:30:45.123Z");
    const slot = findLastMatchingSlot(hourlyOnTheHourUtc, now, DAY_MS);

    expect(slot?.toISOString()).toBe("2026-08-18T14:00:00.000Z");
  });

  it("returns undefined when nothing matches in the lookback window", () => {
    const never = { match: () => false };
    const now = new Date("2026-08-18T14:30:00.000Z");

    expect(findLastMatchingSlot(never, now, HOUR_MS)).toBeUndefined();
  });
});

describe("shouldCatchUp", () => {
  const lastSlot = new Date("2026-08-18T00:01:00.000Z");
  const nextRun = new Date("2026-08-19T00:01:00.000Z");

  it("runs one late daily slot within tolerance and before the next fire", () => {
    expect(shouldCatchUp({
      lastSlot,
      nextRun,
      now: new Date("2026-08-18T04:00:00.000Z"),
      toleranceMs: DAY_MS,
    })).toBe(true);
  });

  it("skips when lateBy reaches the gap to the next fire", () => {
    expect(shouldCatchUp({
      lastSlot,
      nextRun,
      now: new Date("2026-08-19T00:01:00.000Z"),
      toleranceMs: DAY_MS,
    })).toBe(false);
  });

  it("skips a slot later than the 24h tolerance", () => {
    expect(shouldCatchUp({
      lastSlot,
      nextRun: new Date("2026-08-20T00:01:00.000Z"),
      now: new Date("2026-08-19T01:01:00.000Z"),
      toleranceMs: DAY_MS,
    })).toBe(false);
  });

  it("skips when the next run is unknown", () => {
    expect(shouldCatchUp({
      lastSlot,
      nextRun: null,
      now: new Date("2026-08-18T04:00:00.000Z"),
      toleranceMs: DAY_MS,
    })).toBe(false);
  });
});

describe("alreadyRanSlot", () => {
  const lastSlot = new Date("2026-08-19T05:00:00.000Z");

  it("is false when the job has never run", () => {
    expect(alreadyRanSlot(undefined, lastSlot)).toBe(false);
  });

  it("is true when a later catch-up already executed this slot", () => {
    expect(alreadyRanSlot(new Date("2026-08-19T12:21:56.000Z"), lastSlot)).toBe(true);
  });

  it("is false when the only run is from a previous slot", () => {
    expect(alreadyRanSlot(new Date("2026-08-18T05:00:00.000Z"), lastSlot)).toBe(false);
  });
});
