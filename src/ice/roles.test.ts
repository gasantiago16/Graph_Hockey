import { describe, expect, it } from "vitest";
import { createWorld } from "../engine/world.ts";
import { computeIceIntent } from "./roles.ts";

describe("computeIceIntent five-man", () => {
  it("names F1 as the possessor and F2 behind the puck along attack", () => {
    const world = createWorld({
      puck: { pos: { x: 30, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 30, y: 8 } },
        "h-LW": { pos: { x: 10, y: 12 } },
        "h-RW": { pos: { x: 8, y: -10 } },
      },
    });
    const ice = computeIceIntent(world, "home");
    expect(ice.f1).toBe("h-C");
    expect(ice.roles["h-C"]).toBe("F1");
    expect(ice.roles["h-LW"]).toBe("F2");
    expect(ice.roles["h-RW"]).toBe("F3");
    expect(ice.targets["h-C"]).toBeUndefined();
    const f2 = ice.targets["h-LW"]!;
    expect(f2.x).toBeLessThan(30);
    const f3 = ice.targets["h-RW"]!;
    expect(f3.x).toBeGreaterThan(50);
  });

  it("F1 with the puck shoots in OZ, passes in NZ, clears in DZ", () => {
    const oz = createWorld({
      puck: { pos: { x: 40, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 40, y: 0 } } },
    });
    expect(computeIceIntent(oz, "home").f1Action).toBe("shoot");

    const nz = createWorld({
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 0, y: 0 } } },
    });
    expect(computeIceIntent(nz, "home").f1Action).toBe("pass");

    const dz = createWorld({
      puck: { pos: { x: -40, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: -40, y: 0 } } },
    });
    expect(computeIceIntent(dz, "home").f1Action).toBe("clear");
  });

  it("F1 hunts a loose puck and Ds does not sit in our crease", () => {
    const world = createWorld({
      puck: { pos: { x: 20, y: 0 }, possessor: null },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 15, y: 4 } },
        "h-LD": { pos: { x: -40, y: 10 } },
        "h-RD": { pos: { x: -40, y: -10 } },
      },
    });
    const ice = computeIceIntent(world, "home");
    expect(ice.f1).toBe("h-LW");
    expect(ice.f1Action).toBe("hunt");
    expect(ice.targets["h-LW"]).toMatchObject({ x: 20, y: 0 });
    const ds = ice.roles["h-LD"] === "Ds" ? "h-LD" : "h-RD";
    const t = ice.targets[ds]!;
    expect(t.x).toBeGreaterThan(-80);
  });
});
