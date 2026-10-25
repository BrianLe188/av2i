import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { runRules } from "@av2i/rules";
import type { Design } from "@av2i/model";

const reg = getRegistry();
const base = (): any => structuredClone((reg.scenarios["ec2-in-vpc"] as any).design);
const fired = (d: Design) => runRules(d, reg).filter((f) => f.rule === "VAL-032" || f.rule === "VAL-131").map((f) => `${f.rule} ${f.targets.join(",")}`);
const node = (d: any, key: string) => d.nodes.find((n: any) => n.key === key);

/** VAL-032 and VAL-131: an instance with no way out, told apart by where it sits. */
describe("an instance with no path to the internet", () => {
  it("is fine in a private subnet whose table routes 0.0.0.0/0 to a NAT gateway (the template)", () => {
    expect(fired(base())).toEqual([]);
  });

  it("gets VAL-032 in a private subnet with no route table and no NAT", () => {
    const d = base();
    const drop = ["pub_a", "nat_a", "rt_public", "rt_app", "igw", "s3ep"];
    d.nodes = d.nodes.filter((n: any) => !drop.includes(n.key));
    d.edges = d.edges.filter((e: any) => !drop.some((k) => e.from === k || e.to === k));
    expect(fired(d)).toEqual(["VAL-032 app"]);
  });

  it("gets VAL-131, not VAL-032, in a public subnet without a public address even when a NAT gateway is beside it", () => {
    const d = base();
    node(d, "app").parent = "pub_a";
    expect(fired(d)).toEqual(["VAL-131 app"]);
  });

  it("is cleared in the public subnet by an address on the instance, on the subnet, or an Elastic IP", () => {
    const onInstance = base();
    node(onInstance, "app").parent = "pub_a";
    node(onInstance, "app").props.associate_public_ip_address = true;
    const onSubnet = base();
    node(onSubnet, "app").parent = "pub_a";
    node(onSubnet, "pub_a").props.map_public_ip_on_launch = true;
    const eip = base();
    node(eip, "app").parent = "pub_a";
    eip.nodes.push({ key: "eip_app", label: "EIP", service: "elastic-ip", parent: "vpc", props: {} });
    eip.edges.push({ id: "e_eip", mechanism: "eip-attach", from: "eip_app", to: "app" });
    for (const d of [onInstance, onSubnet, eip]) expect(fired(d)).toEqual([]);
  });

  it("tells the person what to do in each case", () => {
    expect(reg.rules["VAL-032"]!.fix.en).toContain("NAT");
    expect(reg.rules["VAL-131"]!.fix.en).toContain("Elastic IP");
    expect(reg.rules["VAL-131"]!.fix.vi).toContain("Elastic IP");
  });
});
