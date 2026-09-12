#!/usr/bin/env bash
# Subset the Alegreya TTFs for the PDF export. pdf-lib needs TTF or OTF, not the
# WOFF2 the screen uses, and the full files are 261KB each.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/data/build/fonts"
OUT="$ROOT/static/fonts/print"

FACES=(AlegreyaSans-Bold AlegreyaSans-Regular Alegreya-Bold)
UNICODES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+20AC,U+2212"

report() {
  printf 'print fonts %s (%s bytes)\n' "$OUT" \
    "$(find "$OUT" -name '*.ttf' -exec stat -f%z {} + 2>/dev/null | paste -sd+ - | bc)"
}

if [ -d "$OUT" ] && [ "$(find "$OUT" -name '*.ttf' | wc -l | tr -d ' ')" -eq "${#FACES[@]}" ]; then
  report; exit 0
fi

for f in "${FACES[@]}"; do
  [ -f "$SRC/$f.ttf" ] || { echo "missing $SRC/$f.ttf; run build_fonts.sh first" >&2; exit 1; }
done

mkdir -p "$OUT"
for f in "${FACES[@]}"; do
  uv run --quiet --with fonttools --with brotli -- pyftsubset "$SRC/$f.ttf" \
    --unicodes="$UNICODES" --layout-features='' --no-hinting --desubroutinize \
    --drop-tables+=GSUB,GPOS,DSIG --name-IDs='*' \
    --output-file="$OUT/$f.ttf"
done
report
