#!/usr/bin/env bash
# ==========================================================================
# A4print — fit-check
# --------------------------------------------------------------------------
# The feedback loop. Nobody editing a sheet can see from the markup that the
# last line fell off the page, that the bottom third is empty, or that a
# heading drifted closer to the next entry than to its own bullets. This
# turns all of it into numbers.
#
#   ./bin/fit-check.sh path/to/sheet.html [outdir]
#
# Reports, per document:
#   sheets    — how many .sheet elements the page declares
#   pages     — how many pages Chrome actually printed  (must equal sheets)
#   fill      — how full each sheet is, 100% == exactly to the bottom edge
#   verdict   — ok / under / over
#   widows    — last lines that ended up as a single short word
#   findings  — everything else fit.js measured, located and named
# and writes check.pdf, which is the printed page itself — open that to look
# at the design.
#
# One headless launch does all of it. `--print-to-pdf` produces the page, and
# fit.js — asked by the ?a4fit=1 in the URL — puts its measurements into
# document.title, which Chrome copies into the PDF metadata. Booting Chrome
# costs ~2s and the actual work ~0.3s, so not booting it twice is most of the
# runtime.
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
PDF="$OUT/check.pdf"

# ---- 1. print the page, with the measurements riding along in its title ---
# The window must be wide enough for the sheet to reach its natural width
# (min(210mm, 100%)). In a narrower window the sheet renders scaled down, and
# the handful of pixel-based hairlines stop matching the print rendering —
# enough to report a false overflow of a couple of percent.
rm -f "$PDF"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
          --virtual-time-budget=3000 --window-size=1400,2000 \
          --print-to-pdf="$PDF" "$ABS?a4fit=1" >/dev/null 2>&1

REPORT=$(python3 - "$PDF" <<'PY'
import json, re, sys, urllib.parse

try:
    d = open(sys.argv[1], 'rb').read()
except OSError:
    print('- - - -'); raise SystemExit

# fit.js writes its report into document.title, and Chrome carries it
# verbatim into the Info dictionary of the PDF.
m = re.search(rb'A4FIT sheets=(\d+) fill=([\d.,]*) fit=(\w+) audit=(\S*) A4END', d)
if m:
    sheets, fill, verdict = (g.decode() for g in m.group(1, 2, 3))
    try:
        found = json.loads(urllib.parse.unquote(m.group(4).decode()))
    except ValueError:
        found = []
else:
    sheets, fill, verdict, found = '-', '-', '-', []

p = (re.search(rb'/Type\s*/Pages\b[^>]*?/Count\s+(\d+)', d, re.S)
     or re.search(rb'/Count\s+(\d+)', d, re.S))

print(sheets, fill or '-', verdict, p.group(1).decode() if p else '-')
for f in found:
    print('%s\t%s\t%s\t%s' % (f.get('level', 'warn'), f.get('code', '?'),
                              f.get('where', '?'), f.get('detail', '')))
PY
)

read -r SHEETS FILL VERDICT PAGES <<<"$(printf '%s\n' "$REPORT" | head -1)"
FINDINGS=$(printf '%s\n' "$REPORT" | tail -n +2)
NFOUND=$(printf '%s' "$FINDINGS" | grep -c . )

# ---- 2. widows: a last line left holding one short word -------------------
WIDOWS="skipped -- install poppler for pdftotext"
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
printf '  %-9s %s\n' "sheets"   "$SHEETS"
printf '  %-9s %s\n' "pages"    "$PAGES"
printf '  %-9s %s\n' "fill"     "$FILL"
printf '  %-9s %s\n' "verdict"  "$VERDICT"
printf '  %-9s %s\n' "widows"   "$WIDOWS"
printf '  %-9s %s\n' "findings" "$NFOUND"
printf '  %-9s %s\n' "pdf"      "$PDF"
echo

if [ "$NFOUND" -gt 0 ]; then
  printf '%s\n' "$FINDINGS" | while IFS=$'\t' read -r LEVEL CODE WHERE DETAIL; do
    [ -z "$LEVEL" ] && continue
    printf '  %-5s %-12s %s\n' "$(printf '%s' "$LEVEL" | tr 'a-z' 'A-Z')" "$CODE" "$WHERE"
    printf '  %-18s %s\n' "" "$DETAIL"
  done
  echo
fi

FAIL=0
printf '%s\n' "$FINDINGS" | grep -q '^fail' && FAIL=1

if [ "$SHEETS" = "-" ]; then
  echo "  FAIL  fit.js did not report. The sheet must load js/fit.js --"
  echo "        check the <script src=\"…/js/fit.js\"> path resolves."
  FAIL=1
fi
if [ "$SHEETS" != "-" ] && [ "$PAGES" != "-" ] && [ "$SHEETS" != "$PAGES" ]; then
  echo "  FAIL  page count ($PAGES) does not match sheet count ($SHEETS)."
  echo "        Something overflowed, or a trailing break created a blank page."
  FAIL=1
fi
case "$VERDICT" in
  over)  echo "  FAIL  content overflows the sheet. Cut text, or run autofit, or add a sheet."; FAIL=1 ;;
  under) echo "  WARN  the last sheet is noticeably empty at the bottom." ;;
esac
[ "$VERDICT" = "ok" ] && [ "$FAIL" = 0 ] && [ "$NFOUND" = 0 ] &&
  echo "  OK    fits, fills the sheet, and nothing else measured wrong."
[ "$VERDICT" = "ok" ] && [ "$FAIL" = 0 ] && [ "$NFOUND" != 0 ] &&
  echo "  OK    fits and fills the sheet. The warnings above are judgement calls."
exit $FAIL
