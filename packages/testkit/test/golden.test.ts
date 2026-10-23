import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "@av2i/generator";
import { getRegistry } from "@av2i/registry";
import { applyPatch } from "@av2i/model";
import { runRules } from "@av2i/rules";
import { executableScenarios } from "../src/index.ts";

describe("golden Terraform files", () => {
  for (const s of executableScenarios()) {
    it(`${s.id} matches the committed files`, () => {
      const dir = resolve(import.meta.dirname, "../golden", s.id);
      const expected: Record<string, string> = {};
      for (const f of readdirSync(dir)) expected[f] = readFileSync(resolve(dir, f), "utf8");
      expect(generate(s.design)).toEqual(expected);
    });

    it(`${s.id}: every variant without errors still generates`, () => {
      for (const v of s.variants) {
        const design = applyPatch(s.design, v.patch ?? []);
        const hasError = runRules(design, getRegistry()).some((f) => f.severity === "error");
        if (!hasError) expect(() => generate(design), v.id).not.toThrow();
      }
    });
  }
});
