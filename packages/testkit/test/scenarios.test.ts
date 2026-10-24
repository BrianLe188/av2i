import { describe, expect, it } from "vitest";
import { applyPatch } from "@av2i/model";
import { executableScenarios, firedRules, structuralProblems } from "../src/index.ts";

const scenarios = executableScenarios();

describe("executable scenarios", () => {
  it("exist", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const s of scenarios) {
    describe(s.id, () => {
      it("the base design is structurally sound", () => {
        expect(structuralProblems(s.design)).toEqual([]);
      });

      it("the base design fires exactly the expected rules", () => {
        expect(firedRules(s.design)).toEqual([...s.expect.errors, ...s.expect.findings].sort());
      });

      for (const v of s.variants) {
        it(`variant ${v.id} fires ${v.fires.join(", ")}`, () => {
          expect(v.patch, "executable variants need a patch").toBeDefined();
          const design = applyPatch(s.design, v.patch!);
          const base = firedRules(s.design);
          expect(structuralProblems(design), "a variant stays structurally sound").toEqual([]);
          const cleared = new Set(v.clears ?? []);
          expect(firedRules(design)).toEqual([...new Set([...base.filter((r) => !cleared.has(r)), ...v.fires])].sort());
        });
      }
    });
  }
});
