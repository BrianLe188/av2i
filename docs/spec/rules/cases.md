---
id: rule-cases
title: { vi: "Ca kiểm thử cho các rule chưa có kịch bản phủ", en: "Test cases for rules no scenario covers" }
purpose: "Boundary cases written from each rule's check sentence. A test builds the input, runs the rule and asserts whether it fires. These cases are the first reader of the check sentences: where a sentence could not be turned into a case it is listed under needs_split"
format:
  rule: "rule ID from validation.md or security.md"
  cases: "list of { name, in, fires }; in is the minimum design the rule reads, keyed by resource ID; fires is true when the rule must report"
  notes: "a value in <angle brackets> stands for a property the case does not care about"
  executable: "a case with patch is run by the test kit: patch (DD-012 operations) is applied to the base design (a scenario ID, default ec2-in-vpc) and the rule must fire exactly when fires is true. A case with unrepresentable names why the model cannot express the input. A case with neither is not converted yet (DD-009)"
needs_split:
  - { rule: VAL-018, why: "name length, character set and the sg- prefix are three checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-050, why: "length, characters, shape, prefixes, suffixes and the -an namespace rule are six or more checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-056, why: "one configuration, rule fields, filter shape and the versioning dependency are four checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-076, why: "forward, redirect and fixed-response each have their own constraints, plus protocol and port", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-092, why: "default behaviour, ordered behaviours, origin references and custom error responses are four checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-108, why: "trust policy size, inline total and managed policy size use different limits", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-117, why: "identity statement, trust statement, version and character set are four checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-060, why: "required fields and the password alternative are two checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-082, why: "load balancer side and target side are separate checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-083, why: "five numeric ranges and the lambda rule are separate checks", tested: "packages/testkit/test/splits.test.ts, one case per condition" }
  - { rule: VAL-066, why: "depends on the approved dedicated instance class list in services/rds.md, which a test must load", tested: "deferred in the registry, see the rule" }
  - { rule: SEC-016, why: "heuristic; no precise check exists. Keep it a text hint, not a tested rule", tested: "deferred in the registry, see the rule" }
status: unverified
cases:
  # networking
  - rule: VAL-001
    cases:
      - { name: slash-16, in: { vpc: { cidr_block: "10.0.0.0/16" } }, fires: false, patch: [] }
      - { name: slash-28, in: { vpc: { cidr_block: "10.0.0.0/28" } }, fires: false, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"10.0.0.0/28"}] }
      - { name: slash-15, in: { vpc: { cidr_block: "10.0.0.0/15" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"10.0.0.0/15"}] }
      - { name: slash-29, in: { vpc: { cidr_block: "10.0.0.0/29" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"10.0.0.0/29"}] }
      - { name: not-a-cidr, in: { vpc: { cidr_block: "10.0.0.0/33" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"10.0.0.0/33"}] }
  - rule: VAL-002
    cases:
      - { name: private-range, in: { vpc: { cidr_block: "10.0.0.0/16" } }, fires: false, patch: [] }
      - { name: loopback, in: { vpc: { cidr_block: "127.0.0.0/16" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"127.0.0.0/16"}] }
      - { name: link-local, in: { vpc: { cidr_block: "169.254.0.0/16" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"169.254.0.0/16"}] }
      - { name: multicast, in: { vpc: { cidr_block: "224.0.0.0/16" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"224.0.0.0/16"}] }
  - rule: VAL-003
    cases:
      - { name: slash-28, in: { subnet: { cidr_block: "10.0.1.0/28" } }, fires: false, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.10.0/28"}] }
      - { name: slash-16, in: { subnet: { cidr_block: "10.0.0.0/16" } }, fires: false, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.0.0/16"}] }
      - { name: slash-29, in: { subnet: { cidr_block: "10.0.1.0/29" } }, fires: true, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.10.0/29"}] }
      - { name: slash-15, in: { subnet: { cidr_block: "10.0.0.0/15" } }, fires: true, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.0.0/15"}] }
  - rule: VAL-004
    cases:
      - { name: inside, in: { vpc: { cidr_block: "10.0.0.0/16" }, subnet: { cidr_block: "10.0.1.0/24" } }, fires: false, patch: [] }
      - { name: outside, in: { vpc: { cidr_block: "10.0.0.0/16" }, subnet: { cidr_block: "10.1.0.0/24" } }, fires: true, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.1.0.0/24"}] }
      - { name: straddles, in: { vpc: { cidr_block: "10.0.0.0/24" }, subnet: { cidr_block: "10.0.0.0/23" } }, fires: true, patch: [{"op":"set","node":"vpc","path":"props.cidr_block","value":"10.0.0.0/24"},{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.0.0/23"}] }
  - rule: VAL-005
    cases:
      - { name: adjacent, in: { a: { cidr_block: "10.0.1.0/24" }, b: { cidr_block: "10.0.2.0/24" } }, fires: false, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.1.0/24"}] }
      - { name: nested, in: { a: { cidr_block: "10.0.1.0/24" }, b: { cidr_block: "10.0.1.128/25" } }, fires: true, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.0.128/25"}] }
      - { name: identical, in: { a: { cidr_block: "10.0.1.0/24" }, b: { cidr_block: "10.0.1.0/24" } }, fires: true, patch: [{"op":"set","node":"app_a","path":"props.cidr_block","value":"10.0.0.0/24"}] }
  - rule: VAL-006
    cases:
      - { name: set, in: { subnet: { availability_zone: "az-a" } }, fires: false, patch: [] }
      - { name: missing, in: { subnet: {} }, fires: true, patch: [{"op":"unset","node":"app_a","path":"props.availability_zone"}] }
  - rule: VAL-007
    cases:
      - { name: one, in: { vpc: {}, igw1: { vpc: vpc } }, fires: false, patch: [] }
      - { name: two, in: { vpc: {}, igw1: { vpc: vpc }, igw2: { vpc: vpc } }, fires: true, patch: [{"op":"add-node","node":{"key":"igw2","label":"igw2","service":"internet-gateway","parent":"vpc","props":{}}}] }
  - rule: VAL-008
    cases:
      - { name: attached, in: { vpc: {}, igw: { vpc: vpc } }, fires: false, patch: [] }
      - { name: detached, in: { igw: {} }, fires: true, patch: [{"op":"set","node":"igw","path":"parent","value":null}] }
  - rule: VAL-009
    cases:
      - { name: one-each, in: { route: { destination: "0.0.0.0/0", target: igw } }, fires: false, patch: [] }
      - { name: no-target, unrepresentable: "an edge always has a target", in: { route: { destination: "0.0.0.0/0" } }, fires: true }
      - { name: two-targets, unrepresentable: "an edge always has exactly one target", in: { route: { destination: "0.0.0.0/0", target: [igw, nat] } }, fires: true }
      - { name: two-destinations, in: { route: { destination: ["0.0.0.0/0", "10.1.0.0/16"], target: igw } }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"igw","props":{"destination_cidr_block":"10.9.0.0/16","destination_ipv6_cidr_block":"::/0"}}}] }
  - rule: VAL-010
    cases:
      - { name: same-vpc, in: { rt: { vpc: A }, route: { table: rt, target: igw }, igw: { attached_to: A } }, fires: false, patch: [] }
      - { name: gateway-other-vpc, in: { rt: { vpc: A }, route: { table: rt, target: igw }, igw: { attached_to: B } }, fires: true, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"igw2","label":"igw2","service":"internet-gateway","parent":"vpc2","props":{}}},{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"igw2","props":{"destination_cidr_block":"10.9.0.0/16"}}}] }
      - { name: nat-other-vpc, in: { rt: { vpc: A }, route: { table: rt, target: nat }, nat: { vpc: B } }, fires: true, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"sub2","label":"sub2","service":"subnet","parent":"vpc2","props":{"cidr_block":"10.1.0.0/24","availability_zone":"ap-southeast-1a"}}},{"op":"add-node","node":{"key":"nat2","label":"nat2","service":"nat-gateway","parent":"sub2","props":{"availability_mode":"zonal","connectivity_type":"public"}}},{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"nat2","props":{"destination_cidr_block":"10.9.0.0/16"}}}] }
  - rule: VAL-014
    cases:
      - { name: one-table, in: { subnet: {}, assoc: [{ table: rt1, subnet: subnet }] }, fires: false, patch: [] }
      - { name: two-tables, in: { subnet: {}, assoc: [{ table: rt1, subnet: subnet }, { table: rt2, subnet: subnet }] }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route-association","from":"rt_public","to":"app_a"}}] }
  - rule: VAL-015
    cases:
      - { name: same-vpc, in: { rt: { vpc: A }, subnet: { vpc: A } }, fires: false, patch: [] }
      - { name: different-vpc, in: { rt: { vpc: A }, subnet: { vpc: B } }, fires: true, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"rt2","label":"rt2","service":"route-table","parent":"vpc2","props":{}}},{"op":"add-edge","edge":{"id":"e_x","mechanism":"route-association","from":"rt2","to":"app_a"}}] }
  - rule: VAL-016
    cases:
      - { name: distinct, in: { rt: { routes: ["0.0.0.0/0", "10.1.0.0/16"] } }, fires: false, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"igw","props":{"destination_cidr_block":"10.1.0.0/16"}}}] }
      - { name: duplicate, in: { rt: { routes: ["0.0.0.0/0", "0.0.0.0/0"] } }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"igw","props":{"destination_cidr_block":"0.0.0.0/0"}}}] }
  - rule: VAL-017
    cases:
      - { name: outside-reserved, in: { route: { destination: "169.254.172.0/24" } }, fires: false, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"nat_a","props":{"destination_cidr_block":"169.254.172.0/24"}}}] }
      - { name: inside-reserved, in: { route: { destination: "169.254.168.0/24" } }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"nat_a","props":{"destination_cidr_block":"169.254.168.0/24"}}}] }
      - { name: reserved-exact, in: { route: { destination: "169.254.168.0/22" } }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"nat_a","props":{"destination_cidr_block":"169.254.168.0/22"}}}] }
      - { name: ipv6-reserved, in: { route: { destination: "fd00:ec2::/32" } }, fires: true, patch: [{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_app","to":"nat_a","props":{"destination_cidr_block":"fd00:ec2::/32"}}}] }
  - rule: VAL-018
    cases:
      - { name: plain, in: { sg: { name: "web-sg" } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.name","value":"web-sg"}] }
      - { name: sg-prefix, in: { sg: { name: "sg-web" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.name","value":"sg-web"}] }
      - { name: too-long, in: { sg: { name: "<256 characters>" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.name","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}] }
      - { name: bad-character, in: { sg: { name: "web|sg" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.name","value":"web|sg"}] }
  - rule: VAL-019
    cases:
      - { name: same-vpc-case-differs, in: { a: { vpc: A, name: "Web" }, b: { vpc: A, name: "web" } }, fires: true, patch: [{"op":"add-node","node":{"key":"sg2","label":"sg2","service":"security-group","parent":"vpc","props":{"name":"APP-SG","description":"Second"}}}] }
      - { name: different-vpc, in: { a: { vpc: A, name: "web" }, b: { vpc: B, name: "web" } }, fires: false, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"sg2","label":"sg2","service":"security-group","parent":"vpc2","props":{"name":"app-sg","description":"Second"}}}] }
  - rule: VAL-020
    cases:
      - { name: ok, in: { sg: { description: "web tier" } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.description","value":"web tier"}] }
      - { name: empty, in: { sg: { description: "" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.description","value":""}] }
      - { name: too-long, in: { sg: { description: "<256 characters>" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.description","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}] }
  - rule: VAL-022
    cases:
      - { name: at-limit, in: { sg: { ingress_ipv4_rules: 60 } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1059,"to_port":1059,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: over, in: { sg: { ingress_ipv4_rules: 61 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1059,"to_port":1059,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1060,"to_port":1060,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: prefix-list-counts-by-size, in: { sg: { ingress_ipv4_rules: 45, prefix_list_rule_with_entries: 20 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":443,"to_port":443,"prefix_list_id":"pl-0123456789abcdef0","prefix_list_entries":20}]}] }
      - { name: directions-separate, in: { sg: { ingress_ipv4_rules: 60, egress_ipv4_rules: 59 } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"}]},{"op":"set","node":"sg_app","path":"props.egress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: generated-s3-rule-counts, in: { sg: { ingress_ipv4_rules: 60, egress_ipv4_rules: 60 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1059,"to_port":1059,"cidr_ipv4":"10.0.0.0/16"}]},{"op":"set","node":"sg_app","path":"props.egress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1000,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1001,"to_port":1001,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1002,"to_port":1002,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1003,"to_port":1003,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1004,"to_port":1004,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1005,"to_port":1005,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1006,"to_port":1006,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1007,"to_port":1007,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1008,"to_port":1008,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1009,"to_port":1009,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1010,"to_port":1010,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1011,"to_port":1011,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1012,"to_port":1012,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1013,"to_port":1013,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1014,"to_port":1014,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1015,"to_port":1015,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1016,"to_port":1016,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1017,"to_port":1017,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1018,"to_port":1018,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1019,"to_port":1019,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1020,"to_port":1020,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1021,"to_port":1021,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1022,"to_port":1022,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1023,"to_port":1023,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1024,"to_port":1024,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1025,"to_port":1025,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1026,"to_port":1026,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1027,"to_port":1027,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1028,"to_port":1028,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1029,"to_port":1029,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1030,"to_port":1030,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1031,"to_port":1031,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1032,"to_port":1032,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1033,"to_port":1033,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1034,"to_port":1034,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1035,"to_port":1035,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1036,"to_port":1036,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1037,"to_port":1037,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1038,"to_port":1038,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1039,"to_port":1039,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1040,"to_port":1040,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1041,"to_port":1041,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1042,"to_port":1042,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1043,"to_port":1043,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1044,"to_port":1044,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1045,"to_port":1045,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1046,"to_port":1046,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1047,"to_port":1047,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1048,"to_port":1048,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1049,"to_port":1049,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1050,"to_port":1050,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1051,"to_port":1051,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1052,"to_port":1052,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1053,"to_port":1053,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1054,"to_port":1054,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1055,"to_port":1055,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1056,"to_port":1056,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1057,"to_port":1057,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1058,"to_port":1058,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":1059,"to_port":1059,"cidr_ipv4":"10.0.0.0/16"}]}] }
  - rule: VAL-023
    cases:
      - { name: one-peer, in: { rule: { cidr_ipv4: "10.0.0.0/16" } }, fires: false, patch: [] }
      - { name: two-peers, in: { rule: { cidr_ipv4: "10.0.0.0/16", referenced_security_group_id: sg2 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"cidr_ipv4":"10.0.0.0/16","referenced_security_group_id":"sg_app"}]}] }
      - { name: no-peer, in: { rule: {} }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443}]}] }
  - rule: VAL-024
    cases:
      - { name: tcp-range, in: { rule: { ip_protocol: tcp, from_port: 80, to_port: 443 } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":80,"to_port":443,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: port-too-high, in: { rule: { ip_protocol: tcp, from_port: 80, to_port: 70000 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":80,"to_port":70000,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: reversed, in: { rule: { ip_protocol: tcp, from_port: 443, to_port: 80 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":80,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: all-with-ports, in: { rule: { ip_protocol: "-1", from_port: 80, to_port: 80 } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"-1","from_port":80,"to_port":80,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: icmp-type-code, in: { rule: { ip_protocol: icmp, from_port: 8, to_port: 0 } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"icmp","from_port":8,"to_port":0,"cidr_ipv4":"10.0.0.0/16"}]}] }
  - rule: VAL-025
    cases:
      - { name: same-vpc, in: { sg1: { vpc: A }, sg2: { vpc: A }, rule: { owner: sg1, referenced_security_group_id: sg2 } }, fires: false, patch: [{"op":"add-node","node":{"key":"sg2","label":"sg2","service":"security-group","parent":"vpc","props":{"name":"peer","description":"Peer"}}},{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"referenced_security_group_id":"sg2"}]}] }
      - { name: other-vpc, in: { sg1: { vpc: A }, sg2: { vpc: B }, rule: { owner: sg1, referenced_security_group_id: sg2 } }, fires: true, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"sg2","label":"sg2","service":"security-group","parent":"vpc2","props":{"name":"peer","description":"Peer"}}},{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"referenced_security_group_id":"sg2"}]}] }
  - rule: VAL-026
    cases:
      - { name: different-port, in: { rules: [{ direction: ingress, ip_protocol: tcp, from_port: 80, to_port: 80, cidr_ipv4: "10.0.0.0/16" }, { direction: ingress, ip_protocol: tcp, from_port: 443, to_port: 443, cidr_ipv4: "10.0.0.0/16" }] }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":80,"to_port":80,"cidr_ipv4":"10.0.0.0/16"}]}] }
      - { name: identical, in: { rules: [{ direction: ingress, ip_protocol: tcp, from_port: 80, to_port: 80, cidr_ipv4: "10.0.0.0/16" }, { direction: ingress, ip_protocol: tcp, from_port: 80, to_port: 80, cidr_ipv4: "10.0.0.0/16" }] }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"cidr_ipv4":"10.0.0.0/16"},{"ip_protocol":"tcp","from_port":443,"to_port":443,"cidr_ipv4":"10.0.0.0/16"}]}] }
  - rule: VAL-027
    cases:
      - { name: same-vpc, in: { sg: { vpc: A }, ec2: { vpc: A, security_groups: [sg] } }, fires: false, patch: [] }
      - { name: other-vpc, in: { sg: { vpc: A }, ec2: { vpc: B, security_groups: [sg] } }, fires: true, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"sub2","label":"sub2","service":"subnet","parent":"vpc2","props":{"cidr_block":"10.1.0.0/24","availability_zone":"ap-southeast-1a"}}},{"op":"add-node","node":{"key":"app2","label":"app2","service":"ec2","parent":"sub2","props":{"ami":"ami-0123456789abcdef0","instance_type":"t3.micro","metadata_options":{"http_tokens":"required"},"root_block_device":{"encrypted":true}}}},{"op":"add-edge","edge":{"id":"e_x","mechanism":"sg-attach","from":"sg_app","to":"app2"}}] }
  - rule: VAL-028
    cases:
      - { name: private-table-to-nat, in: { nat: { subnet: pub }, rt_private: { to_nat: nat } }, fires: false, patch: [] }
      - { name: loop, in: { nat: { subnet: pub }, rt_of_pub: { routes: [{ "0.0.0.0/0": nat }] } }, fires: true, patch: [{"op":"remove-edge","mechanism":"route","from":"rt_public","to":"igw"},{"op":"add-edge","edge":{"id":"e_x","mechanism":"route","from":"rt_public","to":"nat_a","props":{"destination_cidr_block":"0.0.0.0/0"}}}] }
  # compute
  - rule: VAL-030
    cases:
      - { name: complete, in: { ec2: { ami: "<id>", instance_type: t3.micro, subnets: [s1] } }, fires: false, patch: [] }
      - { name: ami-lookup, in: { ec2: { instance_type: t3.micro, subnets: [s1] } }, fires: false, patch: [{"op":"unset","node":"app","path":"props.ami"}] }
      - { name: unknown-family, in: { ec2: { ami_family: nope, instance_type: t3.micro, subnets: [s1] } }, fires: true, patch: [{"op":"unset","node":"app","path":"props.ami"},{"op":"set","node":"app","path":"props.ami_family","value":"nope"}] }
      - { name: no-instance-type, in: { ec2: { ami: "<id>", subnets: [s1] } }, fires: true, patch: [{"op":"unset","node":"app","path":"props.instance_type"}] }
      - { name: two-subnets, unrepresentable: "a node has one parent, so an instance cannot be in two subnets", in: { ec2: { ami: "<id>", instance_type: t3.micro, subnets: [s1, s2] } }, fires: true }
      - { name: sg-other-vpc, in: { ec2: { ami: "<id>", instance_type: t3.micro, subnets: [s1], subnet_vpc: A, security_group_vpc: B } }, fires: false, patch: [{"op":"add-node","node":{"key":"vpc2","label":"vpc2","service":"vpc","props":{"cidr_block":"10.1.0.0/16"}}},{"op":"add-node","node":{"key":"sg2","label":"sg2","service":"security-group","parent":"vpc2","props":{"name":"other","description":"Other"}}},{"op":"add-edge","edge":{"id":"e_x","mechanism":"sg-attach","from":"sg2","to":"app"}}] }
  - rule: VAL-033
    cases:
      - { name: zip-ok, in: { fn: { filename: "f.zip", handler: "index.handler", runtime: nodejs22.x } }, fires: false }
      - { name: two-sources, in: { fn: { filename: "f.zip", image_uri: "<uri>" } }, fires: true }
      - { name: zip-no-handler, in: { fn: { filename: "f.zip", runtime: nodejs22.x } }, fires: true }
      - { name: image-without-package-type, in: { fn: { image_uri: "<uri>" } }, fires: true }
      - { name: image-ok, in: { fn: { image_uri: "<uri>", package_type: Image } }, fires: false }
  # storage and database
  - rule: VAL-050
    cases:
      - { name: plain, in: { bucket: { name: "my-bucket" } }, fires: false }
      - { name: too-short, in: { bucket: { name: "ab" } }, fires: true }
      - { name: uppercase-underscore, in: { bucket: { name: "My_Bucket" } }, fires: true }
      - { name: adjacent-periods, in: { bucket: { name: "a..b" } }, fires: true }
      - { name: ip-shaped, in: { bucket: { name: "192.168.1.1" } }, fires: true }
      - { name: reserved-prefix, in: { bucket: { name: "xn--abc" } }, fires: true }
      - { name: reserved-suffix, in: { bucket: { name: "abc-s3alias" } }, fires: true }
      - { name: an-suffix-outside-namespace, in: { bucket: { name: "abc-an", namespace: global } }, fires: true }
  - rule: VAL-053
    cases:
      - { name: at-limit, in: { policy: { size_bytes: 20480 } }, fires: false }
      - { name: over, in: { policy: { size_bytes: 20481 } }, fires: true }
  - rule: VAL-055
    cases:
      - { name: complete, in: { bucket: { region: R, encryption: AES256, allows_log_delivery_put: true }, alb: { region: R, access_logs: bucket } }, fires: false }
      - { name: other-region, in: { bucket: { region: R2, encryption: AES256, allows_log_delivery_put: true }, alb: { region: R, access_logs: bucket } }, fires: true }
      - { name: kms-encryption, in: { bucket: { region: R, encryption: "aws:kms", allows_log_delivery_put: true }, alb: { region: R, access_logs: bucket } }, fires: true }
      - { name: no-statement, in: { bucket: { region: R, encryption: AES256, allows_log_delivery_put: false }, alb: { region: R, access_logs: bucket } }, fires: true }
  - rule: VAL-056
    cases:
      - { name: ok, in: { lifecycle: [{ rules: [{ id: r1, status: Enabled, action: expiration, filter: {} }] }] }, fires: false }
      - { name: two-configurations, in: { lifecycle: [{ rules: [] }, { rules: [] }] }, fires: true }
      - { name: id-too-long, in: { lifecycle: [{ rules: [{ id: "<256 characters>", status: Enabled, action: expiration }] }] }, fires: true }
      - { name: noncurrent-without-versioning, in: { bucket: { versioning: Disabled }, lifecycle: [{ rules: [{ id: r1, status: Enabled, action: noncurrent_version_expiration }] }] }, fires: true }
  - rule: VAL-057
    cases:
      - { name: lock-with-versioning, in: { bucket: { object_lock_enabled: true, versioning: Enabled } }, fires: false }
      - { name: lock-without, in: { bucket: { object_lock_enabled: true, versioning: Suspended } }, fires: true }
  - rule: VAL-059
    cases:
      - { name: ok, in: { db: { identifier: "app-db" } }, fires: false }
      - { name: starts-with-digit, in: { db: { identifier: "1db" } }, fires: true }
      - { name: ends-with-hyphen, in: { db: { identifier: "db-" } }, fires: true }
      - { name: double-hyphen, in: { db: { identifier: "db--x" } }, fires: true }
      - { name: sixty-four-chars, in: { db: { identifier: "<64 characters>" } }, fires: true }
  - rule: VAL-060
    cases:
      - { name: managed-password, in: { db: { engine: postgres, instance_class: db.t3.micro, allocated_storage: 20, username: app, db_subnet_group: g, manage_master_user_password: true } }, fires: false }
      - { name: no-username, in: { db: { engine: postgres, instance_class: db.t3.micro, allocated_storage: 20, db_subnet_group: g, manage_master_user_password: true } }, fires: true }
      - { name: no-password-at-all, in: { db: { engine: postgres, instance_class: db.t3.micro, allocated_storage: 20, username: app, db_subnet_group: g } }, fires: true }
  - rule: VAL-061
    cases:
      - { name: postgres-ok, in: { db: { engine: postgres, password: "abcdefgh1" } }, fires: false }
      - { name: postgres-129, in: { db: { engine: postgres, password: "<129 characters>" } }, fires: true }
      - { name: mysql-42, in: { db: { engine: mysql, password: "<42 characters>" } }, fires: true }
      - { name: at-sign, in: { db: { engine: postgres, password: "abcd@efgh" } }, fires: true }
      - { name: too-short, in: { db: { engine: postgres, password: "abc" } }, fires: true }
  - rule: VAL-063
    cases:
      - { name: ok, in: { db: { backup_retention_period: 7, backup_window: "03:00-04:00", maintenance_window: "sun:05:00-sun:06:00" } }, fires: false }
      - { name: retention-36, in: { db: { backup_retention_period: 36 } }, fires: true }
      - { name: windows-overlap, in: { db: { backup_window: "05:00-06:00", maintenance_window: "sun:05:30-sun:06:30" } }, fires: true }
  - rule: VAL-064
    cases:
      - { name: skip-true, in: { db: { skip_final_snapshot: true } }, fires: false }
      - { name: no-identifier, in: { db: { skip_final_snapshot: false } }, fires: true }
      - { name: bad-identifier, in: { db: { skip_final_snapshot: false, final_snapshot_identifier: "1snap" } }, fires: true }
      - { name: ok, in: { db: { skip_final_snapshot: false, final_snapshot_identifier: "snap-final" } }, fires: false }
  - rule: VAL-065
    cases:
      - { name: unset, in: { db: { allocated_storage: 100, max_allocated_storage: 0 } }, fires: false }
      - { name: equal, in: { db: { allocated_storage: 100, max_allocated_storage: 100 } }, fires: false }
      - { name: below, in: { db: { allocated_storage: 100, max_allocated_storage: 50 } }, fires: true }
  - rule: VAL-066
    cases:
      - { name: default-tenancy, in: { vpc: { instance_tenancy: default }, db: { instance_class: "<any>" } }, fires: false }
      - { name: dedicated-approved, in: { vpc: { instance_tenancy: dedicated }, db: { instance_class: "<in approved list>" } }, fires: false }
      - { name: dedicated-not-approved, in: { vpc: { instance_tenancy: dedicated }, db: { instance_class: "<not in approved list>" } }, fires: true }
  - rule: VAL-068
    cases:
      - { name: port-matches, in: { db: { engine: postgres }, ingress: { port: 5432 } }, fires: false }
      - { name: port-differs, in: { db: { engine: postgres }, ingress: { port: 3306 } }, fires: true }
      - { name: custom-port, in: { db: { engine: postgres, port: 6000 }, ingress: { port: 6000 } }, fires: false }
  - rule: VAL-069
    cases:
      - { name: managed-only, in: { db: { manage_master_user_password: true } }, fires: false }
      - { name: with-password, in: { db: { manage_master_user_password: true, password: "<set>" } }, fires: true }
      - { name: with-password-wo, in: { db: { manage_master_user_password: true, password_wo: "<set>" } }, fires: true }
  # delivery
  - rule: VAL-072
    cases:
      - { name: slash-27, in: { alb_subnet: { cidr_block: "10.0.1.0/27", used_addresses: 5 } }, fires: false }
      - { name: slash-28, in: { alb_subnet: { cidr_block: "10.0.1.0/28" } }, fires: true }
      - { name: too-few-free, in: { alb_subnet: { cidr_block: "10.0.1.0/27", used_addresses: 25 } }, fires: true }
  - rule: VAL-073
    cases:
      - { name: ok, in: { alb: { name: "web-alb" } }, fires: false }
      - { name: thirty-three-chars, in: { alb: { name: "<33 characters>" } }, fires: true }
      - { name: leading-hyphen, in: { alb: { name: "-web" } }, fires: true }
      - { name: trailing-hyphen, in: { alb: { name: "web-" } }, fires: true }
  - rule: VAL-075
    cases:
      - { name: ok, in: { listener: { protocol: HTTPS, default_certificates: 1, ssl_policy: "ELBSecurityPolicy-TLS13-1-2-2021-06", key_type: RSA_2048 } }, fires: false }
      - { name: no-certificate, in: { listener: { protocol: HTTPS, default_certificates: 0, ssl_policy: "<policy>" } }, fires: true }
      - { name: two-defaults, in: { listener: { protocol: HTTPS, default_certificates: 2, ssl_policy: "<policy>" } }, fires: true }
      - { name: no-policy, in: { listener: { protocol: HTTPS, default_certificates: 1 } }, fires: true }
      - { name: ed25519, in: { listener: { protocol: HTTPS, default_certificates: 1, ssl_policy: "<policy>", key_type: ED25519 } }, fires: true }
  - rule: VAL-076
    cases:
      - { name: forward-ok, in: { action: { type: forward, target_groups: 2, weights: [1, 999] } }, fires: false }
      - { name: six-groups, in: { action: { type: forward, target_groups: 6 } }, fires: true }
      - { name: weight-1000, in: { action: { type: forward, target_groups: 2, weights: [1, 1000] } }, fires: true }
      - { name: redirect-303, in: { action: { type: redirect, status_code: HTTP_303 } }, fires: true }
      - { name: fixed-response-3xx, in: { action: { type: fixed-response, content_type: "text/plain", status_code: "302" } }, fires: true }
      - { name: port-zero, in: { listener: { port: 0, protocol: HTTP } }, fires: true }
  - rule: VAL-077
    cases:
      - { name: instance-complete, in: { tg: { target_type: instance, port: 80, protocol: HTTP, vpc_id: vpc } }, fires: false }
      - { name: ip-no-vpc, in: { tg: { target_type: ip, port: 80, protocol: HTTP } }, fires: true }
      - { name: lambda-with-port, in: { tg: { target_type: lambda, port: 80 } }, fires: true }
      - { name: lambda-bare, in: { tg: { target_type: lambda } }, fires: false }
  - rule: VAL-078
    cases:
      - { name: one-alb, in: { tg: {}, listeners: [{ alb: a, forwards: tg }] }, fires: false }
      - { name: two-albs, in: { tg: {}, listeners: [{ alb: a, forwards: tg }, { alb: b, forwards: tg }] }, fires: true }
  - rule: VAL-079
    cases:
      - { name: instances-only, in: { tg: { target_type: instance, targets: ["i-1", "i-2"] } }, fires: false }
      - { name: mixed, in: { tg: { target_type: instance, targets: ["i-1", "10.0.1.5"] } }, fires: true }
      - { name: two-lambdas, in: { tg: { target_type: lambda, targets: ["fn1", "fn2"] } }, fires: true }
  - rule: VAL-080
    cases:
      - { name: in-vpc-subnet, in: { tg: { vpc_cidr: "10.0.0.0/16" }, target: { ip: "10.0.1.5" } }, fires: false }
      - { name: rfc1918-outside-vpc, in: { tg: { vpc_cidr: "10.0.0.0/16" }, target: { ip: "192.168.1.5" } }, fires: false }
      - { name: public-address, in: { tg: { vpc_cidr: "10.0.0.0/16" }, target: { ip: "8.8.8.8" } }, fires: true }
  - rule: VAL-082
    cases:
      - { name: complete, in: { alb_sg: { ingress_ports: [443], egress_ports: [8080] }, target_sg: { ingress_from_alb: [8080] }, tg: { port: 8080, health_check_port: 8080 } }, fires: false }
      - { name: alb-egress-missing, in: { alb_sg: { ingress_ports: [443], egress_ports: [] }, target_sg: { ingress_from_alb: [8080] }, tg: { port: 8080, health_check_port: 8080 } }, fires: true }
      - { name: target-ingress-missing, in: { alb_sg: { ingress_ports: [443], egress_ports: [8080] }, target_sg: { ingress_from_alb: [] }, tg: { port: 8080, health_check_port: 8080 } }, fires: true }
      - { name: health-check-port-differs, in: { alb_sg: { ingress_ports: [443], egress_ports: [8080] }, target_sg: { ingress_from_alb: [8080] }, tg: { port: 8080, health_check_port: 8081 } }, fires: true }
  - rule: VAL-083
    cases:
      - { name: ok, in: { hc: { interval: 30, timeout: 5, healthy_threshold: 3, unhealthy_threshold: 3, matcher: "200", path: "/" } }, fires: false }
      - { name: interval-4, in: { hc: { interval: 4 } }, fires: true }
      - { name: timeout-1, in: { hc: { timeout: 1 } }, fires: true }
      - { name: threshold-11, in: { hc: { healthy_threshold: 11 } }, fires: true }
      - { name: matcher-500, in: { hc: { matcher: "500" } }, fires: true }
      - { name: lambda-interval-below-timeout, in: { hc: { target_type: lambda, interval: 30 }, fn: { timeout: 60 } }, fires: true }
  - rule: VAL-084
    cases:
      - { name: at-limit, in: { region: { albs: 50 } }, fires: false }
      - { name: over, in: { region: { albs: 51 } }, fires: true }
      - { name: rules-over, in: { alb: { rules: 101 } }, fires: true }
  - rule: VAL-086
    cases:
      - { name: alb-zone, in: { record: { target: alb, zone_id: "<alb canonical hosted zone id>" } }, fires: false }
      - { name: wrong-zone, in: { record: { target: alb, zone_id: "<own hosted zone id>" } }, fires: true }
      - { name: cloudfront-global-zone, in: { record: { target: cloudfront, zone_id: "<cloudfront global zone id>" } }, fires: false }
  - rule: VAL-090
    cases:
      - { name: within, in: { account: { hosted_zones: 500 } }, fires: false }
      - { name: over, in: { account: { hosted_zones: 501 } }, fires: true }
      - { name: duplicate-a-records, in: { records: [{ name: "www", type: A }, { name: "www", type: A }] }, fires: true }
      - { name: duplicate-with-routing-policy, in: { records: [{ name: "www", type: A, set_identifier: a }, { name: "www", type: A, set_identifier: b }] }, fires: false }
  - rule: VAL-092
    cases:
      - { name: ok, in: { cdn: { origins: [o1], default_behavior: { target_origin_id: o1, viewer_protocol_policy: redirect-to-https, cache_policy: p } } }, fires: false }
      - { name: no-origin, in: { cdn: { origins: [] } }, fires: true }
      - { name: default-with-path-pattern, in: { cdn: { origins: [o1], default_behavior: { target_origin_id: o1, path_pattern: "/x" } } }, fires: true }
      - { name: unknown-origin, in: { cdn: { origins: [o1], default_behavior: { target_origin_id: o2 } } }, fires: true }
      - { name: error-response-half, in: { cdn: { custom_error_response: { response_code: 200 } } }, fires: true }
  - rule: VAL-095
    cases:
      - { name: at-limit, in: { cdn: { aliases: 100, origins: 100, behaviors: 75 } }, fires: false }
      - { name: aliases-101, in: { cdn: { aliases: 101 } }, fires: true }
      - { name: behaviors-76, in: { cdn: { behaviors: 76 } }, fires: true }
  - rule: VAL-097
    cases:
      - { name: ok, in: { origin: { connection_attempts: 3, connection_timeout: 10 } }, fires: false }
      - { name: attempts-4, in: { origin: { connection_attempts: 4 } }, fires: true }
      - { name: timeout-11, in: { origin: { connection_timeout: 11 } }, fires: true }
  - rule: VAL-098
    cases:
      - { name: name-matches, in: { origin: { domain: "app.example.com", protocol: https }, alb_cert: { names: ["app.example.com"] } }, fires: false }
      - { name: name-differs, in: { origin: { domain: "app.example.com", protocol: https }, alb_cert: { names: ["other.example.com"] } }, fires: true }
      - { name: http-origin, in: { origin: { domain: "app.example.com", protocol: http }, alb_cert: { names: [] } }, fires: false }
  # IAM
  - rule: VAL-103
    cases:
      - { name: ok, in: { role: { name: "app-role" } }, fires: false }
      - { name: sixty-five-chars, in: { role: { name: "<65 characters>" } }, fires: true }
      - { name: case-insensitive-duplicate, in: { a: { name: "App" }, b: { name: "app" } }, fires: true }
  - rule: VAL-104
    cases:
      - { name: ok, in: { trust: { statements: [{ effect: Allow, action: "sts:AssumeRole", principal: { Service: "ec2.amazonaws.com" } }] } }, fires: false }
      - { name: wrong-action, in: { trust: { statements: [{ effect: Allow, action: "s3:GetObject", principal: { Service: "ec2.amazonaws.com" } }] } }, fires: true }
      - { name: principal-not-in-registry, in: { trust: { statements: [{ effect: Allow, action: "sts:AssumeRole", principal: { Service: "example.amazonaws.com" } }] } }, fires: true }
      - { name: only-deny, in: { trust: { statements: [{ effect: Deny, action: "sts:AssumeRole", principal: { Service: "ec2.amazonaws.com" } }] } }, fires: true }
  - rule: VAL-107
    cases:
      - { name: twenty, in: { role: { managed_policies: 20 } }, fires: false }
      - { name: twenty-one, in: { role: { managed_policies: 21 } }, fires: true }
  - rule: VAL-108
    cases:
      - { name: trust-at-limit, in: { trust: { size: 2048 } }, fires: false }
      - { name: trust-over, in: { trust: { size: 2049 } }, fires: true }
      - { name: inline-total-over, in: { role: { inline_total: 10241 } }, fires: true }
      - { name: managed-over, in: { managed: { size: 6145 } }, fires: true }
  - rule: VAL-109
    cases:
      - { name: one-role, in: { profile: { name: "p1", roles: [r1] } }, fires: false }
      - { name: two-roles, in: { profile: { name: "p1", roles: [r1, r2] } }, fires: true }
      - { name: name-129, in: { profile: { name: "<129 characters>", roles: [r1] } }, fires: true }
      - { name: instance-two-profiles, in: { ec2: { profiles: [p1, p2] } }, fires: true }
  - rule: VAL-114
    cases:
      - { name: off, in: { db: { monitoring_interval: 0 } }, fires: false }
      - { name: on-with-role, in: { db: { monitoring_interval: 60, role: { trust: "monitoring.rds.amazonaws.com", policies: [AmazonRDSEnhancedMonitoringRole] } } }, fires: false }
      - { name: on-no-role, in: { db: { monitoring_interval: 60 } }, fires: true }
      - { name: on-wrong-trust, in: { db: { monitoring_interval: 60, role: { trust: "ec2.amazonaws.com", policies: [AmazonRDSEnhancedMonitoringRole] } } }, fires: true }
  - rule: VAL-115
    cases:
      - { name: same-account, in: { role: { account: A }, consumer: { account: A } }, fires: false }
      - { name: other-account, in: { role: { account: A }, consumer: { account: B } }, fires: true }
  - rule: VAL-117
    cases:
      - { name: identity-ok, in: { policy: { kind: identity, version: "2012-10-17", statements: [{ effect: Allow, action: "s3:GetObject", resource: "arn:aws:s3:::b/*" }] } }, fires: false }
      - { name: identity-no-resource, in: { policy: { kind: identity, version: "2012-10-17", statements: [{ effect: Allow, action: "s3:GetObject" }] } }, fires: true }
      - { name: trust-no-principal, in: { policy: { kind: trust, version: "2012-10-17", statements: [{ effect: Allow, action: "sts:AssumeRole" }] } }, fires: true }
      - { name: old-version, in: { policy: { kind: identity, version: "2008-10-17", statements: [{ effect: Allow, action: "s3:GetObject", resource: "*" }] } }, fires: true }
  - rule: VAL-118
    cases:
      - { name: separate-resources, in: { role: { style: separate } }, fires: false }
      - { name: inline-and-separate, in: { role: { inline_policy: true, separate_policy_resources: true } }, fires: true }
      - { name: policy-attachment, in: { role: { uses: aws_iam_policy_attachment } }, fires: true }
  - rule: VAL-119
    cases:
      - { name: valid-level, in: { grant: { target: s3, level: read } }, fires: false }
      - { name: unknown-level, in: { grant: { target: s3, level: write } }, fires: true }
      - { name: unknown-target, in: { grant: { target: sqs, level: read } }, fires: true }
      - { name: object-action-on-bucket-arn, in: { statement: { actions: ["s3:GetObject"], resource: "arn:aws:s3:::bucket" } }, fires: true }
  - rule: VAL-120
    cases:
      - { name: ok, in: { inline: { name: "s3-read", role: r1 } }, fires: false }
      - { name: with-space, in: { inline: { name: "s3 read", role: r1 } }, fires: true }
      - { name: duplicate-in-role, in: { inlines: [{ name: "s3-read", role: r1 }, { name: "s3-read", role: r1 }] }, fires: true }
      - { name: name-129, in: { inline: { name: "<129 characters>", role: r1 } }, fires: true }
  - rule: VAL-121
    cases:
      - { name: at-limit, in: { account: { roles: 1000 } }, fires: false }
      - { name: over, in: { account: { roles: 1001 } }, fires: true }
  # security
  - rule: SEC-001
    cases:
      - { name: all-protocols, in: { rule: { direction: ingress, ip_protocol: "-1", cidr_ipv4: "0.0.0.0/0" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"-1","cidr_ipv4":"0.0.0.0/0"}]}] }
      - { name: all-tcp-ports, in: { rule: { direction: ingress, ip_protocol: tcp, from_port: 0, to_port: 65535, cidr_ipv6: "::/0" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":0,"to_port":65535,"cidr_ipv6":"::/0"}]}] }
      - { name: https, in: { rule: { direction: ingress, ip_protocol: tcp, from_port: 443, to_port: 443, cidr_ipv4: "0.0.0.0/0" } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":443,"to_port":443,"cidr_ipv4":"0.0.0.0/0"}]}] }
      - { name: all-from-private, in: { rule: { direction: ingress, ip_protocol: "-1", cidr_ipv4: "10.0.0.0/16" } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"-1","cidr_ipv4":"10.0.0.0/16"}]}] }
  - rule: SEC-003
    cases:
      - { name: hundred-ports, in: { rule: { ip_protocol: tcp, from_port: 1000, to_port: 1099, cidr_ipv4: "10.0.0.0/8" } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1099,"cidr_ipv4":"10.0.0.0/8"}]}] }
      - { name: hundred-one-ports, in: { rule: { ip_protocol: tcp, from_port: 1000, to_port: 1100, cidr_ipv4: "10.0.0.0/8" } }, fires: true, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":1100,"cidr_ipv4":"10.0.0.0/8"}]}] }
      - { name: peer-is-security-group, in: { rule: { ip_protocol: tcp, from_port: 1000, to_port: 2000, referenced_security_group_id: sg2 } }, fires: false, patch: [{"op":"set","node":"sg_app","path":"props.ingress_rules","value":[{"ip_protocol":"tcp","from_port":1000,"to_port":2000,"referenced_security_group_id":"sg_app"}]}] }
  - rule: SEC-004
    cases:
      - { name: explicit, in: { ecs: { security_groups: [sg1] } }, fires: false, patch: [] }
      - { name: none, in: { ecs: { security_groups: [] } }, fires: true, patch: [{"op":"remove-edge","mechanism":"sg-attach","from":"sg_app","to":"app"}] }
  - rule: SEC-005
    cases:
      - { name: managed-empty, in: { vpc: { default_security_group: managed_empty } }, fires: false }
      - { name: unmanaged, in: { vpc: { default_security_group: unmanaged } }, fires: true }
  - rule: SEC-006
    cases:
      - { name: required, in: { ec2: { metadata_options: { http_tokens: required } } }, fires: false, patch: [] }
      - { name: optional, in: { ec2: { metadata_options: { http_tokens: optional } } }, fires: true, patch: [{"op":"set","node":"app","path":"props.metadata_options.http_tokens","value":"optional"}] }
  - rule: SEC-007
    cases:
      - { name: encrypted, in: { ec2: { root_block_device: { encrypted: true } } }, fires: false, patch: [] }
      - { name: plain, in: { ec2: { root_block_device: { encrypted: false } } }, fires: true, patch: [{"op":"set","node":"app","path":"props.root_block_device.encrypted","value":false}] }
  - rule: SEC-009
    cases:
      - { name: on, in: { repo: { scan_on_push: true } }, fires: false }
      - { name: off, in: { repo: { scan_on_push: false } }, fires: true }
  - rule: SEC-014
    cases:
      - { name: enforced, in: { bucket: { object_ownership: BucketOwnerEnforced } }, fires: false }
      - { name: acls-on, in: { bucket: { object_ownership: ObjectWriter } }, fires: true }
  - rule: SEC-016
    cases:
      - { name: heuristic, in: { bucket: { name: "<name with a person, project or secret>" } }, fires: true, note: "see needs_split" }
  - rule: SEC-018
    cases:
      - { name: encrypted, in: { db: { storage_encrypted: true } }, fires: false }
      - { name: plain, in: { db: { storage_encrypted: false } }, fires: true }
  - rule: SEC-020
    cases:
      - { name: managed, in: { db: { manage_master_user_password: true } }, fires: false }
      - { name: write-only, in: { db: { password_wo: "<set>" } }, fires: false }
      - { name: plain-password, in: { db: { password: "<set>" } }, fires: true }
  - rule: SEC-021
    cases:
      - { name: seven-days, in: { db: { backup_retention_period: 7 } }, fires: false }
      - { name: zero, in: { db: { backup_retention_period: 0 } }, fires: true }
  - rule: SEC-022
    cases:
      - { name: final-snapshot, in: { db: { skip_final_snapshot: false } }, fires: false }
      - { name: skipped, in: { db: { skip_final_snapshot: true } }, fires: true }
  - rule: SEC-025
    cases:
      - { name: modern, in: { listener: { ssl_policy: "ELBSecurityPolicy-TLS13-1-2-2021-06" } }, fires: false }
      - { name: provider-default, in: { listener: { ssl_policy: "ELBSecurityPolicy-2016-08" } }, fires: true }
  - rule: SEC-033
    cases:
      - { name: "false", in: { zone: { force_destroy: false } }, fires: false }
      - { name: "true", in: { zone: { force_destroy: true } }, fires: true }
  - rule: SEC-037
    cases:
      - { name: scoped, in: { statement: { actions: ["s3:GetObject"], resource: "arn:aws:s3:::b/*" } }, fires: false }
      - { name: star-resource, in: { statement: { actions: ["s3:GetObject"], resource: "*" } }, fires: true }
      - { name: ecr-token-needs-star, in: { statement: { actions: ["ecr:GetAuthorizationToken"], resource: "*" } }, fires: false }
  - rule: SEC-038
    cases:
      - { name: specific, in: { statement: { actions: ["s3:GetObject"] } }, fires: false }
      - { name: service-wide, in: { statement: { actions: ["s3:*"] } }, fires: true }
  - rule: SEC-039
    cases:
      - { name: service-principal, in: { trust: { principal: { Service: "ec2.amazonaws.com" } } }, fires: false }
      - { name: star-no-condition, in: { trust: { principal: "*" } }, fires: true }
      - { name: star-with-condition, in: { trust: { principal: "*", condition: { StringEquals: { "aws:PrincipalOrgID": "o-example" } } } }, fires: false }
  - rule: SEC-040
    cases:
      - { name: with-conditions, in: { trust: { service: "ecs-tasks.amazonaws.com", conditions: ["aws:SourceAccount", "aws:SourceArn"] } }, fires: false }
      - { name: without, in: { trust: { service: "ecs-tasks.amazonaws.com", conditions: [] } }, fires: true }
---

# Test cases for rules no scenario covers

[scenarios/00-index.md](../scenarios/00-index.md) lists the rules the five reference scenarios do not exercise. Most of them
check one property, so a scenario would be the wrong test. This file gives each of them boundary cases written from its
`check` sentence in [validation.md](validation.md) or [security.md](security.md).

## How to use

A test loads a case, builds the smallest design that matches `in`, runs the rule and asserts `fires`. Values in angle
brackets are placeholders the case does not care about. The cases are examples of the boundaries (at the limit, one over,
absent, wrong kind), not an exhaustive set.

## What writing them showed

Several `check` sentences bundle independent conditions, so a single pass or fail answer hides which one broke. They are
listed in `needs_split` in the front matter. Before implementation each should become atomic checks with their own IDs
(for example VAL-050 into name length, character set, shape, prefix and suffix rules), keeping the old ID as the parent.
SEC-016 has no precise check and should stay a hint. VAL-066 needs the approved instance class list from
[services/rds.md](../services/rds.md) loaded as data.
