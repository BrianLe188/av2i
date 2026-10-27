#!/bin/sh
# Stands in for the tofu binary in tests: prints what the runner needs to see and writes a plan file.
case "$1" in
  version) echo '{"terraform_version":"1.12.9"}';;
  init) echo "Initializing"; echo "leak-check:${SECRET_TEST_VAR:-none}"; echo "key:${AWS_ACCESS_KEY_ID:-none}"; echo "secret:${AWS_SECRET_ACCESS_KEY:-none}"; echo "session:${AWS_SESSION_TOKEN:-none}"; echo "backend:$(grep -c 'backend "http"' backend.tf)"; echo "token:${TF_HTTP_PASSWORD}"; env | grep "^TF_VAR_" || echo "tfvar:none";;
  plan) echo "Planning"; echo "plan-bytes" > plan.bin;;
  show) cat <<'JSON'
{"resource_changes":[
 {"address":"aws_vpc.a","type":"aws_vpc","change":{"actions":["create"]}},
 {"address":"aws_s3_bucket.b","type":"aws_s3_bucket","change":{"actions":["no-op"]}},
 {"address":"aws_db_instance.c","type":"aws_db_instance","change":{"actions":["delete","create"]}}]}
JSON
  ;;
  apply) echo "Applying"; test -f plan.bin || { echo "no plan file" >&2; exit 3; }; echo "Apply complete! Resources: 2 added, 0 changed, 0 destroyed.";;
  *) echo "unexpected $1" >&2; exit 2;;
esac
