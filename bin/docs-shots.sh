#!/usr/bin/env bash
# ==========================================================================
# A4print — docs-shots
# --------------------------------------------------------------------------
# The pictures in the README are renders of the examples, and the examples
# keep changing. A margin fix or a new component moves every line on the
# page, and a screenshot taken by hand months ago goes on showing a layout
# the repository no longer produces. So the pictures are generated:
#
#   ./bin/docs-shots.sh              # rewrite every image in docs/
#   ./bin/docs-shots.sh cv panel     # only these
#   ./bin/docs-shots.sh --check      # render to a temp dir and compare
#
# --check renders into a scratch directory and byte-compares with docs/. It
# answers one question — has an example changed since its picture was taken
# — and exits non-zero if it has. Two different machines will not agree on
# the bytes (fonts, Chrome build), so use it where the images were made.
#
# There are two kinds of picture here:
#
#   page   — the sheet as it prints. Chrome prints the PDF, pdftoppm renders
#            a page of it at 150dpi, which is exactly 1240x1754 for A4. This
#            is the printed artefact, not a photo of a browser: no toolbar,
#            no panel, margins the ones the paper will get.
#
#   screen — the top of the window: the print bar and the fitting panel, at
#            2x. Chrome only screenshots a whole viewport, so the framing is
#            done by sizing the window: 818px wide is the sheet's own 210mm
#            plus the body's two 12px gutters, and the height comes from
#            measuring the panel in a first pass and cutting just below it.
#            Both passes run at the same width, or the panel's flex rows
#            would wrap differently in the one that gets photographed.
#
# Headless Chrome reports itself as preferring a dark colour scheme, and both
# themes answer prefers-color-scheme, so the screen shot would come out in
# the dark palette while the printed pages stay on white paper. LIGHT below
# pins it, and the README keeps one look.
#
# Needs: Google Chrome, python3, pdftoppm (poppler: brew install poppler).
# ==========================================================================
set -uo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
LIGHT="--blink-settings=preferredColorScheme=1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS="$ROOT/docs"

# name : source : kind : page
SHOTS="
cv:examples/cv.html:page:1
cheatsheet:examples/cheatsheet.html:page:1
wall-1:examples/wall.html:page:1
wall-2:examples/wall.html:page:2
panel:examples/cheatsheet.html:screen:-
"

CHECK=0
WANT=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *)  WANT="$WANT $arg" ;;
  esac
done

[ -x "$CHROME" ] || {
  echo "Chrome not found at: $CHROME  (set \$CHROME)" >&2; exit 2; }
command -v pdftoppm >/dev/null 2>&1 || {
  echo "pdftoppm not found — install poppler (brew install poppler)" >&2; exit 2; }

# A misspelt name would otherwise render nothing and report success.
KNOWN=$(printf '%s\n' "$SHOTS" | cut -d: -f1 | grep .)
for want in $WANT; do
  printf '%s\n' "$KNOWN" | grep -qx "$want" || {
    echo "no such picture: $want" >&2
    echo "known: $(printf '%s ' $KNOWN)" >&2
    exit 2; }
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/a4shots.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
DEST="$DOCS"
[ "$CHECK" = 1 ] && DEST="$TMP/out" && mkdir -p "$DEST"
mkdir -p "$DOCS"

# ---- a page of the printed PDF -------------------------------------------
shoot_page() {                                   # src, page, dest.png
  local src="$1" page="$2" dest="$3"
  local abs="file://$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer "$LIGHT" \
            --virtual-time-budget=3000 --window-size=1400,2000 \
            --print-to-pdf="$TMP/page.pdf" "$abs" >/dev/null 2>&1
  [ -s "$TMP/page.pdf" ] || { echo "  Chrome printed nothing for $src" >&2; return 1; }
  # poppler grumbles about Type 3 glyph bounding boxes on every Chrome PDF;
  # it renders them correctly regardless.
  pdftoppm -r 150 -png -f "$page" -l "$page" -singlefile \
           "$TMP/page.pdf" "${dest%.png}" 2>/dev/null
}

