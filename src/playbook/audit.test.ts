import { describe, expect, it } from "vitest";
import { auditPlaybook } from "./audit.ts";
import { loadPlaybook } from "./store.ts";

describe("auditPlaybook", () => {
  it("seed original-six retrieve stays 122; unused even non-default still listed", () => {
    const audit = auditPlaybook(loadPlaybook("original-six"));
    expect(audit.seedDefault).toBe("5v5-122-forecheck");
    expect(audit.retrieve.OZ[0]).toBe("5v5-122-forecheck");
    expect(audit.leftoverOz).toBe("5v5-122-forecheck");
    expect(audit.menuDiffersFromSeed).toBe(false);
    expect(audit.unusedEvenNonDefault).toContain("oz-cycle-low");
    expect(audit.unusedEvenNonDefault).toContain("nz-122-trap");
    expect(audit.unusedEvenNonDefault).not.toContain("5v5-122-forecheck");
    expect(audit.unusedEvenNonDefault).not.toContain("protect-lead-1-1-3");
  });

  it("menuDiffersFromSeed when retrieve top is not the seed default", () => {
    const seed = loadPlaybook("original-six");
    const book = {
      ...seed,
      version: 8,
      plays: seed.plays.map((p) => {
        if (p.id === "oz-cycle-low") return { ...p, stats: { games: 0, xgFor: 0, xgAgainst: 0 } };
        if (p.id === "5v5-122-forecheck") return { ...p, stats: { games: 6, xgFor: 0.1, xgAgainst: 0.5 } };
        return p;
      }),
    };
    const audit = auditPlaybook(book);
    expect(audit.retrieve.OZ[0]).toBe("oz-cycle-low");
    expect(audit.menuDiffersFromSeed).toBe(true);
    expect(audit.leftoverOz).toBe("oz-cycle-low");
  });
});
