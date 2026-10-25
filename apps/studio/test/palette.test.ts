import { describe, expect, it } from "vitest";
import { PALETTE, PALETTE_GROUPS, reg } from "../src/registry.ts";
import { sections } from "../src/logic/palette.ts";
import { strings } from "../src/i18n.ts";
import { title } from "../src/logic/placement.ts";

const names = (i: (typeof PALETTE)[number]) => [i.title?.vi ?? title(reg, i.service, "vi"), i.title?.en ?? title(reg, i.service, "en")];
const groupName = (g: (typeof PALETTE_GROUPS)[number]) => [strings("vi").paletteGroups[g], strings("en").paletteGroups[g]];
const find = (q: string) => sections(PALETTE, q, names, groupName).flatMap((s) => s.items.map((i) => i.id));

describe("the service palette", () => {
  it("lists every service once, under one group, and no group is empty", () => {
    const all = sections(PALETTE, "", names, groupName);
    expect(all.map((s) => s.group)).toEqual([...PALETTE_GROUPS]);
    expect(all.flatMap((s) => s.items.map((i) => i.id)).sort()).toEqual(PALETTE.map((i) => i.id).sort());
    expect(new Set(PALETTE.map((i) => i.id)).size).toBe(PALETTE.length);
  });

  it("names every group in both languages", () => {
    for (const g of PALETTE_GROUPS) {
      expect(strings("vi").paletteGroups[g]).toBeTruthy();
      expect(strings("en").paletteGroups[g]).toBeTruthy();
    }
  });

  it("finds a service by its name in either language, ignoring case and accents", () => {
    expect(find("lambda")).toEqual(["lambda"]);
    expect(find("SUBNET")).toEqual(expect.arrayContaining(["subnet", "db-subnet-group"]));
    expect(find("co so du lieu")).toEqual(expect.arrayContaining(["rds", "db-subnet-group"]));
    expect(find("cơ sở dữ liệu")).toEqual(find("co so du lieu"));
  });

  it("finds the services of a group by the name of the group", () => {
    expect(find("storage")).toEqual(["s3", "ecr"]);
    expect(find("mạng")).toContain("vpc");
  });

  it("needs every word to match, and says nothing for a query that matches nothing", () => {
    expect(find("ecs service")).toEqual(["ecs-service"]);
    expect(find("zzz")).toEqual([]);
    expect(sections(PALETTE, "zzz", names, groupName)).toEqual([]);
  });
});