# ---- the print bar and the fitting panel, from the screen -----------------
# The example is copied to a temp file with a <base> pointing back at its own
# directory, so ../css and ../js still resolve, plus a script that measures
# the panel and stamps the number on <html> for the first pass to read.
shoot_screen() {                                 # src, dest.png
  local src="$1" dest="$2" w=818
  python3 - "$src" "$TMP/screen.html" <<'PY'
import pathlib, sys
src = pathlib.Path(sys.argv[1]).resolve()
base = '<base href="%s/">' % src.parent.as_uri().rstrip('/')
probe = '''
<script>
  addEventListener('load', function () {
    var stamp = function () {
      setTimeout(function () {
        var r = document.querySelector('.fitbar').getBoundingClientRect();
        document.documentElement.setAttribute('data-panel-bottom',
                                              Math.ceil(r.bottom));
      }, 80);
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(stamp);
    else stamp();
  });
</script>
'''
html = src.read_text()
html = html.replace('<head>', '<head>\n' + base, 1)
html = html.replace('</body>', probe + '</body>', 1)
pathlib.Path(sys.argv[2]).write_text(html)
PY
  local url="file://$TMP/screen.html"

  # pass 1 — how tall is the panel at this width
  local bottom
  bottom=$("$CHROME" --headless --disable-gpu "$LIGHT" --virtual-time-budget=4000 \
                     --window-size=$w,1400 --dump-dom "$url" 2>/dev/null |
           sed -n 's/.*data-panel-bottom="\([0-9]*\)".*/\1/p' | head -1)
  [ -n "$bottom" ] || { echo "  could not measure the panel in $src" >&2; return 1; }

  # pass 2 — the same width, cut 42px below the panel: the body's 18px gap
  # and a slice of the sheet's top edge, so the panel is seen sitting on
  # something rather than floating.
  "$CHROME" --headless --disable-gpu "$LIGHT" --virtual-time-budget=4000 \
            --force-device-scale-factor=2 --hide-scrollbars \
            --window-size=$w,$((bottom + 42)) \
            --screenshot="$dest" "$url" >/dev/null 2>&1
  [ -s "$dest" ]
}

# ---- run ------------------------------------------------------------------
printf '\n'
printf '%s\n' "$SHOTS" | while IFS=: read -r NAME SRC KIND PAGE; do
  [ -z "$NAME" ] && continue
  case " $WANT " in *" $NAME "*|"  ") ;; *) continue ;; esac

  OUTPNG="$DEST/$NAME.png"
  if [ "$KIND" = page ]; then
    shoot_page "$ROOT/$SRC" "$PAGE" "$OUTPNG" || continue
  else
    shoot_screen "$ROOT/$SRC" "$OUTPNG" || continue
  fi

  SIZE=$(python3 -c "
import struct, sys
d = open(sys.argv[1], 'rb').read(33)
w, h = struct.unpack('>II', d[16:24])
print('%dx%d' % (w, h))" "$OUTPNG" 2>/dev/null || echo '?')

  if [ "$CHECK" = 1 ]; then
    if cmp -s "$OUTPNG" "$DOCS/$NAME.png"; then
      printf '  %-15s %-11s up to date\n' "$NAME.png" "$SIZE"
    else
      printf '  %-15s %-11s STALE — %s has changed since\n' \
             "$NAME.png" "$SIZE" "$SRC"
      echo stale >> "$TMP/stale"
    fi
  else
    printf '  %-15s %-11s %s\n' "$NAME.png" "$SIZE" "$SRC"
  fi
done

echo
[ -f "$TMP/stale" ] && { echo "  Run ./bin/docs-shots.sh to rebuild them."; echo; exit 1; }
exit 0
