#!/bin/bash

if [ -z "${NYNO_ROOT:-}" ]; then
  if [ -n "${BASH_SOURCE[0]:-}" ]; then
    NYNO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  else
    NYNO_ROOT="$(pwd)"
  fi
fi

fail_nyno_env() {
  echo "ERROR: $1" >&2
  exit 1
}

if [ ! -f "$NYNO_ROOT/.env" ]; then
  fail_nyno_env "Missing .env. Copy .env.template to .env and set a fresh SECRET."
fi

source "$NYNO_ROOT/.env"

required_vars=(WF GU PY JS DN PE RB HOST SECRET)
for key in "${required_vars[@]}"; do
  if [ -z "${!key:-}" ]; then
    fail_nyno_env "Missing required env var: $key"
  fi
done

case "$SECRET" in
  change_me|changeme|CHANGE_ME|CHANGEME)
    fail_nyno_env "SECRET must be a fresh high-entropy value, not '$SECRET'."
    ;;
esac
