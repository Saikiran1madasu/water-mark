#!/bin/sh
set -eu
# Mounted disks may start root-owned even when the image directory is writable.
mkdir -p "$MSK_DATA_DIR"
chown 10001:10001 "$MSK_DATA_DIR"
exec gosu 10001:10001 node /app/server.mjs
