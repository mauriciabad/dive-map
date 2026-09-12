#!/usr/bin/env bash
# Builds the SDF glyph stacks, the WOFF2 web faces and the licence that static/fonts serves.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/data/build/fonts"
GLYPH_SRC="$BUILD/glyph-src"
GLYPH_OUT="$BUILD/glyph-out"
OUT="$ROOT/static/fonts"

UPSTREAM="https://raw.githubusercontent.com/google/fonts/main"
FONTTOOLS='fonttools[woff]==4.62.0'
GLYPHORE='@kartore/glyphore@0.2.0'

UNICODES='U+0020-007E,U+00A0-00FF,U+0131,U+013F-0140,U+0152-0153,U+0178,U+2007,U+2009,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2030,U+2039-203A,U+20AC,U+2212'

DOWNLOADS=(
  "ofl/alegreya/Alegreya%5Bwght%5D.ttf|Alegreya[wght].ttf|ba5564634b93a8f8ba57b48cd4f1ae7417d2b4656fbac779028679b00de3cf12"
  "ofl/alegreyasans/AlegreyaSans-Regular.ttf|AlegreyaSans-Regular.ttf|8fab634196007afca839f1e5a6fb300976daff55d8528b590ef032f01b14ea10"
  "ofl/alegreyasans/AlegreyaSans-Bold.ttf|AlegreyaSans-Bold.ttf|a3055a1893759bdbd7504bb22abc583769e7974c49353176eac0b03792c9fb8e"
  "ofl/alegreya/OFL.txt|OFL-alegreya.txt|"
  "ofl/alegreyasans/OFL.txt|OFL-alegreyasans.txt|"
)

FACES=(
  "AlegreyaSans-Regular.ttf|alegreya-sans-400|yes"
  "AlegreyaSans-Bold.ttf|alegreya-sans-700|yes"
  "Alegreya-Regular.ttf|alegreya-400|no"
  "Alegreya-Bold.ttf|alegreya-700|yes"
)

