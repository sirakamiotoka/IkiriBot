#!/bin/bash
until node index.js; do
  echo "Node crashed with exit code $?. Restarting..." >&2
  sleep 1
done
