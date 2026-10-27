#!/bin/sh
# Like fake-tofu.sh, but its plan only creates (nothing is deleted or replaced).
case "$1" in
  show) echo '{"resource_changes":[{"address":"aws_vpc.a","type":"aws_vpc","change":{"actions":["create"]}}]}';;
  *) exec "$(dirname "$0")/fake-tofu.sh" "$@";;
esac
