import registry from "virtual:registry";

export const reg = registry;

/** One thing the palette adds: a service, or one part of a service that has parts (an ECS cluster or an ECS service). */
export interface PaletteItem {
  id: string;
  service: string;
  /** props the new node starts with, for a service that has parts */
  props?: Record<string, string>;
  title?: { vi: string; en: string };
}

const plain = (service: string): PaletteItem => ({ id: service, service });

/** The services the palette offers, in the order a design is usually built. */
export const PALETTE: readonly PaletteItem[] = [
  ...["vpc", "subnet", "internet-gateway", "nat-gateway", "elastic-ip", "route-table", "vpc-endpoint-s3", "security-group", "ec2"].map(plain),
  { id: "ecs-cluster", service: "ecs", props: { part: "cluster" }, title: { vi: "ECS cluster", en: "ECS cluster" } },
  { id: "ecs-service", service: "ecs", props: { part: "service" }, title: { vi: "ECS service (Fargate)", en: "ECS service (Fargate)" } },
  ...["ecr", "lambda", "rds", "s3", "iam-role", "alb", "acm", "route53", "cloudfront"].map(plain),
];

export const paletteItem = (id: string): PaletteItem | undefined => PALETTE.find((p) => p.id === id);
