#!/bin/sh
# Like fake-tofu-safe.sh, but an apply creates things and then cannot save the state: it leaves errored.tfstate, as OpenTofu does.
case "$1" in
  apply) echo '{"version":4,"serial":5,"lineage":"lineage-of-the-rescue","outputs":{},"resources":[{"mode":"managed","type":"aws_vpc","name":"a"}]}' > errored.tfstate; echo "Error: failed to save state" >&2; exit 1;;
  *) exec "$(dirname "$0")/fake-tofu-safe.sh" "$@";;
esac
