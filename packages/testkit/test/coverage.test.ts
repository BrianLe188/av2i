import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { implementations } from "@av2i/rules";

type Rule = { holds_by?: string; deferred?: string };
const rules = getRegistry().rules as unknown as Record<string, Rule>;

describe("rule coverage", () => {
  it("every rule is implemented, or says why not", () => {
    const silent = Object.keys(rules).filter((id) => !(id in implementations) && !rules[id]!.holds_by && !rules[id]!.deferred);
    // rules of services no milestone has reached are listed here until they are built
    expect(silent).toEqual([]);
  });

  it("a rule that is implemented does not claim it cannot be broken", () => {
    expect(Object.keys(implementations).filter((id) => rules[id]?.holds_by || rules[id]?.deferred)).toEqual([]);
  });

  it("a rule holds by construction or is deferred, not both", () => {
    expect(Object.entries(rules).filter(([, r]) => r.holds_by && r.deferred).map(([id]) => id)).toEqual([]);
  });
});
