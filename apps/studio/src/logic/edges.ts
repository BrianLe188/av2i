export type EdgeGroup = "traffic" | "access" | "attach" | "wiring";

export const EDGE_GROUPS: readonly EdgeGroup[] = ["traffic", "access", "attach", "wiring"];

/** Hidden until asked for: security groups, route tables and Elastic IPs show as chips on the node they belong to. */
export const DEFAULT_HIDDEN: readonly EdgeGroup[] = ["wiring"];

const GROUP: Record<string, EdgeGroup> = {
  "network-access": "traffic", "listener-target": "traffic", "dns-alias": "traffic", origin: "traffic",
  "assume-role": "access", grant: "access", "resource-policy": "access",
  "sg-attach": "wiring", "route-association": "wiring", "eip-attach": "wiring",
};

/** Which family a connection belongs to: who calls whom, who may do what, or plain wiring. */
export const groupOf = (mechanism: string): EdgeGroup => GROUP[mechanism] ?? "attach";

/** Colour tokens live in index.css so dark mode follows. */
export const groupColor = (g: EdgeGroup) => `var(--edge-${g === "wiring" ? "attach" : g})`;

/** Wiring is drawn thin; the arrow points the way the call or the permission goes. */
export const hasArrow = (g: EdgeGroup) => g !== "attach" && g !== "wiring";
