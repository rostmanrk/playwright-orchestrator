#!/bin/bash
for dir in packages/*; do
  if [ -d "$dir" ]; then
    (cd "$dir" && npm link)
  fi
done