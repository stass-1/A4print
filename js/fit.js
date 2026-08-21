/* ==========================================================================
   A4print — fit.js
   --------------------------------------------------------------------------
   The screen-only fitting panel, and the measurement API behind it.

   Why this exists: a designer can see that a sheet is 60% full with a hole at
   the bottom, or that the last line has fallen off the page. A language model
   cannot. This file turns "does it fit, and does it look full" into a number,
   for the person at the screen and for the agent running headless Chrome.

   Headless use: the script writes the result onto <html> as
     data-fill="0.97,0.62"  data-sheets="2"  data-fit="ok|under|over"
   so `chrome --headless --dump-dom` is enough to read it back. And when the
   URL carries ?a4fit=1 those numbers and the full list of findings go into
   document.title, which Chrome copies into the metadata of `--print-to-pdf`
   output — so a single headless launch yields both the printed page and
   everything measured on it. No driver, no dependency.

   Public API — window.A4:
     measure(sheet)        → fill ratio, 1.0 == exactly full
     measureAll()          → array of ratios
     autofit(sheet)        → {ok, scale, fill, reason}
     autofitAll()          → array of results
     audit(sheet, i)       → [{level, code, where, detail}] — see Audit below
     auditAll()            → the same across every sheet, failures first
     report()              → {fills, sheets, verdict, findings}, stamps <html>
     addSheet() / removeSheet()
   ========================================================================== */
