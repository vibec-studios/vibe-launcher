#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="python -I $HERE/jvmbench.py"
MOJ="$BENCH_HOME\\java\\java-runtime-delta\\bin\\java.exe"
CDS="$BENCH_JRE\\delta-cds\\bin\\java.exe"
ROUNDS=${ROUNDS:-2}
for inst in vanilla fabric; do
  GD="$BENCH_HOME\\instances\\bench-$inst\\minecraft"
  JSA="$GD\\.vibe\\cds-strip.jsa"
  $PY "$BENCH_OUT\\spawn-$inst-strip.json" "$inst-stripdyn-create" 1 --java "$CDS" --rm-before-first "$JSA" --opt "-XX:SharedArchiveFile=$JSA" --opt "-XX:+AutoCreateSharedArchive"
  for r in $(seq $ROUNDS); do
    $PY "$BENCH_OUT\\spawn-$inst.json" "$inst-p-mojang" 1 --java "$MOJ"
    $PY "$BENCH_OUT\\spawn-$inst-strip.json" "$inst-p-strip" 1 --java "$MOJ"
    $PY "$BENCH_OUT\\spawn-$inst-strip.json" "$inst-p-stripdyn" 1 --java "$CDS" --opt "-XX:SharedArchiveFile=$JSA" --opt "-XX:+AutoCreateSharedArchive"
  done
done
GD="$BENCH_HOME\\instances\\bench-neoforge\\minecraft"
for r in $(seq $ROUNDS); do
  $PY "$BENCH_OUT\\spawn-neoforge.json" "neoforge-p-mojang" 1 --java "$MOJ"
  $PY "$BENCH_OUT\\spawn-neoforge.json" "neoforge-p-dyncds" 1 --java "$CDS" --opt "-XX:SharedArchiveFile=$GD\\.vibe\\cds.jsa" --opt "-XX:+AutoCreateSharedArchive"
done
echo PAIRS-DONE
