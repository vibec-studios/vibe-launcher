#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="python -I $HERE/jvmbench.py"
MOJ="$BENCH_HOME\\java\\java-runtime-delta\\bin\\java.exe"
CDS="$BENCH_JRE\\delta-cds\\bin\\java.exe"
for inst in ${INSTANCES:-vanilla fabric neoforge}; do
  S="$BENCH_OUT\\spawn-$inst.json"
  GD="$BENCH_HOME\\instances\\bench-$inst\\minecraft"
  JSA="$GD\\.vibe\\cds.jsa"
  mkdir -p "$(cygpath -u "$GD")/.vibe"
  $PY "$S" "$inst-mojang" ${RUNS_A:-4} --java "$MOJ"
  $PY "$S" "$inst-basecds" ${RUNS_B:-3} --java "$CDS"
  $PY "$S" "$inst-dyncds" ${RUNS_C:-4} --java "$CDS" --rm-before-first "$JSA" --opt "-XX:SharedArchiveFile=$JSA" --opt "-XX:+AutoCreateSharedArchive"
done
echo SERIES-DONE
