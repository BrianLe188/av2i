import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));

describe("select menus", () => {
  // Radix places an item-aligned menu from the trigger's SelectValue; without one the menu opens off the screen, unreachable
  it("every select trigger holds a SelectValue", () => {
    const bad = files(join(import.meta.dirname, "../src"))
      .filter((f) => !f.endsWith("ui/select.tsx"))
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/<SelectTrigger\b[^>]*>(.*?)<\/SelectTrigger>/gs)].filter((m) => !m[1]!.includes("SelectValue")).map(() => f));
    expect(bad).toEqual([]);
  });
});
