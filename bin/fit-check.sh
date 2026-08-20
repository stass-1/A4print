#!/usr/bin/env bash
# ==========================================================================
# A4print — fit-check
# --------------------------------------------------------------------------
# The feedback loop. A model editing a sheet cannot see that the last line
# fell off the page or that the bottom third is empty; this turns both into
# numbers and a picture.
#
#   ./bin/fit-check.sh path/to/sheet.html [outdir]
#
# Reports, per document:
#   sheets    — how many .sheet elements the page declares
#   pages     — how many pages Chrome actually printed  (must equal sheets)
#   fill      — how full each sheet is, 100% == exactly to the bottom edge
#   verdict   — ok / under / over
#   widows    — last lines that ended up as a single short word
# and writes check.pdf + check.png next to the report for eyeballing.
#
# Needs: Google Chrome, python3. pdftotext (poppler) enables the widow check.
# ==========================================================================
set -uo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="${1:-}"
OUT="${2:-$(dirname "${SRC:-.}")/.fitcheck}"

if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: fit-check.sh <file.html> [outdir]" >&2; exit 2
fi
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME  (set \$CHROME)" >&2; exit 2
fi

mkdir -p "$OUT"
ABS="file://$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
DOM="$OUT/dom.html"; PDF="$OUT/check.pdf"; PNG="$OUT/check.png"

# ---- 1. run the page and read what fit.js stamped on <html> ---------------
# The window must be wide enough for the sheet to reach its natural width
# (min(210mm, 100%)). In a narrower window the sheet renders scaled down, and
# the handful of pixel-based hairlines stop matching the print rendering —
# enough to report a false overflow of a couple of percent.
"$CHROME" --headless --disable-gpu --virtual-time-budget=3000 \
          --window-size=1400,2000 \
          --dump-dom "$ABS" > "$DOM" 2>/dev/null

read -r SHEETS FILL VERDICT <<<"$(python3 - "$DOM" <<'PY'
import re, sys
html = open(sys.argv[1], encoding='utf-8', errors='replace').read(400000)
def attr(name, default='-'):
    m = re.search(r'data-%s="([^"]*)"' % name, html)
    return m.group(1) if m else default
print(attr('sheets'), attr('fill'), attr('fit'))
PY
)"

# ---- 2. print it and count the pages Chrome really produced ---------------
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
          --print-to-pdf="$PDF" "$ABS" >/dev/null 2>&1

PAGES=$(python3 - "$PDF" <<'PY'
import re, sys
try:
    d = open(sys.argv[1], 'rb').read()
except OSError:
    print('-'); raise SystemExit
m = re.search(rb'/Type\s*/Pages\b[^>]*?/Count\s+(\d+)', d, re.S)
if not m:
    m = re.search(rb'/Count\s+(\d+)', d, re.S)
print(m.group(1).decode() if m else '-')
PY
)

# ---- 3. a picture, so the layout can actually be looked at ----------------
# Render the PDF, not the screen: the printed page is what is being judged.
# A screen grab shows the toolbar, and resolves to the dark palette whenever
# the machine prefers dark — neither of which will ever reach paper.
if command -v pdftoppm >/dev/null 2>&1; then
  pdftoppm -png -r 96 "$PDF" "$OUT/page" >/dev/null 2>&1
  FIRST=$(ls "$OUT"/page-*.png 2>/dev/null | head -1)
  [ -n "$FIRST" ] && cp "$FIRST" "$PNG"
  PNG_NOTE="printed page"
else
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
            --window-size=1200,1700 --screenshot="$PNG" "$ABS" >/dev/null 2>&1
  PNG_NOTE="screen grab — install poppler to see the printed page instead"
fi

# ---- 4. widows: a last line left holding one short word -------------------
WIDOWS="skipped (install poppler for pdftotext)"
if command -v pdftotext >/dev/null 2>&1; then
  WIDOWS=$(pdftotext -layout "$PDF" - 2>/dev/null | python3 - <<'PY'
import sys
bad = []
prev = ''
for raw in sys.stdin:
    line = raw.strip()
    if prev and not line and len(prev.split()) == 1 and len(prev) < 14 and prev[-1] not in ':·':
        bad.append(prev)
    if line: prev = line
    else: prev = ''
print('; '.join(bad[:6]) if bad else 'none')
PY
)
fi

# ---- report ---------------------------------------------------------------
printf '\n  %s\n' "$(basename "$SRC")"
printf '  %-9s %s\n' "sheets"  "$SHEETS"
printf '  %-9s %s\n' "pages"   "$PAGES"
printf '  %-9s %s\n' "fill"    "$FILL"
printf '  %-9s %s\n' "verdict" "$VERDICT"
printf '  %-9s %s\n' "widows"  "$WIDOWS"
printf '  %-9s %s\n' "pdf"     "$PDF"
printf '  %-9s %s\n' "png"     "$PNG  ($PNG_NOTE)"
echo

FAIL=0
if [ "$SHEETS" != "-" ] && [ "$PAGES" != "-" ] && [ "$SHEETS" != "$PAGES" ]; then
  echo "  FAIL  page count ($PAGES) does not match sheet count ($SHEETS)."
  echo "        Something overflowed, or a trailing break created a blank page."
  FAIL=1
fi
case "$VERDICT" in
  over)  echo "  FAIL  content overflows the sheet. Cut text, or run autofit, or add a sheet."; FAIL=1 ;;
  under) echo "  WARN  the last sheet is noticeably empty at the bottom." ;;
  ok)    [ "$FAIL" = 0 ] && echo "  OK    fits, and fills the sheet." ;;
esac
exit $FAIL