(function () {
  'use strict';

  /* Below this the sheet stops being printable: small type in the secondary
     ink levels starts dissolving on a mono laser printer. Autofit refuses to
     go further and says so, rather than quietly shipping an unreadable page. */
  var MIN_SCALE = 0.90;
  var MAX_SCALE = 1.30;
  var TARGET    = 0.985;  /* aim to fill the sheet to just under the edge */
  var UNDERFULL = 0.90;   /* below this the sheet reads as having a hole   */
  var STEPS     = 18;

  function sheets() {
    return Array.prototype.slice.call(document.querySelectorAll('.sheet'));
  }
  function flowOf(sheet) {
    return sheet.querySelector('.flow') || sheet;
  }

  /* ---- measurement ------------------------------------------------------
     Springs are collapsed first. A spring (.spring, .footline) pushes itself
     to the bottom of the sheet, so with springs live every sheet measures as
     exactly full and the number is worthless. */
  function measure(sheet) {
    var flow = flowOf(sheet);
    sheet.classList.add('is-measuring');
    var box = flow.getBoundingClientRect();
    var bottom = box.top;
    var kids = flow.children;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;   /* display:none */
      if (r.bottom > bottom) bottom = r.bottom;
    }
    /* The children's rects are the primary measure — they are the only thing
       that reads correctly on a half-empty sheet. scrollHeight is consulted
       ONLY when it actually signals overflow (a long word, an oversized
       image escaping its own box); on an underfull sheet it simply equals
       the flow height and would report a false 100%. */
    var used = bottom - box.top;
    if (flow.scrollHeight > flow.clientHeight + 1) {
      used = Math.max(used, flow.scrollHeight);
    }
    sheet.classList.remove('is-measuring');
    return box.height > 0 ? used / box.height : 0;
  }

  function measureAll() { return sheets().map(measure); }

  /* ---- autofit ----------------------------------------------------------
     Binary search on --t-scale for the largest scale that still fits. Only
     the type scale moves; the rhythm ladder keeps its proportions, so the
     grouping the design depends on survives the fit. */
  function autofit(sheet) {
    var lo = MIN_SCALE, hi = MAX_SCALE, best = null;

    for (var i = 0; i < STEPS; i++) {
      var mid = (lo + hi) / 2;
      sheet.style.setProperty('--t-scale', mid.toFixed(4));
      var fill = measure(sheet);
      if (fill <= TARGET) { best = { scale: mid, fill: fill }; lo = mid; }
      else { hi = mid; }
      if (hi - lo < 0.002) break;
    }

    if (!best) {
      /* even at the floor it overflows */
      sheet.style.setProperty('--t-scale', MIN_SCALE.toFixed(4));
      return {
        ok: false,
        scale: MIN_SCALE,
        fill: measure(sheet),
        reason: 'overflow-at-floor'
      };
    }

    sheet.style.setProperty('--t-scale', best.scale.toFixed(4));
    var atCeiling = best.scale >= MAX_SCALE - 0.003;
    return {
      ok: true,
      scale: best.scale,
      fill: best.fill,
      reason: atCeiling ? 'underfull-at-ceiling' : 'fitted'
    };
  }

  function autofitAll() { return sheets().map(autofit); }

  /* ======================================================================
     Audit — what a fill ratio cannot say
     ----------------------------------------------------------------------
     `fill` answers exactly one question: does the content reach the bottom
     edge and no further. Everything else that makes a sheet wrong — ink
     outside the margin, a hole in the middle, a heading sitting closer to
     the next entry than to its own bullets, a colour the theme never
     defined — used to be left to a person looking at a picture of the page.
     A 96 dpi render of an A4 cannot resolve a 2mm gap or two steps of grey,
     so these are measured in the layout engine instead, where they are
     exact.

     Each finding is {level, code, where, detail}. `fail` is unambiguous and
     fails the check; `warn` is a judgement call, reported to be overruled.
     Every threshold carries slack on purpose: a check that cries wolf is
     worse than no check, because things get "fixed" that were never broken.
     ====================================================================== */

  var HOLE_FACTOR = 2.5;   /* a gap this many × the median reads as a hole  */
  var HOLE_MIN    = 0.05;  /* …and must also be this much of sheet height   */
  var COLS_RATIO  = 0.40;  /* shortest column vs tallest, before it shows   */
  var COLS_MIN    = 0.10;  /* …and the difference must matter on the page   */
  var TOL_MM      = 0.3;   /* below this, nothing is visible on paper       */

  /* Ink, not boxes. A block's margin and padding are not what a reader
     sees; the first and last glyph are. Every gap below is measured between
     text rectangles, so padding, margins and collapsing all stop mattering
     and `.entries--ruled` compares the same way as a plain `.entries`. */
  function inkBox(el) {
    var top = Infinity, bottom = -Infinity;
    var walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node, range, r;
    while ((node = walk.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      range = document.createRange();
      range.selectNodeContents(node);
      r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    if (top === Infinity) {
      r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0 ? null : { top: r.top, bottom: r.bottom };
    }
    return { top: top, bottom: bottom };
  }

  function shown(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function kids(el, sel) {
    return Array.prototype.filter.call(el.children, function (c) {
      return shown(c) && (!sel || c.matches(sel));
    });
  }

  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* A locator a person can find in the source without a line number. */
  var HEADINGS = 'h1,h2,h3,h4,h5,h6,.band-label';

  function label(el) {
    if (!el) return '?';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : el.tagName.toLowerCase();
    /* A block's own textContent runs its children together without spaces,
       which reads as gibberish. Its heading names it the way a person would. */
    var named = el.matches(HEADINGS) ? el : el.querySelector(HEADINGS);
    var txt = ((named || el).textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) return cls;
    return cls + ' "' + txt.slice(0, 32) + (txt.length > 32 ? '…' : '') + '"';
  }

  /* The colours the theme actually defines, resolved through a probe so a
     hex token and an rgb() computed value compare as the same thing. */
  function themeInk(sheet) {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden';
    sheet.appendChild(probe);
    var set = {};
    ['--ink', '--ink-2', '--ink-3', '--accent', '--accent-2',
     '--rule', '--rule-firm', '--paper', '--bg'].forEach(function (name) {
      probe.style.color = '';
      probe.style.color = 'var(' + name + ')';
      set[getComputedStyle(probe).color] = true;
    });
    sheet.removeChild(probe);
    return set;
  }

  function auditSheet(sheet, index) {
    var found = [];
    var flow = flowOf(sheet);
    var cs = getComputedStyle(sheet);
    var box = sheet.getBoundingClientRect();
    var wmm = parseFloat(cs.getPropertyValue('--sheet-w')) || 210;
    var pxmm = box.width > 0 ? box.width / wmm : 1;
    var mm = function (px) { return px / pxmm; };
    var tol = TOL_MM * pxmm;

    function add(level, code, where, detail) {
      found.push({
        level: level, code: code, sheet: index + 1,
        where: where, detail: detail
      });
    }
    function say(px) { return mm(px).toFixed(1) + 'mm'; }

    /* ---- 1. ink outside the margin (fail) ------------------------------
       A long URL, an unbreakable token, an oversized image. On paper this
       is either clipped by the printer or runs into the edge. */
    var padL = box.left + parseFloat(cs.paddingLeft);
    var padR = box.right - parseFloat(cs.paddingRight);
    var out = [];
    Array.prototype.forEach.call(flow.querySelectorAll('*'), function (el) {
      if (!shown(el)) return;
      var r = el.getBoundingClientRect();
      var over = Math.max(r.right - padR, padL - r.left);
      if (over > tol) out.push({ el: el, over: over });
    });
    /* A box can sit inside the margin while its text does not: an unbreakable
       URL in a fixed-width flex item overflows the box, and the box rect
       still measures clean. scrollWidth is what sees that one. */
    Array.prototype.forEach.call(flow.querySelectorAll('*'), function (el) {
      if (!shown(el) || !el.clientWidth) return;
      var spill = el.scrollWidth - el.clientWidth;
      if (spill > tol) out.push({ el: el, over: spill });
    });

    /* only the innermost offender — a parent reports the same overflow */
    out.filter(function (o) {
      return !out.some(function (p) { return p !== o && o.el.contains(p.el); });
    }).slice(0, 3).forEach(function (o) {
      add('fail', 'escape', label(o.el),
          'runs ' + say(o.over) + ' outside the sheet margin');
    });

    /* ---- 2. blocks overlapping, and holes in the middle ----------------
       Both come out of the same walk: the vertical gap between the ink of
       consecutive top-level blocks. Negative is an overlap; far above the
       median is a hole that a person would have spotted in the picture. */
    var tops = kids(flow);
    var gaps = [], pair = [], sectionGaps = [];
    for (var i = 0; i < tops.length - 1; i++) {
      /* Collision is a question about boxes. Ink is not the test for it:
         display type is routinely set tighter than its own line box — the
         framework does it in .mast h1 — so glyph rectangles of neighbouring
         lines legitimately overlap while nothing on the page collides. Only
         border boxes running into each other is a real defect. */
      var ra = tops[i].getBoundingClientRect();
      var rb = tops[i + 1].getBoundingClientRect();
      if (rb.top < ra.bottom - tol) {
        add('fail', 'overlap', label(tops[i]),
            'overlaps ' + label(tops[i + 1]) + ' by ' + say(ra.bottom - rb.top));
        continue;
      }
      /* Spacing, though, is a question about ink: what a reader sees is the
         white between the last glyph and the next, not between margin edges. */
      var a = inkBox(tops[i]), b = inkBox(tops[i + 1]);
      if (!a || !b) continue;
      var g = b.top - a.bottom;
      gaps.push(g); pair.push([tops[i], tops[i + 1]]);
      if (tops[i].tagName === 'SECTION' && tops[i + 1].tagName === 'SECTION') {
        sectionGaps.push(g);
      }
    }
    if (gaps.length > 2) {
      var med = median(gaps);
      var worst = gaps.indexOf(Math.max.apply(null, gaps));
      var big = gaps[worst];
      if (med > 0 && big > med * HOLE_FACTOR && big > box.height * HOLE_MIN) {
        add('warn', 'hole', label(pair[worst][0]),
            'gap of ' + say(big) + ' before ' + label(pair[worst][1]) +
            ', against ' + say(med) + ' elsewhere — mark it .spring or close it');
      }
    }

    /* ---- 3. the rhythm ladder (warn) -----------------------------------
       The doctrine the whole framework rests on: a heading must sit closer
       to its own body than to the next entry, and an entry gap must stay
       smaller than a section gap. Both are pure proportion, invisible in a
       render, and this is the only thing that ever checked them. */
    var entryGaps = [];
    Array.prototype.forEach.call(flow.querySelectorAll('.entries'), function (list) {
      var items = kids(list, '.entry');
      var outer = [];
      for (var j = 0; j < items.length - 1; j++) {
        var p = inkBox(items[j]), q = inkBox(items[j + 1]);
        if (p && q) outer.push(q.top - p.bottom);
      }
      entryGaps = entryGaps.concat(outer);
      if (!outer.length) return;
      var typical = median(outer);
      var backwards = [];
      items.forEach(function (entry) {
        var parts = kids(entry);
        if (parts.length < 2) return;
        var head = inkBox(parts[0]), body = inkBox(parts[1]);
        if (!head || !body) return;
        var inner = body.top - head.bottom;
        if (inner + tol >= typical) backwards.push({ el: parts[0], gap: inner });
      });
      if (backwards.length) {
        add('warn', 'ladder', label(backwards[0].el),
            'sits ' + say(backwards[0].gap) + ' from its own body but ' +
            say(typical) + ' from the next entry — the grouping reads backwards' +
            (backwards.length > 1
              ? '; ' + backwards.length + ' of ' + items.length + ' entries do this'
              : ''));
      }
    });
    /* Only a gap between two <section> elements is a section gap. The space
       under the masthead and above the footline is neither, and averaging
       them in made this fire on any sheet whose sections sit side by side
       in a .cols instead of stacking. */
    if (entryGaps.length && sectionGaps.length) {
      var sectionGap = median(sectionGaps), entryGap = median(entryGaps);
      if (entryGap + tol >= sectionGap) {
        add('warn', 'ladder-flat', 'sheet ' + (index + 1),
            'entries are ' + say(entryGap) + ' apart and sections ' +
            say(sectionGap) + ' — the ladder has flattened; use --rhythm');
      }
    }

    /* ---- 4. a heading with nothing under it (warn) ---------------------- */
    var tail = tops[tops.length - 1];
    while (tail && kids(tail).length) tail = kids(tail)[kids(tail).length - 1];
    if (tail && tail.matches('h1,h2,h3,h4,h5,h6,.band-label')) {
      add('warn', 'orphan', label(tail),
          'is the last thing on the sheet — a heading with nothing under it');
    }

    /* ---- 5. lopsided columns (warn) ------------------------------------- */
    Array.prototype.forEach.call(flow.querySelectorAll('.cols'), function (grid) {
      var cells = kids(grid);
      if (cells.length < 2) return;
      var byCol = {};
      cells.forEach(function (c) {
        var key = Math.round(c.getBoundingClientRect().left);
        var ink = inkBox(c);
        if (!ink) return;
        if (!byCol[key]) byCol[key] = { top: ink.top, bottom: ink.bottom };
        else {
          byCol[key].top = Math.min(byCol[key].top, ink.top);
          byCol[key].bottom = Math.max(byCol[key].bottom, ink.bottom);
        }
      });
      var heights = Object.keys(byCol).map(function (k) {
        return byCol[k].bottom - byCol[k].top;
      });
      if (heights.length < 2) return;
      var tall = Math.max.apply(null, heights), short = Math.min.apply(null, heights);
      if (tall > 0 && (tall - short) / tall > COLS_RATIO &&
          (tall - short) > box.height * COLS_MIN) {
        add('warn', 'cols', label(grid),
            'columns differ by ' + say(tall - short) + ' — one ends well above the other');
      }
    });

    /* ---- 6. doctrine, as far as it is countable ------------------------- */
    var inks = themeInk(sheet), strays = {};
    Array.prototype.forEach.call(flow.querySelectorAll('*'), function (el) {
      if (!shown(el)) return;
      var own = Array.prototype.some.call(el.childNodes, function (n) {
        return n.nodeType === 3 && n.nodeValue.trim();
      });
      if (!own) return;
      var c = getComputedStyle(el).color;
      if (!inks[c]) strays[c] = strays[c] || label(el);
    });
    Object.keys(strays).slice(0, 3).forEach(function (c) {
      add('warn', 'ink', strays[c],
          'is set in ' + c + ', which is not one of the theme tokens');
    });

    var callouts = flow.querySelectorAll('.callout').length;
    if (callouts > 1) {
      add('warn', 'callout', 'sheet ' + (index + 1),
          callouts + ' callouts — the block only outranks everything else while there is one');
    }

    var boxed = [];
    Array.prototype.forEach.call(flow.querySelectorAll('*'), function (el) {
      if (!shown(el)) return;
      if (el.closest('.callout')) return;   /* the one sanctioned box */
      if (el.matches('kbd')) return;
      var s = getComputedStyle(el);
      /* A rule on one side is the framework's own idiom — the mast
         underline, the band-label hairline, the rows of .entries--ruled.
         What the doctrine calls noise is an enclosure, so only something
         bordered on three sides or more counts as a box. */
      var sides = ['Top', 'Right', 'Bottom', 'Left'].filter(function (side) {
        return s['border' + side + 'Style'] !== 'none' &&
               parseFloat(s['border' + side + 'Width']) > 0;
      }).length;
      var framed = sides >= 3;
      var tinted = s.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                   s.backgroundColor !== 'transparent' &&
                   !inks[s.backgroundColor];
      if (framed || tinted) boxed.push(label(el));
    });
    boxed.slice(0, 2).forEach(function (w) {
      add('warn', 'box', w,
          'carries its own border or tint — hierarchy on a dense sheet comes from size and colour');
    });

    var text = flow.textContent || '';
    ['|', '•'].forEach(function (ch) {
      if (text.indexOf(ch) !== -1) {
        add('warn', 'separator', 'sheet ' + (index + 1),
            'uses "' + ch + '" as well as the sheet separator ·');
      }
    });

    var scale = parseFloat(cs.getPropertyValue('--t-scale'));
    if (scale && scale < MIN_SCALE - 0.001) {
      add('fail', 'scale-floor', 'sheet ' + (index + 1),
          '--t-scale is ' + scale.toFixed(3) + ', below the ' + MIN_SCALE +
          ' floor — secondary ink stops surviving a mono laser printer');
    }

    return found;
  }

  /* Springs are collapsed for the same reason measure() collapses them: a
     spring is deliberate slack, and with it live every gap check would be
     reading the stretch instead of the design. */
  function auditAll() {
    var all = sheets(), found = [];
    all.forEach(function (s) { s.classList.add('is-measuring'); });
    try {
      all.forEach(function (s, i) { found = found.concat(auditSheet(s, i)); });
    } catch (e) {
      found.push({ level: 'warn', code: 'audit-failed', sheet: 0,
                   where: 'fit.js', detail: String(e && e.message || e) });
    }
    all.forEach(function (s) { s.classList.remove('is-measuring'); });
    found.sort(function (a, b) {
      return (a.level === b.level) ? 0 : (a.level === 'fail' ? -1 : 1);
    });
    return found.slice(0, 12);
  }

  /* ---- reporting --------------------------------------------------------
     A sheet carrying .spring--grow has said in its own markup where the
     slack belongs — a certificate, a title page, a poster with air around
     the headline. Calling that a hole at the bottom reports the design back
     at its author, and no amount of added content would ever clear it,
     because the spring simply absorbs it again. A plain .spring and the
     .footline do not count: every sheet has a foot, and pushing one block
     to the bottom is not a claim that the whole page is meant to breathe. */
  function claimsSlack(sheet) {
    return !!(sheet && sheet.querySelector('.spring--grow'));
  }

  function underfull(fill, sheet) {
    return fill < UNDERFULL && !claimsSlack(sheet);
  }

  function verdictOf(fills) {
    var all = sheets();
    if (!fills.length) return 'empty';
    if (fills.some(function (f) { return f > 1.001; })) return 'over';
    if (underfull(fills[fills.length - 1], all[fills.length - 1])) return 'under';
    return 'ok';
  }

  /* The numbers have to reach a headless caller, and the cheapest channel out
     of Chrome is the PDF: `--print-to-pdf` copies document.title into the file's
     metadata, so one launch produces both the page and its measurements. Under
     `--dump-dom` the data-* attributes above carry the same values; the title is
     only stamped when the URL asks for it, so a sheet opened in a real browser
     keeps its own title in the tab. */
  function stampTitle(fills, verdict, found) {
    if (!/[?&]a4fit\b/.test(location.search)) return;
    document.title = 'A4FIT sheets=' + fills.length +
      ' fill=' + fills.map(function (f) { return f.toFixed(3); }).join(',') +
      ' fit=' + verdict +
      ' audit=' + pack(found) + ' A4END';
  }

  /* The findings carry element text, which on most sheets is not ASCII, and
     a non-ASCII title makes Chrome write the PDF string as UTF-16 hex —
     readable, but only after a second decoder. Percent-encoding keeps the
     title a plain literal string, so the reader stays one regex and one
     unquote. The parentheses that encodeURIComponent leaves alone are the
     PDF string delimiters, so they go too. */
  function pack(found) {
    return encodeURIComponent(JSON.stringify(found || []))
      .replace(/[()']/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
      });
  }

  function report() {
    var fills = measureAll();
    var verdict = verdictOf(fills);
    var found = auditAll();
    var root = document.documentElement;
    root.setAttribute('data-fill', fills.map(function (f) { return f.toFixed(3); }).join(','));
    root.setAttribute('data-sheets', String(fills.length));
    root.setAttribute('data-fit', verdict);
    root.setAttribute('data-audit', String(found.length));
    stampTitle(fills, verdict, found);
    render(fills, verdict, found);
    return {
      fills: fills, sheets: fills.length, verdict: verdict, findings: found
    };
  }

  /* ---- sheets ----------------------------------------------------------- */
  function addSheet() {
    var tpl = document.getElementById('sheet-template');
    var node;
    if (tpl && tpl.content) {
      node = tpl.content.firstElementChild.cloneNode(true);
    } else {
      node = document.createElement('article');
      node.className = 'sheet';
      node.innerHTML = '<div class="flow"></div>';
    }
    var all = sheets();
    var last = all[all.length - 1];
    if (last) last.parentNode.insertBefore(node, last.nextSibling);
    else document.body.appendChild(node);
    report();
    return node;
  }

  function removeSheet() {
    var all = sheets();
    if (all.length < 2) return { ok: false, reason: 'last-sheet' };
    var last = all[all.length - 1];
    /* never destroy content silently, and never open a confirm() dialog */
    if (flowOf(last).textContent.trim().length > 0) {
      return { ok: false, reason: 'not-empty' };
    }
    last.parentNode.removeChild(last);
    report();
    return { ok: true };
  }

  /* ======================================================================
     The panel
     ====================================================================== */
  var PANEL_CSS = [
    '.fitbar{width:min(calc(var(--sheet-w) * 1mm),100%);display:flex;flex-wrap:wrap;',
    'align-items:center;gap:10px 14px;font:12px/1.4 var(--sans);color:var(--ink-2);',
    'padding:8px 12px;border:1px solid var(--rule);border-radius:6px;background:var(--paper)}',
    '.fitbar__group{display:flex;align-items:center;gap:6px}',
    '.fitbar__group>label{white-space:nowrap}',
    '.fitbar input[type=range]{width:96px;accent-color:var(--accent)}',
    '.fitbar output{font-variant-numeric:tabular-nums;min-width:2.6em}',
    '.fitbar button{font:inherit;font-weight:600;color:var(--ink);background:transparent;',
    'border:1px solid var(--rule-firm);border-radius:4px;padding:4px 9px;cursor:pointer}',
    '.fitbar button:hover{border-color:var(--accent);color:var(--accent)}',
    '.fitbar__chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.chip{font-variant-numeric:tabular-nums;border-radius:3px;padding:2px 7px;',
    'border:1px solid transparent;white-space:nowrap}',
    '.chip--ok{color:#2E6B4E;border-color:#B7D3C3;background:#EDF3EE}',
    '.chip--under{color:#9E6708;border-color:#E4CE9C;background:#F9F1E1}',
    '.chip--over{color:#A33A24;border-color:#E3B0A3;background:#F8ECE8}',
    '.fitbar__msg{flex-basis:100%;margin:0;color:var(--ink-3)}',
    '.fitbar__found{flex-basis:100%;margin:0;padding:0;list-style:none;',
    'display:flex;flex-direction:column;gap:3px}',
    '.fitbar__found li{display:flex;gap:7px;align-items:baseline}',
    '.fitbar__found code{font:inherit;font-weight:600;flex:none;min-width:5.5em}',
    '.fitbar__found li[data-level=fail] code{color:#A33A24}',
    '.fitbar__found li[data-level=warn] code{color:#9E6708}',
    '.fitbar__found b{font-weight:600;color:var(--ink)}',
    '.fitbar__msg[data-tone=warn]{color:#9E6708}',
    '.fitbar__msg[data-tone=bad]{color:#A33A24}',
    '@media print{.fitbar{display:none!important}}'
  ].join('');

  var panel, chips, foundList, msg, scaleIn, scaleOut, rhythmIn, rhythmOut;

  function buildPanel() {
    var style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.className = 'fitbar';
    panel.innerHTML =
      '<div class="fitbar__chips"></div>' +
      '<div class="fitbar__group"><label for="a4-scale">type</label>' +
      '<input id="a4-scale" type="range" min="0.9" max="1.3" step="0.005" value="1">' +
      '<output for="a4-scale">1.00</output></div>' +
      '<div class="fitbar__group"><label for="a4-rhythm">density</label>' +
      '<input id="a4-rhythm" type="range" min="0.82" max="1.15" step="0.005" value="1">' +
      '<output for="a4-rhythm">1.00</output></div>' +
      '<div class="fitbar__group">' +
      '<button type="button" data-act="fit">Autofit</button>' +
      '<button type="button" data-act="add">+ sheet</button>' +
      '<button type="button" data-act="remove">- sheet</button>' +
      '<button type="button" data-act="reset">Reset</button></div>' +
      '<p class="fitbar__msg"></p>' +
      '<ul class="fitbar__found"></ul>';

    var bar = document.querySelector('.bar');
    if (bar && bar.parentNode) bar.parentNode.insertBefore(panel, bar.nextSibling);
    else document.body.insertBefore(panel, document.body.firstChild);

    chips     = panel.querySelector('.fitbar__chips');
    foundList = panel.querySelector('.fitbar__found');
    msg       = panel.querySelector('.fitbar__msg');
    scaleIn   = panel.querySelector('#a4-scale');
    scaleOut  = panel.querySelector('output[for=a4-scale]');
    rhythmIn  = panel.querySelector('#a4-rhythm');
    rhythmOut = panel.querySelector('output[for=a4-rhythm]');

    scaleIn.addEventListener('input', function () {
      applyAll('--t-scale', scaleIn.value);
      scaleOut.textContent = Number(scaleIn.value).toFixed(2);
      report();
    });
    rhythmIn.addEventListener('input', function () {
      applyAll('--rhythm', rhythmIn.value);
      rhythmOut.textContent = Number(rhythmIn.value).toFixed(2);
      report();
    });
    panel.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'fit') {
        var res = autofitAll();
        var s = res.length ? res[0].scale : 1;
        scaleIn.value = s.toFixed(3);
        scaleOut.textContent = s.toFixed(2);
        report();
        explain(res);
      } else if (act === 'add') {
        addSheet();
        say('Sheet added. Move some content onto it yourself — there is no auto-flow, deliberately.', 'info');
      } else if (act === 'remove') {
        var r = removeSheet();
        if (!r.ok && r.reason === 'not-empty') {
          say('The last sheet is not empty — clear its content first.', 'warn');
        } else if (!r.ok) {
          say('Only one sheet left.', 'info');
        }
      } else if (act === 'reset') {
        applyAll('--t-scale', '');
        applyAll('--rhythm', '');
        scaleIn.value = rhythmIn.value = 1;
        scaleOut.textContent = rhythmOut.textContent = '1.00';
        report();
        say('', 'info');
      }
    });
  }

  function applyAll(prop, value) {
    sheets().forEach(function (s) {
      if (value === '') s.style.removeProperty(prop);
      else s.style.setProperty(prop, value);
    });
  }

  function say(text, tone) {
    if (!msg) return;
    msg.textContent = text;
    msg.setAttribute('data-tone', tone || 'info');
  }

  function explain(results) {
    var floored = results.some(function (r) { return r.reason === 'overflow-at-floor'; });
    var ceiled  = results.some(function (r) { return r.reason === 'underfull-at-ceiling'; });
    if (floored) {
      say('Does not fit even at the smallest type size. Shrinking further would not ' +
          'survive a black-and-white printer — cut text, or add a sheet.', 'bad');
    } else if (ceiled) {
      say('Too little content even at the largest type size — the sheet will stay ' +
          'half empty. Add material, or move to a smaller format.', 'warn');
    } else {
      say('Fitted.', 'info');
    }
  }

  /* The same findings the headless check reports, for whoever is at the
     screen — otherwise the panel and the terminal would disagree about
     whether the sheet is finished. */
  function renderFindings(found) {
    if (!foundList) return;
    foundList.innerHTML = '';
    found.forEach(function (f) {
      var li = document.createElement('li');
      li.setAttribute('data-level', f.level);
      var code = document.createElement('code');
      code.textContent = f.code;
      var text = document.createElement('span');
      var where = document.createElement('b');
      where.textContent = f.where;
      text.appendChild(where);
      text.appendChild(document.createTextNode(' — ' + f.detail));
      li.appendChild(code);
      li.appendChild(text);
      foundList.appendChild(li);
    });
  }

  function render(fills, verdict, found) {
    if (!chips) return;
    renderFindings(found || []);
    chips.innerHTML = '';
    var all = sheets();
    fills.forEach(function (f, i) {
      var cls = f > 1.001 ? 'over' : (underfull(f, all[i]) ? 'under' : 'ok');
      var el = document.createElement('span');
      el.className = 'chip chip--' + cls;
      el.textContent = (fills.length > 1 ? (i + 1) + ': ' : '') + Math.round(f * 100) + '%';
      el.title = cls === 'over' ? 'overflowing' : cls === 'under' ? 'empty at the bottom' : 'fills the sheet';
      chips.appendChild(el);
    });
    if (verdict === 'over' && msg && !msg.textContent) {
      say('Content does not fit on the sheet.', 'bad');
    }
  }

  /* ---- boot ------------------------------------------------------------- */
  function boot() {
    if (!document.querySelector('.sheet')) return;
    buildPanel();
    report();
  }

  var api = {
    measure: measure, measureAll: measureAll,
    autofit: autofit, autofitAll: autofitAll,
    audit: auditSheet, auditAll: auditAll,
    report: report, addSheet: addSheet, removeSheet: removeSheet,
    MIN_SCALE: MIN_SCALE, MAX_SCALE: MAX_SCALE
  };
  window.A4 = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  /* re-measure once webfonts and layout have settled — the first pass can
     read a fallback font and be off by a line */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (document.querySelector('.sheet')) report(); });
  }
  window.addEventListener('resize', function () {
    if (document.querySelector('.sheet')) report();
  });
})();
