#!/usr/bin/env bash
# Build the self-hosted map assets for Sibiu (ADR 0014, architecture 11 and 16):
#   apps/web/public/tiles/sibiu.pmtiles     vector tiles (Protomaps basemap, OpenStreetMap data)
#   apps/web/public/glyphs/<font>/<range>.pbf   label glyphs (ranges 0-255, 256-511, 512-767)
#   apps/web/public/sprites/light{,@2x}.{json,png}   map sprites
#
# Usage:   scripts/geo/build-tiles.sh            (from anywhere)
# Needs:   pmtiles CLI (https://github.com/protomaps/go-pmtiles/releases), curl
# Refresh: quarterly (deploy.md 6). Run it, commit the changed files in a PR. Cloudflare Pages
#          refuses files over 25 MiB, so maxzoom drops from 15 to 14 when the extract is too big.
#
# Environment overrides:
#   PROTOMAPS_BUILD  a build URL or file name such as 20261101.pmtiles (default: newest of the last
#                    14 days from https://build.protomaps.com/)
#   MAX_ZOOM         starting maxzoom, default 15
#   FONTS            comma-separated glyph fonts, default "Noto Sans Regular,Noto Sans Medium,Noto Sans Italic"
#                    (must match the font names used by the map style in apps/web)
#   SPRITE           sprite flavour, default "light"
#
# Licences: map data (c) OpenStreetMap contributors, ODbL 1.0. Protomaps basemap tiles are
# distributed under the same terms. Noto fonts: SIL OFL 1.1. Keep the attribution visible in the map.
set -euo pipefail

BBOX="23.98,45.68,24.32,45.86"   # west,south,east,north. Same box as the gazetteer and COVERAGE_BBOX.
MAX_BYTES=$((25 * 1024 * 1024))
MAX_ZOOM="${MAX_ZOOM:-15}"
FONTS="${FONTS:-Noto Sans Regular,Noto Sans Medium,Noto Sans Italic}"
SPRITE="${SPRITE:-light}"
ASSETS_BASE="https://protomaps.github.io/basemaps-assets"
BUILDS_BASE="https://build.protomaps.com"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/web/public"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: '$1' is required. $2" >&2
    exit 2
  }
}
need curl "Install curl."
need pmtiles "Install go-pmtiles: https://github.com/protomaps/go-pmtiles/releases (or: brew install pmtiles)."

# 1. Pick the planet build ------------------------------------------------------------------
resolve_build() {
  if [[ -n "${PROTOMAPS_BUILD:-}" ]]; then
    case "$PROTOMAPS_BUILD" in
      http*) echo "$PROTOMAPS_BUILD" ;;
      *) echo "$BUILDS_BASE/$PROTOMAPS_BUILD" ;;
    esac
    return
  fi
  local i day url
  for i in $(seq 0 14); do
    day="$(date -u -d "-$i day" +%Y%m%d 2>/dev/null || date -u -v-"${i}"d +%Y%m%d)"
    url="$BUILDS_BASE/$day.pmtiles"
    if curl -fsI "$url" >/dev/null 2>&1; then
      echo "$url"
      return
    fi
  done
  echo "error: no Protomaps build found in the last 14 days; set PROTOMAPS_BUILD" >&2
  exit 1
}
SOURCE="$(resolve_build)"
echo "Source build: $SOURCE"

# 2. Extract Sibiu, shrinking maxzoom until the file fits Pages' 25 MiB limit ---------------------
mkdir -p "$OUT/tiles"
TMP="$OUT/tiles/.sibiu.tmp.pmtiles"
trap 'rm -f "$TMP"' EXIT
zoom="$MAX_ZOOM"
while :; do
  echo "Extracting bbox $BBOX at maxzoom $zoom"
  rm -f "$TMP"
  pmtiles extract "$SOURCE" "$TMP" --bbox="$BBOX" --maxzoom="$zoom"
  size="$(wc -c <"$TMP" | tr -d ' ')"
  echo "  size: $size bytes"
  if ((size <= MAX_BYTES)); then
    break
  fi
  if ((zoom <= 13)); then
    echo "error: extract is still over 25 MiB at maxzoom $zoom" >&2
    exit 1
  fi
  zoom=$((zoom - 1))
done
mv "$TMP" "$OUT/tiles/sibiu.pmtiles"
trap - EXIT
echo "Wrote $OUT/tiles/sibiu.pmtiles (maxzoom $zoom)"

# 3. Glyphs ---------------------------------------------------------------------------------------
IFS=',' read -r -a font_list <<<"$FONTS"
for font in "${font_list[@]}"; do
  font="$(echo "$font" | sed 's/^ *//;s/ *$//')"
  dir="$OUT/glyphs/$font"
  mkdir -p "$dir"
  for range in 0-255 256-511 512-767; do
    url="$ASSETS_BASE/fonts/$(printf '%s' "$font" | sed 's/ /%20/g')/$range.pbf"
    curl -fsSL "$url" -o "$dir/$range.pbf"
  done
  echo "Wrote glyphs for $font"
done

# 4. Sprites --------------------------------------------------------------------------------------
mkdir -p "$OUT/sprites"
for suffix in "" "@2x"; do
  for ext in json png; do
    curl -fsSL "$ASSETS_BASE/sprites/v4/$SPRITE$suffix.$ext" -o "$OUT/sprites/$SPRITE$suffix.$ext"
  done
done
echo "Wrote sprites ($SPRITE)"

echo "Done. Commit apps/web/public/{tiles,glyphs,sprites} in a PR (check: du -sh apps/web/public/tiles)."
