import { describe, expect, it } from "vitest";
import {
  LENGTH_PRESETS,
  clampPeriodSeconds,
  formatLengthHelp,
  formatPeriodTriple,
  llmLengthWarning,
  periodSecondsFromCustom,
} from "./length.js";

describe("match length presets", () => {
  it("maps Watchable / 5 / 10 / 20 min to period seconds", () => {
    expect(LENGTH_PRESETS.watchable).toBe(15);
    expect(LENGTH_PRESETS.min5).toBe(300);
    expect(LENGTH_PRESETS.min10).toBe(600);
    expect(LENGTH_PRESETS.min20).toBe(1200);
  });

  it("prints 3× period + scaled OT in human units", () => {
    expect(formatPeriodTriple(15)).toBe("3×15s + OT 3.8s");
    expect(formatLengthHelp(15)).toBe("3×15s + OT 3.8s · demo");
    expect(formatLengthHelp(300)).toBe("3×5:00 + OT 1:15");
    expect(formatLengthHelp(600)).toBe("3×10:00 + OT 2:30");
    expect(formatLengthHelp(1200)).toBe("3×20:00 + OT 5:00");
  });

  it("clamps custom to 1s–1200s and converts minutes", () => {
    expect(periodSecondsFromCustom(30, "sec")).toBe(30);
    expect(periodSecondsFromCustom(2, "min")).toBe(120);
    expect(periodSecondsFromCustom(0, "sec")).toBe(15);
    expect(periodSecondsFromCustom(45, "min")).toBe(1200);
    expect(clampPeriodSeconds(1200)).toBe(1200);
  });

  it("warns only for live LLM at 5 min or longer", () => {
    expect(llmLengthWarning(15, true)).toBeUndefined();
    expect(llmLengthWarning(300, false)).toBeUndefined();
    expect(llmLengthWarning(300, true)).toMatch(/all 3 periods/);
    expect(llmLengthWarning(1200, true)).toMatch(/all 3 periods/);
  });
});
