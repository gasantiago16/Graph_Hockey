import { describe, expect, it, vi } from "vitest";
import { USAGE, main } from "./main.ts";

describe("gh CLI", () => {
  it("prints usage for --help and exits 0 without XAI_API_KEY", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["--help"])).toBe(0);
      expect(log).toHaveBeenCalled();
      const printed = String(log.mock.calls[0]?.[0]);
      expect(printed).toContain("simulate");
      expect(printed).toContain("replay");
      expect(printed).toContain("aar");
      expect(printed).toContain("playbook");
      expect(printed).toContain("series");
      expect(printed).toContain("footage");
      expect(USAGE).toContain("xAI only");
    } finally {
      log.mockRestore();
    }
  });
});
