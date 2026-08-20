---
name: a4print
description: Build a print-ready designed sheet — a one-page cheat sheet, CV, one-pager, programme, certificate, poster, menu or handout — as HTML that looks identical on screen and on paper. Use whenever the deliverable is meant to be printed or exported to PDF at a fixed page size, or when asked for "a one-pager", "an A4 sheet", "something to print", "a PDF via print". Includes a component library, two themes, and a headless fit-check that reports whether the content actually fits the page and fills it.
---

# A4print — designed sheets that fit

## What this is

A framework for **one fixed sheet of paper at a time**. The sheet is a fixed-proportion
container; the entire type scale and vertical rhythm are expressed in `cqw` (container
width units). Screen and paper are therefore the same layout, and content cannot
silently spill onto a second page.

**Use it for:** cheat sheets, CVs, one-pagers, programmes, menus, certificates, posters,
invoices, handouts, conference leave-behinds — anything designed to a page.

**Do not use it for:** long flowing documents that should paginate themselves (reports,
books, manuals). That is a different problem and needs Paged.js or Vivliostyle. Say so
rather than forcing a report into this.

## Non-negotiable: run the fit check

A sheet that overflows loses its last line; a sheet that is 60% full looks unfinished.
Neither is visible from the markup, so **never** declare a sheet done without:

```bash
./bin/fit-check.sh path/to/sheet.html
```

It reports `sheets` / `pages` / `fill` / `verdict` / `widows`, and writes a PNG of the
**printed page** — read that image, do not assume. Requirements: `pages` must equal
`sheets`, `verdict` must be `ok`. A `fill` under 0.90 means a hole at the bottom; fix it
by adding content or by tightening the format, not by ignoring it.

## Start from this skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>…</title>
<link rel="stylesheet" href="css/sheet.css">     <!-- must come first -->
<link rel="stylesheet" href="css/theme/resume.css">
<style>
@layer doc {            /* your overrides — outrank the framework, no !important */
  .sheet { --t-display-n: 4.7; }
}
</style>
</head>
<body>
  <div class="bar">
    <p>…printing hint…</p>
    <button class="print-btn" type="button" onclick="window.print()">Print</button>
  </div>

  <article class="sheet">
    <div class="flow">      <!-- content ALWAYS goes inside .flow -->
      …
    </div>
  </article>

  <script src="js/fit.js"></script>
