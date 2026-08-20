# A4print

A framework for **one designed sheet of paper at a time** — cheat sheets, CVs, one-pagers,
programmes, certificates, posters — written in HTML and CSS, laid out so that the screen
and the printed page are the same thing.

Most HTML-to-PDF tooling solves the opposite problem: take long text and cut it into
pages. A4print takes a page and fits content to it.

## How it works

`.sheet` is a fixed-proportion container (`container-type: inline-size` +
`aspect-ratio`), and the entire type scale and vertical rhythm are expressed in `cqw` —
container width units. Nothing is in `px` or `pt`, so the layout cannot reflow between
screen and paper, and cannot silently spill onto a second page.

Two knobs control fit, and only two:

| | |
|---|---|
| `--t-scale` | type scale multiplier — what autofit drives; floor 0.90 |
| `--rhythm` | density of the vertical ladder — proportions preserved |

## The part that is actually new

A person can see that a sheet overflowed, or that its bottom third is empty. A language
model cannot. `bin/fit-check.sh` turns both into numbers:

```
$ ./bin/fit-check.sh examples/cv.html

  cv.html
  sheets    1
  pages     1
  fill      0.977
  verdict   ok
  widows    none
  png       …/check.png  (printed page)

  OK    fits, and fills the sheet.
```

It runs the page in headless Chrome, reads the measurements `js/fit.js` stamps onto
`<html>`, prints the document, compares the real page count against the declared sheet
count, checks for widowed last lines, and renders the **printed** page to PNG so the
layout can be looked at rather than assumed. No driver, no npm dependency — Chrome and
`python3`, plus poppler if you have it.

On screen, the same measurements drive a panel next to the Print button: live fill
percentage per sheet, sliders for scale and density, autofit, and add/remove sheet.

Autofit refuses to shrink past `--t-scale: 0.90` and says why: below that, small type in
the secondary ink levels dissolves on a mono laser printer. Cut the text or add a sheet.

## Layout

```
css/sheet.css          core + components, one file, @layer'd
css/theme/*.css        palette + type pair (resume, editorial)
css/format/*.css       Letter, A5, A3, A4 landscape
js/fit.js              fit panel + measurement API (window.A4)
bin/fit-check.sh       the verification loop
examples/              two documents built on the framework
SKILL.md               the doctrine, as a Claude Code skill
```

Cascade layers are declared as `a4.core, a4.components, a4.theme, doc` — your document's
`@layer doc { … }` outranks the framework without a single `!important`.

The two examples are a one-page CV and a language cheat sheet — between them they
exercise every component in the library. The CV's person, employers and projects are
invented; it is there to show the layout at a realistic text density.

## Scope

For long documents that should paginate themselves — reports, books, manuals — use
[Paged.js](https://pagedjs.org/) or [Vivliostyle](https://vivliostyle.org/). A4print is
deliberately about the fixed single sheet, and multi-sheet documents distribute their
content by hand.

## Quick start

```bash
cp -r examples/cv.html my-sheet.html      # then edit
./bin/fit-check.sh my-sheet.html
```

As a Claude Code skill:

```bash
git clone <this repo> ~/.claude/skills/a4print
```

## Licence

MIT — see [LICENSE](LICENSE).
