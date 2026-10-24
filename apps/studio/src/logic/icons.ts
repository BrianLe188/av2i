import {
  Archive, ArrowRightLeft, BadgeCheck, Boxes, Cable, Cloud, Container, Database, Globe, KeyRound, LayoutGrid, MapPin, Package, Radio, Route, ScrollText,
  Server, ShieldCheck, Split, Waypoints, Zap, type LucideIcon,
} from "lucide-react";

/**
 * One generic glyph per service. They are not the AWS Architecture Icons (their terms are unchecked for a shipped product),
 * so replacing this table is all it takes to switch to another set.
 */
const ICONS: Record<string, LucideIcon> = {
  vpc: Cloud, subnet: LayoutGrid, "internet-gateway": Globe, "nat-gateway": ArrowRightLeft, "elastic-ip": MapPin,
  "route-table": Route, "vpc-endpoint-s3": Cable, "security-group": ShieldCheck, ec2: Server, ecs: Container,
  ecr: Package, s3: Archive, rds: Database, lambda: Zap, "iam-role": KeyRound, "iam-policy": ScrollText,
  alb: Split, acm: BadgeCheck, route53: Waypoints, cloudfront: Radio,
};

export const iconOf = (service: string): LucideIcon => ICONS[service] ?? Boxes;