</body>
</html>
```

Themes: `theme/resume.css` (one hue, no highlights — dense professional sheets) or
`theme/editorial.css` (green structure + amber payload — reference cards, teaching
material). Formats: A4 by default; add `css/format/letter.css`, `a5.css`, `a3.css` or
`a4-landscape.css` after `sheet.css`.

## Components

| Block | Use |
|---|---|
| `.mast` + `.eyebrow` + `h1` + `.sub` + `.mast__aside` | masthead; the aside is a free slot — contacts, a date, the question the sheet answers |
| `.band-label` | section label with a trailing rule; `<span>` inside is a second, quieter half |
| `.lede` | opening paragraph |
| `.entries` / `.entry` | list of things with a heading, aside, note and body. `.entries--ruled` for hairlines between, `.entry--split` for numbered three-column rows |
| `.entry__head` `.entry__title` `.org` `.entry__meta` `.note` | the parts of an entry heading |
| `.pairs` (dl) | key/value grid |
| `.pairs--transform` / `.pair` + `__from __mark __to __eg` | a → b with an example |
| `.cols` (`--cols`), `.cols--ruled` | columns, optionally hairline-separated |
| `.stats` / `.stat` + `__num __label` | a figure worth staring at |
| `.callout` `.callout--split` | one boxed fact. At most one per sheet, and never on a CV |
| `.fine` | petit, multi-column |
| `.footline` `.footline--split` `.folio` | bottom line; springs to the foot of the sheet |
| `.muted` | a whole block one notch quieter |

Inline atoms — reach here before inventing anything:
`.sep` (·) `.arr` (→) `.gloss` `.dim` `.faint` `.accent` `.nb` `.roman` `u` `kbd`

## The two knobs

`--t-scale` — type scale multiplier. This is what autofit drives. Floor is **0.90**:
below it, secondary ink levels at small sizes dissolve on a mono laser printer. If a
sheet only fits under 0.90, the answer is to cut text or add a sheet, never to shrink
further.

`--rhythm` — density of the vertical ladder. `.loose` 1.06 · default 1 · `.snug` .95 ·
`.tight` .88.

Every gap is `Ncqw × --rhythm`, and **the proportion between them is the grouping**:
`lede→section` > `section` > `entry` > `heading→bullets` ≈ `bullet→bullet`. A heading must
sit visibly closer to its own bullets than to the next entry. Tighten with `--rhythm`;
never edit individual gaps, or the ladder flattens into evenly spaced mush.

Type sizes: override the **number** (`--t-body-n: 1.82`), never the computed value —
`--t-scale` has to stay the single multiplier.

## Slack goes into springs, not into everything

Do not distribute leftover space evenly; that destroys the ladder. Mark the one or two
places where the design permits stretch with `.spring` (or `.spring--grow`); `.footline`
is a spring already. Everything else keeps its fixed rhythm.

## Two fitting strategies — pick one deliberately

- **`fit: scale`** — change the type scale and rhythm, leave the layout alone. For sheets
  whose structure is fixed and whose text a human owns. CVs.
- **`fit: reflow`** — change column counts, regroup, split across sheets. For sheets whose
  content you are free to recut. Cheat sheets, reference cards.

## More than one sheet

Multiple sibling `.sheet` elements, each with its own `.flow`. Each stays a fixed page;
print breaks between them automatically. **Distribute the content yourself** — there is
no auto-flow, deliberately: on a designed sheet you decide what lands on page two.
`window.A4.addSheet()` / the `+ лист` button add one.

## The panel

`js/fit.js` renders a screen-only panel: live fill percentage per sheet (green fits,
amber hole, red overflow), sliders for scale and density, autofit, add/remove sheet. It
also stamps `data-fill` / `data-sheets` / `data-fit` on `<html>`, which is how
`fit-check.sh` reads the numbers back without a browser driver.

API: `A4.measure(sheet)` `A4.measureAll()` `A4.autofit(sheet)` `A4.autofitAll()`
`A4.report()` `A4.addSheet()` `A4.removeSheet()`.

## Doctrine — the things that ruin a sheet

- **No second accent.** A theme has one structural colour and one payload colour. A third
  is always a mistake.
- **No second separator.** The sheet uses `·`. Adding an en dash or a pipe as well makes
  the page look assembled by two people.
- **Hierarchy from size and colour, not from boxes.** Borders, tinted panels and left bars
  are noise on a dense sheet. `.callout` exists for the rare fact that outranks
  everything else — one per sheet at most.
- **Letter-spacing, not spaced-out letters.** Never type `S K I L L S`; it breaks kerning
  and ATS parsing.
- **Print colours are darker than screen colours.** The themes already raise the floor on
  secondary ink and rules under `@media print`. Keep the steps `ink > ink-2 > ink-3`
  intact — flattening them "for contrast" destroys the hierarchy they carry.
- **Watch the widows.** `text-wrap: pretty` is on for running text; use `.nb` to glue
  compound terms. `fit-check.sh` reports the ones that survive.
- **One column parses.** If the sheet may be read by a machine (a CV by an ATS), stay
  single-column.

## Printing, for real

Export through headless Chrome, not through the user's print dialog — people forget the
100% scale, the `None` margins and the background graphics, and get a wrong page:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=out.pdf "file:///abs/path/sheet.html"
```

The on-screen Print button stays as a convenience; the hint text next to it should always
name the three settings.
