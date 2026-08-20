# A4print

Print-ready documents that look the same on screen and on paper.

Give Claude a topic and get back a finished sheet — a cheat sheet, a CV, a one-pager, a
programme, a certificate — laid out to fill exactly one page, ready to print or export to
PDF. Nothing drifts onto a second page, and nothing ends up half empty.

<table>
<tr>
<td width="50%"><img src="docs/cv.png" alt="A one-page CV laid out to fill exactly one A4 sheet"></td>
<td width="50%"><img src="docs/cheatsheet.png" alt="A one-page Lithuanian grammar cheat sheet"></td>
</tr>
</table>

<sub>Both examples, rendered as they print. Left: `examples/cv.html`. Right: `examples/cheatsheet.html`.</sub>

Built for **one designed sheet at a time**. For long documents that should paginate
themselves — reports, books, manuals — use [Paged.js](https://pagedjs.org/) or
[Vivliostyle](https://vivliostyle.org/) instead.

## Install

As a Claude Code skill:

```bash
git clone https://github.com/stass-1/A4print ~/.claude/skills/a4print
```

Claude will pick it up automatically whenever you ask for something printable.

To use it by hand instead, clone it anywhere and copy an example:

```bash
git clone https://github.com/stass-1/A4print
cp A4print/examples/cv.html my-sheet.html
```

Optional: install [poppler](https://poppler.freedesktop.org/) (`brew install poppler`) so
the checker can render the printed page and spot widowed lines.

## Use it

Just ask. The skill handles the layout, checks that the result fits, and shows you the
printed page.

> Make me an A4 cheat sheet on German separable verbs — the rule, the common prefixes,
> and a dozen examples with the verb in both positions.

> Turn `notes.md` into a one-page handout my students can keep next to them during the
> exercise.

> Build my CV from `career.md` as a single A4 sheet. Aim it at product engineering roles
> at small companies.

> Take this cheat sheet and make a Letter-size version for a US printer.

> The bottom third of the sheet is empty. Fill it out — don't just stretch what's there.

> There's too much text now. Fit it, and tell me if it stops being readable in print.

Then print it: **Chrome → Print → scale 100%, margins None, background graphics on.** Or
let Claude export the PDF for you, which avoids getting those three settings wrong.

## Check that it fits

Every sheet can be verified without opening a browser:

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

- **pages must equal sheets** — otherwise something spilled over.
- **fill** is how much of the page the content uses. Below 0.90 the sheet looks
  unfinished; above 1.00 it overflowed.
- **png** is the actual printed page, so you can look rather than guess.

On screen there's a panel next to the Print button doing the same thing live: fill
percentage, sliders for type size and density, an autofit button, and add/remove sheet.

![The fitting panel: fill percentage, type and density sliders, autofit, add and remove sheet](docs/panel.png)


Autofit will not shrink the type below 90%. Past that, small print stops surviving a
black-and-white laser printer — so it stops and tells you to cut text or add a sheet
instead.

## Adjusting a sheet by hand

Two knobs, in your document's `<style>`:

```css
@layer doc {
  .sheet {
    --t-scale: 0.95;   /* type size, everything at once */
    --rhythm:  0.92;   /* how tight the vertical spacing is */
  }
}
```

Everything else — colours, fonts, components — is documented in
[SKILL.md](SKILL.md), which is also what Claude reads.

Themes: `resume` (quiet, single colour) and `editorial` (green and amber, for teaching
material). Formats: A4, Letter, A5, A3, A4 landscape.

## Examples

`examples/cv.html` — a one-page CV. `examples/cheatsheet.html` — a Lithuanian grammar
cheat sheet. Between them they use every component in the library. The CV's person,
employers and projects are invented; it's there to show the layout at a realistic text
density.

## Licence

MIT — see [LICENSE](LICENSE).
