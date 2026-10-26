#!/bin/sh
# Stands in for the tofu binary in tests: prints what the runner needs to see and writes a plan file.
case "$1" in
  init) echo "Initializing"; echo "leak-check:${SECRET_TEST_VAR:-none}"; echo "key:${AWS_ACCESS_KEY_ID:-none}"; echo "backend:$(grep -c 'backend "http"' backend.tf)"; echo "token:${TF_HTTP_PASSWORD}";;
  plan) echo "Planning"; echo "plan-bytes" > plan.bin;;
  show) cat <<'JSON'
{"resource_changes":[
 {"address":"aws_vpc.a","type":"aws_vpc","change":{"actions":["create"]}},
 {"address":"aws_s3_bucket.b","type":"aws_s3_bucket","change":{"actions":["no-op"]}},
 {"address":"aws_db_instance.c","type":"aws_db_instance","change":{"actions":["delete","create"]}}]}
JSON
  ;;
  *) echo "unexpected $1" >&2; exit 2;;
esac
