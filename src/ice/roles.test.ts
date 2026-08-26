import { describe, expect, it } from "vitest";
import { BLUE_LINE_X, GOAL_LINE_X } from "../engine/rink.ts";
import { createWorld, defaultDirective } from "../engine/world.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { computeIceIntent } from "./roles.ts";

describe("computeIceIntent five-man", () => {
  it("names F1 as the possessor and F2 as support-below until the puck is established in OZ", () => {
    const justIn = createWorld({
      puck: { pos: { x: 30, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 30, y: 8 } },
        "h-LW": { pos: { x: 10, y: 12 } },
        "h-RW": { pos: { x: 8, y: -10 } },
      },
    });
    const ice = computeIceIntent(justIn, "home");
    expect(ice.f1).toBe("h-C");
    expect(ice.roles["h-C"]).toBe("F1");
    expect(ice.roles["h-LW"]).toBe("F2");
    expect(ice.roles["h-RW"]).toBe("F3");
    expect(ice.targets["h-C"]).toBeUndefined();
    expect(ice.targets["h-LW"]!.x).toBeLessThan(30);
    expect(ice.targets["h-RW"]!.x).toBeGreaterThan(BLUE_LINE_X);
    expect(ice.targets["h-RW"]!.x).toBeLessThan(50);
  });

  it("F2 is a wide outlet on an established OZ carry, not a just-in entry lead", () => {
    const established = createWorld({
      puck: { pos: { x: BLUE_LINE_X + 12, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: BLUE_LINE_X + 12, y: 8 } },
        "h-LW": { pos: { x: 10, y: 12 } },
        "h-RW": { pos: { x: 8, y: -10 } },
      },
    });
    const ice = computeIceIntent(established, "home");
    const along = BLUE_LINE_X + 12;
    expect(ice.roles["h-LW"]).toBe("F2");
    expect(ice.targets["h-LW"]!.x).toBeGreaterThan(along);
  });

  it("F2 stays support-below once the puck is in the high slot", () => {
    const world = createWorld({
      puck: { pos: { x: 55, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 55, y: 8 } },
        "h-LW": { pos: { x: 40, y: 12 } },
        "h-RW": { pos: { x: 38, y: -10 } },
      },
    });
    const ice = computeIceIntent(world, "home");
    const f2id = ice.roles["h-LW"] === "F2" ? "h-LW" : "h-RW";
    expect(ice.targets[f2id]!.x).toBeLessThan(55);
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
      bodies: {
        "h-C": { pos: { x: -40, y: 0 } },
        "h-LW": { pos: { x: -50, y: 10 } },
        "h-RW": { pos: { x: -50, y: -10 } },
        "h-LD": { pos: { x: -55, y: 8 } },
        "h-RD": { pos: { x: -55, y: -8 } },
      },
    });
    expect(computeIceIntent(dz, "home").f1Action).toBe("clear");

    const dzOutlet = createWorld({
      puck: { pos: { x: -50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: -50, y: 0 } },
        "h-LW": { pos: { x: -20, y: 10 } },
      },
    });
    expect(computeIceIntent(dzOutlet, "home").f1Action).toBe("pass");

    const book = loadPlaybook("original-six");
    const nzDump = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 0, y: 0 } } },
    });
    expect(computeIceIntent(nzDump, "home").f1Action).toBe("clear");

    const expansion = loadPlaybook("expansion");
    const nzOverlayDump = createWorld({
      playId: { home: "5v5-212-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: expansion, away: expansion },
      directives: {
        home: { playId: "5v5-212-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 0, y: 0 } } },
    });
    expect(computeIceIntent(nzOverlayDump, "home").f1Action).toBe("clear");
  });

  it("F1 in OZ passes instead of shooting while shotLock is set", () => {
    const oz = createWorld({
      puck: { pos: { x: 40, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 40, y: 0 } } },
      shotLock: { home: true, away: false },
    });
    expect(computeIceIntent(oz, "home").f1Action).toBe("pass");
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

  it("Ds tags up to ONSIDE_ALONG on delayed offside", () => {
    const world = createWorld({
      delayedOffside: { attacking: "home" },
      puck: { pos: { x: 40, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 40, y: 0 } },
        "h-LD": { pos: { x: 32, y: 6 } },
        "h-RD": { pos: { x: 28, y: -8 } },
      },
    });
    const ice = computeIceIntent(world, "home");
    const ds = ice.roles["h-LD"] === "Ds" ? "h-LD" : "h-RD";
    expect(ice.targets[ds]!.x).toBeCloseTo(BLUE_LINE_X - 4, 5);
  });

  it("F3 holds the attacking blue until the puck is in the OZ", () => {
    const nz = createWorld({
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: -8, y: 10 } },
        "h-RW": { pos: { x: -8, y: -10 } },
      },
    });
    const nzIce = computeIceIntent(nz, "home");
    const nzF3 = nzIce.roles["h-RW"] === "F3" ? "h-RW" : "h-LW";
    expect(nzIce.targets[nzF3]!.x).toBeCloseTo(BLUE_LINE_X - 4, 0);

    const oz = createWorld({
      puck: { pos: { x: 40, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 40, y: 0 } },
        "h-LW": { pos: { x: 20, y: 10 } },
        "h-RW": { pos: { x: 18, y: -10 } },
      },
    });
    const ozIce = computeIceIntent(oz, "home");
    const f3 = ozIce.roles["h-RW"] === "F3" ? "h-RW" : "h-LW";
    expect(ozIce.targets[f3]!.x).toBeGreaterThan(BLUE_LINE_X);

    const justIn = createWorld({
      puck: { pos: { x: BLUE_LINE_X + 4, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: BLUE_LINE_X + 4, y: 0 } },
        "h-LW": { pos: { x: 10, y: 10 } },
        "h-RW": { pos: { x: 8, y: -10 } },
      },
    });
    const justIce = computeIceIntent(justIn, "home");
    const justF3 = justIce.roles["h-RW"] === "F3" ? "h-RW" : "h-LW";
    expect(justIce.targets[justF3]!.x).toBeGreaterThan(BLUE_LINE_X);
    expect(justIce.targets[justF3]!.x).toBeLessThan(GOAL_LINE_X - 20);
  });

  it("F2 contests a loose puck instead of trailing eight feet behind", () => {
    const oz = createWorld({
      puck: { pos: { x: 50, y: 6 }, possessor: null },
      bodies: {
        "h-C": { pos: { x: 20, y: 0 } },
        "h-LW": { pos: { x: 28, y: 8 } },
        "h-RW": { pos: { x: 10, y: -10 } },
      },
    });
    const ice = computeIceIntent(oz, "home");
    const f2id = ice.roles["h-C"] === "F2" ? "h-C" : ice.roles["h-LW"] === "F2" ? "h-LW" : "h-RW";
    const t = ice.targets[f2id]!;
    expect(ice.f1Action).toBe("hunt");
    expect(t.x).toBeGreaterThan(BLUE_LINE_X);
    expect(t.x).toBeLessThan(50);
    expect(Math.hypot(t.x - 50, t.y - 6)).toBeLessThan(12);

    const shallow = createWorld({
      puck: { pos: { x: BLUE_LINE_X + 4, y: 0 }, possessor: null },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 8, y: 6 } },
        "h-RW": { pos: { x: -8, y: -8 } },
      },
    });
    const shallowIce = computeIceIntent(shallow, "home");
    const shF2 =
      shallowIce.roles["h-C"] === "F2" ? "h-C" : shallowIce.roles["h-LW"] === "F2" ? "h-LW" : "h-RW";
    expect(shallowIce.targets[shF2]!.x).toBeLessThanOrEqual(BLUE_LINE_X);

    const nz = createWorld({
      puck: { pos: { x: 10, y: 0 }, possessor: null },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: -8, y: 10 } },
        "h-RW": { pos: { x: -8, y: -10 } },
      },
    });
    const nzIce = computeIceIntent(nz, "home");
    const nzF2 = nzIce.roles["h-LW"] === "F2" ? "h-LW" : nzIce.roles["h-RW"] === "F2" ? "h-RW" : "h-C";
    expect(nzIce.targets[nzF2]!.x).toBeLessThan(10);
    expect(nzIce.targets[nzF2]!.x).toBeLessThanOrEqual(BLUE_LINE_X);
  });

  it("F2 stays onside in the NZ and pressures the carrier when we do not have the puck", () => {
    const nz = createWorld({
      puck: { pos: { x: 10, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 10, y: 0 } },
        "h-LW": { pos: { x: -4, y: 12 } },
        "h-RW": { pos: { x: -4, y: -12 } },
      },
    });
    const ice = computeIceIntent(nz, "home");
    const f2id = ice.roles["h-LW"] === "F2" ? "h-LW" : "h-RW";
    expect(ice.targets[f2id]!.x).toBeLessThan(BLUE_LINE_X);

    const hunt = createWorld({
      puck: { pos: { x: 8, y: 4 }, possessor: "a-C" },
      bodies: {
        "a-C": { pos: { x: 8, y: 4 } },
        "h-LW": { pos: { x: 6, y: 2 } },
        "h-C": { pos: { x: 0, y: 0 } },
        "h-RW": { pos: { x: -6, y: -8 } },
      },
    });
    const press = computeIceIntent(hunt, "home");
    const f2 = press.roles["h-C"] === "F2" ? "h-C" : press.roles["h-RW"] === "F2" ? "h-RW" : "h-LW";
    expect(Math.hypot(press.targets[f2]!.x - 8, press.targets[f2]!.y - 4)).toBeLessThan(14);

    const cheating = createWorld({
      puck: { pos: { x: 23, y: 0 }, possessor: "a-C" },
      bodies: {
        "a-C": { pos: { x: 27, y: 0 } },
        "h-LW": { pos: { x: 6, y: 2 } },
        "h-C": { pos: { x: 0, y: 0 } },
        "h-RW": { pos: { x: -6, y: -8 } },
      },
    });
    const clamped = computeIceIntent(cheating, "home");
    const f2b =
      clamped.roles["h-C"] === "F2" ? "h-C" : clamped.roles["h-RW"] === "F2" ? "h-RW" : "h-LW";
    expect(clamped.targets[f2b]!.x).toBeLessThanOrEqual(BLUE_LINE_X);
  });

  it("Ds collapses in our DZ instead of parking at the blue", () => {
    const world = createWorld({
      puck: { pos: { x: -50, y: 8 }, possessor: "a-C" },
      bodies: {
        "a-C": { pos: { x: -50, y: 8 } },
        "h-LD": { pos: { x: -20, y: 12 } },
        "h-RD": { pos: { x: -20, y: -12 } },
      },
    });
    const ice = computeIceIntent(world, "home");
    const ds = ice.roles["h-LD"] === "Ds" ? "h-LD" : "h-RD";
    const t = ice.targets[ds]!;
    expect(t.x).toBeLessThan(-BLUE_LINE_X);
    expect(t.x).toBeGreaterThan(-GOAL_LINE_X + 8);

    const away = createWorld({
      puck: { pos: { x: 50, y: 6 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 50, y: 6 } },
        "a-LD": { pos: { x: 20, y: 10 } },
        "a-RD": { pos: { x: 20, y: -10 } },
      },
    });
    const awayIce = computeIceIntent(away, "away");
    const ads = awayIce.roles["a-LD"] === "Ds" ? "a-LD" : "a-RD";
    expect(awayIce.targets[ads]!.x).toBeGreaterThan(BLUE_LINE_X);
  });
});