STACKS=("Alegreya Sans Regular" "Alegreya Sans Bold" "Alegreya Bold")
RANGES=(0-255 256-511 8192-8447 8704-8959)
EXPECTED=$(( ${#FACES[@]} + 1 + ${#STACKS[@]} * ${#RANGES[@]} ))

for tool in uv npx curl shasum; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

size_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

sum_bytes() {
  local total=0 f
  for f in "$@"; do total=$(( total + $(size_bytes "$f") )); done
  printf '%s\n' "$total"
}

stage() {
  local out=$1; shift
  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  local part="${out%.*}.part.${out##*.}"
  rm -f "$part"
  "$@" "$part"
  mv "$part" "$out"
}

fetch() {
  local url=$1 dst=$2 want=$3 got
  if [ -f "$dst" ] && { [ -z "$want" ] || [ "$(shasum -a 256 "$dst" | cut -d' ' -f1)" = "$want" ]; }; then
    printf 'have %s\n' "$dst"
    return 0
  fi
  printf 'download %s\n' "$url"
  curl -fsSL -o "$dst.part" "$url"
  if [ -n "$want" ]; then
    got="$(shasum -a 256 "$dst.part" | cut -d' ' -f1)"
    if [ "$got" != "$want" ]; then
      rm -f "$dst.part"
      printf 'checksum mismatch for %s: got %s, want %s\n' "$dst" "$got" "$want" >&2
      exit 1
    fi
  fi
  mv "$dst.part" "$dst"
}

instance() {
  local src=$1 weight=$2 dst=$3
  # Without --update-name-table the instance keeps the variable font's "Alegreya Regular" name and the glyph stack comes out named wrong.
  # --no-recalc-timestamp keeps head.modified from the source, so a rebuild is byte-identical rather than restamping the two woff2 every run.
  uv run --quiet --python 3.12 --with "$FONTTOOLS" \
    fonttools varLib.instancer --update-name-table --no-recalc-timestamp \
    -o "$dst" "$src" "wght=$weight"
}

subset() {
  local src=$1 flavor=$2 dst=$3
  # --name-IDs='*' keeps the name table glyphore reads to derive the fontstack directory, and the OFL text at name ID 13.
  uv run --quiet --python 3.12 --with "$FONTTOOLS" pyftsubset "$src" \
    --output-file="$dst" --unicodes="$UNICODES" --layout-features='' \
    --name-IDs='*' --name-legacy --notdef-outline --no-hinting --desubroutinize \
    ${flavor:+"--flavor=$flavor"}
}

licence() {
  local dst=$1 serif="$BUILD/OFL-alegreya.txt" sans="$BUILD/OFL-alegreyasans.txt"
  cmp -s <(tail -n +3 "$serif") <(tail -n +3 "$sans") || {
    printf 'the two upstream OFL bodies no longer match, %s vs %s\n' "$serif" "$sans" >&2
    exit 1
  }
  { head -n 1 "$serif"; head -n 1 "$sans"; tail -n +2 "$serif"; } > "$dst"
}

stacks_complete() {
  local stack range
  for stack in "${STACKS[@]}"; do
    for range in "${RANGES[@]}"; do
      [ -f "$OUT/$stack/$range.pbf" ] || return 1
    done
  done
}

outputs_complete() {
  local row name
  [ -f "$OUT/OFL.txt" ] || return 1
  for row in "${FACES[@]}"; do
    IFS='|' read -r _ name _ <<<"$row"
    [ -f "$OUT/$name.woff2" ] || return 1
  done
  stacks_complete
}

build_glyphs() {
  local stack want got
  rm -rf "$GLYPH_OUT"
  mkdir -p "$GLYPH_OUT"
  npx --yes "$GLYPHORE" build "$GLYPH_SRC" -o "$GLYPH_OUT"

  want="$(printf '%s\n' "${STACKS[@]}" | sort)"
  got="$(cd "$GLYPH_OUT" && printf '%s\n' * | sort)"
  [ "$got" = "$want" ] || {
    printf 'glyphore emitted other stacks than expected\ngot:\n%s\nwant:\n%s\n' "$got" "$want" >&2
    exit 1
  }

  want="$(printf '%s.pbf\n' "${RANGES[@]}" | sort)"
  for stack in "${STACKS[@]}"; do
    got="$(cd "$GLYPH_OUT/$stack" && printf '%s\n' * | sort)"
    [ "$got" = "$want" ] || {
      printf 'glyphore emitted other ranges than expected in %s\ngot:\n%s\nwant:\n%s\n' "$stack" "$got" "$want" >&2
      exit 1
    }
  done

  for stack in "${STACKS[@]}"; do
    rm -rf "$OUT/$stack"
    mv "$GLYPH_OUT/$stack" "$OUT/$stack"
  done
}

report() {
  local row name stack range
  local -a pbf=() woff=()
  for stack in "${STACKS[@]}"; do
    for range in "${RANGES[@]}"; do pbf+=("$OUT/$stack/$range.pbf"); done
  done
  for row in "${FACES[@]}"; do
    IFS='|' read -r _ name _ <<<"$row"
    woff+=("$OUT/$name.woff2")
  done

  printf 'glyphs %s files, %s bytes\n' "${#pbf[@]}" "$(sum_bytes "${pbf[@]}")"
  for stack in "${STACKS[@]}"; do printf '  %s\n' "$OUT/$stack"; done
  printf 'woff2 %s files, %s bytes\n' "${#woff[@]}" "$(sum_bytes "${woff[@]}")"
  for name in "${woff[@]}"; do printf '  %s\n' "$name"; done
  printf 'licence %s, %s bytes\n' "$OUT/OFL.txt" "$(size_bytes "$OUT/OFL.txt")"
}

if outputs_complete; then
  printf 'have %s (%s files)\n' "$OUT" "$EXPECTED"
  report
  exit 0
fi

mkdir -p "$BUILD" "$GLYPH_SRC" "$OUT"

for row in "${DOWNLOADS[@]}"; do
  IFS='|' read -r path name sha <<<"$row"
  fetch "$UPSTREAM/$path" "$BUILD/$name" "$sha"
done

stage "$BUILD/Alegreya-Regular.ttf" instance "$BUILD/Alegreya[wght].ttf" 400
stage "$BUILD/Alegreya-Bold.ttf" instance "$BUILD/Alegreya[wght].ttf" 700

for row in "${FACES[@]}"; do
  IFS='|' read -r src name glyphs <<<"$row"
  if [ "$glyphs" = yes ]; then
    stage "$GLYPH_SRC/$src" subset "$BUILD/$src" ''
  fi
done

if stacks_complete; then
  for stack in "${STACKS[@]}"; do printf 'have %s\n' "$OUT/$stack"; done
else
  build_glyphs
fi

for row in "${FACES[@]}"; do
  IFS='|' read -r src name _ <<<"$row"
  stage "$OUT/$name.woff2" subset "$BUILD/$src" woff2
done

stage "$OUT/OFL.txt" licence

report
