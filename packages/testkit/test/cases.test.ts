import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { implementations } from "@av2i/rules";
import { applyPatch } from "@av2i/model";
import { executableCases, executableScenarios, firedRules } from "../src/index.ts";

const bases = new Map(executableScenarios().map((s) => [s.id, s.design]));
const cases = executableCases();

describe("rule cases", () => {
  it("some are executable", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`${c.rule} ${c.name} ${c.fires ? "fires" : "does not fire"}`, () => {
      const base = bases.get(c.base);
      expect(base, `unknown base ${c.base}`).toBeDefined();
      expect(firedRules(applyPatch(base!, c.patch)).includes(c.rule)).toBe(c.fires);
    });
  }

  it("every rule with an executable case is implemented", () => {
    const missing = [...new Set(cases.map((c) => c.rule))].filter((r) => !(r in implementations));
    expect(missing).toEqual([]);
  });

  it("every executable case belongs to a known rule", () => {
    const reg = getRegistry();
    expect(cases.filter((c) => !(c.rule in reg.rules))).toEqual([]);
  });
});
