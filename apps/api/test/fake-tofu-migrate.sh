#!/bin/sh
# Stands in for tofu when state is moved: the "platform" and "S3" are two files next to the runs folder.
store() { if grep -q 'backend "s3"' backend.tf; then echo "../../fake-s3-store"; else echo "../../fake-platform-store"; fi; }
case "$1" in
  version) echo '{"terraform_version":"1.12.9"}';;
  init) echo "Initializing $(store)";;
  state)
    case "$2" in
      pull) f=$(store); [ -f "$f" ] && cat "$f"; exit 0;;
      push) cp "$3" "$(store)"; echo "pushed";;
    esac;;
  *) echo "unexpected $1" >&2; exit 2;;
esac
