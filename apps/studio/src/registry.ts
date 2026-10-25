import registry from "virtual:registry";

export const reg = registry;

export const PALETTE_GROUPS = ["network", "compute", "database", "storage", "edge", "identity"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** One thing the palette adds: a service, or one part of a service that has parts (an ECS cluster or an ECS service). */
export interface PaletteItem {
  id: string;
  service: string;
  /** the role the service plays in a design; the palette lists services under it */
  group: PaletteGroup;
  /** props the new node starts with, for a service that has parts */
  props?: Record<string, string>;
  title?: { vi: string; en: string };
}

const plain = (group: PaletteGroup) => (service: string): PaletteItem => ({ id: service, service, group });

/** The services the palette offers, by the role they play, in the order a design is usually built. */
export const PALETTE: readonly PaletteItem[] = [
  ...["vpc", "subnet", "internet-gateway", "nat-gateway", "elastic-ip", "route-table", "vpc-endpoint-s3", "security-group"].map(plain("network")),
  ...["ec2"].map(plain("compute")),
  { id: "ecs-cluster", service: "ecs", group: "compute", props: { part: "cluster" }, title: { vi: "ECS cluster", en: "ECS cluster" } },
  { id: "ecs-service", service: "ecs", group: "compute", props: { part: "service" }, title: { vi: "ECS service (Fargate)", en: "ECS service (Fargate)" } },
  ...["lambda"].map(plain("compute")),
  ...["rds", "db-subnet-group"].map(plain("database")),
  ...["s3", "ecr"].map(plain("storage")),
  ...["alb", "route53", "cloudfront", "acm"].map(plain("edge")),
  ...["iam-role", "iam-policy"].map(plain("identity")),
];

export const paletteItem = (id: string): PaletteItem | undefined => PALETTE.find((p) => p.id === id);
