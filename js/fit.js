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
   so `chrome --headless --dump-dom` is enough to read it back. No driver,
   no dependency.

   Public API — window.A4:
     measure(sheet)        → fill ratio, 1.0 == exactly full
     measureAll()          → array of ratios
     autofit(sheet)        → {ok, scale, fill, reason}
     autofitAll()          → array of results
     report()              → {fills, sheets, verdict}, also stamps <html>
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

  /* ---- reporting -------------------------------------------------------- */
  function verdictOf(fills) {
    if (!fills.length) return 'empty';
    if (fills.some(function (f) { return f > 1.001; })) return 'over';
    if (fills[fills.length - 1] < UNDERFULL) return 'under';
    return 'ok';
  }

  function report() {
    var fills = measureAll();
    var verdict = verdictOf(fills);
    var root = document.documentElement;
    root.setAttribute('data-fill', fills.map(function (f) { return f.toFixed(3); }).join(','));
    root.setAttribute('data-sheets', String(fills.length));
    root.setAttribute('data-fit', verdict);
    render(fills, verdict);
    return { fills: fills, sheets: fills.length, verdict: verdict };
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
    '.fitbar__msg[data-tone=warn]{color:#9E6708}',
    '.fitbar__msg[data-tone=bad]{color:#A33A24}',
    '@media print{.fitbar{display:none!important}}'
  ].join('');

  var panel, chips, msg, scaleIn, scaleOut, rhythmIn, rhythmOut;

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
      '<p class="fitbar__msg"></p>';

    var bar = document.querySelector('.bar');
    if (bar && bar.parentNode) bar.parentNode.insertBefore(panel, bar.nextSibling);
    else document.body.insertBefore(panel, document.body.firstChild);

    chips     = panel.querySelector('.fitbar__chips');
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

  function render(fills, verdict) {
    if (!chips) return;
    chips.innerHTML = '';
    fills.forEach(function (f, i) {
      var cls = f > 1.001 ? 'over' : (f < UNDERFULL ? 'under' : 'ok');
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
