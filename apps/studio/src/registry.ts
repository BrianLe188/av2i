import registry from "virtual:registry";

export const reg = registry;

/** The services the palette offers, in the order a design is usually built. */
export const PALETTE = ["vpc", "subnet", "internet-gateway", "nat-gateway", "elastic-ip", "route-table", "vpc-endpoint-s3", "security-group", "ec2"] as const;
