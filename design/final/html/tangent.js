/* ============================================================
   Tangent — interactive prototype layer (v1.1)
   Ported from the interactive Folio screens (old Stitch project
   13331848356550971551): save reactions, programmable stack
   builder, live tallies, compile handoff, screen navigation.
   Vanilla JS, no dependencies. Include before </body>:
   <script src="tangent.js"></script>
   ============================================================ */
(function () {
  'use strict';

  var ACCENT = '#7FA8C9';
  var PAGE = (location.pathname.split('/').pop() || '01-feed.html').toLowerCase();
  var NAV_MAP = { feed: '01-feed.html', stacks: '02-stacks.html', tuning: '03-tuning.html' };

  /* ---------------- shared UI: toast + styles ---------------- */
  var css = document.createElement('style');
  css.textContent =
    '.tg-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:9999;' +
    'background:#1B1F28;border:1px solid #7FA8C9;border-radius:4px;padding:10px 16px;' +
    "font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.08em;" +
    'text-transform:uppercase;color:#F0F3F8;opacity:0;transition:opacity .18s ease,transform .18s ease;' +
    'pointer-events:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;}' +
    '.tg-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px);}' +
    '.tg-toast .tg-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#7FA8C9;' +
    'margin-right:8px;vertical-align:middle;}' +
    '.tg-pressing{opacity:.65!important;pointer-events:none!important;}' +
    '.tg-pulse{animation:tgPulse 1.6s ease-in-out infinite;}' +
    '@keyframes tgPulse{0%,100%{opacity:1}50%{opacity:.35}}';
  document.head.appendChild(css);

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('tg-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tg-toast';
      el.className = 'tg-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="tg-dot"></span>' + msg;
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function byText(selector, txt, root) {
    var els = (root || document).querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent.toUpperCase().indexOf(txt) !== -1) return els[i];
    }
    return null;
  }
  function byTextAll(selector, txt) {
    var out = [];
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent.toUpperCase().indexOf(txt) !== -1) out.push(els[i]);
    }
    return out;
  }
  function parseMin(text) {
    var m = /(\d+)\s*MIN/i.exec(text);
    return m ? parseInt(m[1], 10) : 0;
  }
  function staged(btn, busyText, done, delay) {
    var original = btn.innerHTML;
    btn.classList.add('tg-pressing');
    if (busyText) btn.innerHTML = busyText;
    setTimeout(function () {
      btn.classList.remove('tg-pressing');
      btn.innerHTML = original;
      done();
    }, delay || 700);
  }
  function navToSafe(url) { window.location.href = url; }

  /* ---------------- bottom nav (tabbed pages) ---------------- */
  function wireNav() {
    var items = document.querySelectorAll('nav a, nav button');
    for (var i = 0; i < items.length; i++) {
      (function (el) {
        var label = el.textContent.trim().toUpperCase();
        var target = null;
        if (label.indexOf('FEED') !== -1) target = NAV_MAP.feed;
        else if (label.indexOf('STACKS') !== -1) target = NAV_MAP.stacks;
        else if (label.indexOf('TUNING') !== -1) target = NAV_MAP.tuning;
        if (target && target !== PAGE) {
          if (el.tagName === 'A') el.setAttribute('href', target);
          else {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () { navToSafe(target); });
          }
        }
      })(items[i]);
    }
  }

  /* ---------------- save reaction (feed + reader) ---------------- */
  function wireSaveButton(btn, iconEl, savedMsg, removedMsg) {
    if (!btn) return;
    var saved = false;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', function () {
      saved = !saved;
      if (iconEl) {
        iconEl.style.fontVariationSettings = "'FILL' " + (saved ? 1 : 0);
        iconEl.style.color = saved ? ACCENT : '';
      }
      toast(saved ? savedMsg : removedMsg);
    });
  }
  /* ============================================================
     PAGE: 01-feed
     ============================================================ */
  function initFeed() {
    wireNav();
    var saveBtn = document.querySelector('button.h-12.w-12');
    if (saveBtn) wireSaveButton(saveBtn, saveBtn.querySelector('.material-symbols-outlined'),
      'SAVED TO QUICK QUEUE · +1', 'REMOVED FROM QUEUE');

    var readBtn = byText('button', 'READ ESSAY');
    if (readBtn) readBtn.addEventListener('click', function () {
      staged(readBtn, 'OPENING…', function () { navToSafe('04-reader.html'); }, 450);
    });

    var nextStrip = byText('div', 'NEXT:');
    if (nextStrip) {
      nextStrip.style.cursor = 'pointer';
      nextStrip.addEventListener('click', function () { navToSafe('04-reader.html'); });
    }
  }

  /* ============================================================
     PAGE: 02-stacks
     ============================================================ */
  function initStacks() {
    wireNav();

    function wireBegin(btn) {
      if (!btn || btn.dataset.tgWired) return;
      btn.dataset.tgWired = '1';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function () {
        staged(btn, 'LOADING QUEUE…', function () {
          toast('OPENING READER · ' + btn.textContent.replace('→', '').trim());
        }, 600);
      });
    }
    var beginBtns = byTextAll('button', 'BEGIN READING').concat(byTextAll('button', 'READ QUEUE'));
    for (var i = 0; i < beginBtns.length; i++) wireBegin(beginBtns[i]);

    var newStackBtn = byText('button', 'NEW STACK');
    if (newStackBtn) {
      newStackBtn.style.cursor = 'pointer';
      newStackBtn.addEventListener('click', function () { navToSafe('05-stack-builder.html'); });
    }
    var compose = byText('div', 'COMPOSE →') || byText('span', 'COMPOSE');
    var composeCard = compose && compose.closest('div[class*="border-dashed"]');
    if (composeCard) {
      composeCard.style.cursor = 'pointer';
      composeCard.addEventListener('click', function () { navToSafe('05-stack-builder.html'); });
    }

    /* compile handoff: builder → hub (ported from old createStack flow) */
    var raw = sessionStorage.getItem('tangentNewStack');
    if (raw) {
      sessionStorage.removeItem('tangentNewStack');
      try { prependCompiledCard(JSON.parse(raw)); } catch (e) { /* ignore */ }
    }

    function prependCompiledCard(d) {
      var tpl = beginBtns.length && beginBtns[0].closest('div.bg-surface-card');
      if (!tpl) return;
      var clone = tpl.cloneNode(true);
      clone.style.opacity = '1';
      var dot = clone.querySelector('.rounded-full');
      if (dot) { dot.style.background = ACCENT; dot.classList.add('tg-pulse'); }
      var h3 = clone.querySelector('h3');
      if (h3) h3.textContent = d.name;
      var spans = clone.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (/^\d+\s*MIN$/i.test(spans[i].textContent.trim())) spans[i].textContent = d.minutes + ' MIN';
        if (/^\d+\s*ESSAYS$/i.test(spans[i].textContent.trim())) spans[i].textContent = d.count + ' ESSAYS';
      }
      var btn = clone.querySelector('button');
      if (btn) {
        btn.innerHTML = 'BEGIN READING (' + d.minutes + 'M) →';
        wireBegin(btn);
      }
      tpl.parentElement.insertBefore(clone, tpl);
      toast('STACK COMPILED · ' + d.count + ' ESSAYS · ' + d.minutes + ' MIN');
    }
  }
  /* ============================================================
     PAGE: 03-tuning (segmented modes)
     ============================================================ */
  function initTuning() {
    wireNav();
    var tasteEl = byText('button', 'TASTE TUNING');
    var statsEl = byText('button', 'STATS & INSIGHTS');
    if (!tasteEl || !statsEl) return;
    var segSection = tasteEl.closest('section');

    var main = document.querySelector('main');
    var statsSections = [];
    for (var i = 0; i < main.children.length; i++) {
      if (main.children[i] !== segSection) statsSections.push(main.children[i]);
    }

    var panel = document.createElement('div');
    panel.style.display = 'none';
    panel.style.padding = '8px 0 120px';
    var rows = [
      ['AI & SYSTEMS', 70], ['MACROECONOMICS & FINANCE', 55], ['PHILOSOPHY & EPISTEMOLOGY', 40],
      ['ENERGY & DEEP TECH', 30], ['CULTURE & MEDIA', 20]
    ];
    var html = '<div class="bg-surface-card rounded-xl border border-border-subtle p-4">'
      + '<div class="flex justify-between items-center mb-4"><h3 class="font-title-sm text-[15px] text-[#F0F3F8]">Taste Tuning</h3>'
      + '<span class="font-label-mono text-[9px] uppercase text-[#7FA8C9]">ENGINE ACTIVE</span></div>';
    for (var r = 0; r < rows.length; r++) {
      html += '<div class="py-3' + (r < rows.length - 1 ? ' border-b border-border-subtle' : '') + '">'
        + '<div class="flex justify-between items-center mb-2">'
        + '<span class="font-label-mono text-[9px] uppercase text-on-surface-muted">' + rows[r][0] + '</span>'
        + '<span class="font-label-mono text-[9px] text-[#7FA8C9]" id="tg-w' + r + '">' + rows[r][1] + '</span></div>'
        + '<input type="range" min="0" max="100" value="' + rows[r][1] + '" data-w="' + r + '" '
        + 'style="width:100%;accent-color:' + ACCENT + ';height:4px;"></div>';
    }
    html += '<p class="font-body-md text-[12px] text-on-surface-muted mt-4">'
      + 'Slider weights feed the ranking engine. Higher weight = more essays from this category in your Feed.</p></div>';
    panel.innerHTML = html;
    main.insertBefore(panel, main.firstChild);
    panel.addEventListener('input', function (e) {
      if (e.target.type === 'range') {
        var lbl = document.getElementById('tg-w' + e.target.getAttribute('data-w'));
        if (lbl) lbl.textContent = e.target.value;
      }
    });

    function setMode(taste) {
      for (var i = 0; i < statsSections.length; i++) {
        if (statsSections[i] !== panel) statsSections[i].style.display = taste ? 'none' : '';
      }
      panel.style.display = taste ? '' : 'none';
      tasteEl.style.background = taste ? '#0C0E12' : 'transparent';
      tasteEl.style.color = taste ? '#F0F3F8' : '#9BA7BA';
      statsEl.style.background = taste ? 'transparent' : '#0C0E12';
      statsEl.style.color = taste ? '#9BA7BA' : '#F0F3F8';
    }
    tasteEl.style.cursor = 'pointer';
    statsEl.style.cursor = 'pointer';
    tasteEl.addEventListener('click', function () { setMode(true); });
    statsEl.addEventListener('click', function () { setMode(false); });
  }

  /* ============================================================
     PAGE: 04-reader
     ============================================================ */
  function initReader() {
    var saveBtn = byText('button', 'SAVE TO STACK');
    if (saveBtn) {
      var saved = false;
      saveBtn.style.cursor = 'pointer';
      saveBtn.addEventListener('click', function () {
        saved = !saved;
        saveBtn.style.background = saved ? ACCENT : '';
        saveBtn.style.borderColor = saved ? ACCENT : '';
        saveBtn.innerHTML = saved ? 'SAVED TO STACK ✓' : 'SAVE TO STACK';
        toast(saved ? 'SAVED TO SUNDAY LONGFORM' : 'REMOVED FROM STACK');
      });
    }
    var headerSave = document.querySelector('header button');
    if (headerSave && headerSave.querySelector('.material-symbols-outlined')) {
      wireSaveButton(headerSave, headerSave.querySelector('.material-symbols-outlined'),
        'SAVED FOR LATER', 'REMOVED FROM SAVED');
    }
    var bar = document.querySelector('div[class*="fixed top-"] div.h-full');
    if (bar) {
      var update = function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        var pct = max > 0 ? Math.min(100, (h.scrollTop || document.body.scrollTop) / max * 100) : 0;
        bar.style.width = pct + '%';
      };
      window.addEventListener('scroll', update, { passive: true });
      update();
    }
  }
  /* ============================================================
     PAGE: 05-stack-builder (the full programmable flow)
     ============================================================ */
  function initBuilder() {
    var selected = []; /* {title, minutes} */

    var cancelBtn = byText('button', 'CANCEL') || byText('span', 'CANCEL');
    if (cancelBtn) {
      var c = cancelBtn.tagName === 'BUTTON' ? cancelBtn : (cancelBtn.closest('button') || cancelBtn);
      c.style.cursor = 'pointer';
      c.addEventListener('click', function () { navToSafe('02-stacks.html'); });
    }

    /* collect candidate essay rows: every container of a 20px checkbox */
    var boxes = document.querySelectorAll('div[class*="w-\\[20px\\]"]');
    var rows = [];
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var row = box.closest('div[class*="cursor-pointer"]') || box.parentElement;
      if (!row || rows.indexOf(row) !== -1) continue;
      var titleEl = row.querySelector('span.font-medium, span.text-silver, span[class*="truncate"]');
      var title = titleEl ? titleEl.textContent.trim() : row.textContent.trim().slice(0, 40);
      var isSel = /accent/i.test(box.className) || !!box.querySelector('.material-symbols-outlined');
      var item = { title: title, minutes: parseMin(row.textContent) };
      rows.push(row);
      row.setAttribute('data-tg-title', title);
      if (isSel) selected.push(item);
      row.style.cursor = 'pointer';
      (function (it) {
        row.addEventListener('click', function () {
          var idx = findSel(it.title);
          if (idx === -1) { selected.push(it); } else { selected.splice(idx, 1); }
          markDirty();
          render();
        });
      })(item);
    }
    function findSel(title) {
      for (var i = 0; i < selected.length; i++) if (selected[i].title === title) return i;
      return -1;
    }

    var selectAll = byText('span', 'SELECT ALL') || byText('button', 'SELECT ALL');
    if (selectAll) {
      var sa = selectAll.closest('button') || selectAll;
      sa.style.cursor = 'pointer';
      sa.addEventListener('click', function () {
        for (var i = 0; i < rows.length; i++) {
          var t = rows[i].getAttribute('data-tg-title');
          if (findSel(t) === -1) selected.push({ title: t, minutes: parseMin(rows[i].textContent) });
        }
        markDirty();
        render();
        toast('ALL CANDIDATES ADDED');
      });
    }

    /* live tally targets */
    var trayLabel = byText('span', 'ESSAYS SELECTED');
    var readyLabel = byText('span', 'READY TO COMPILE');
    var createBtn = byText('button', 'CREATE STACK');
    var pip = null;
    var pipCandidates = document.querySelectorAll('span');
    for (var p = 0; p < pipCandidates.length; p++) {
      if (/^\d+\s*ESSAYS?\s*·\s*\d+\s*MIN$/i.test(pipCandidates[p].textContent.trim())) pip = pipCandidates[p];
    }
    var draftLabel = byText('span', 'DRAFT SAVED');
    var dragRow = null;
    var icons = document.querySelectorAll('span.material-symbols-outlined');
    for (var d = 0; d < icons.length; d++) {
      if (icons[d].textContent.trim() === 'drag_indicator') { dragRow = icons[d]; break; }
    }
    var listCard = dragRow && dragRow.closest('div.bg-surface-card');

    var dirtyTimer = null;
    function markDirty() {
      if (!draftLabel) return;
      draftLabel.textContent = '● UNSAVED CHANGES';
      draftLabel.style.color = '#9BA7BA';
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(function () {
        draftLabel.textContent = '✓ DRAFT SAVED';
        draftLabel.style.color = ACCENT;
      }, 1200);
    }
    function render() {
      var n = selected.length;
      var total = 0;
      for (var i = 0; i < n; i++) total += selected[i].minutes;

      /* checkbox visuals */
      for (var r = 0; r < rows.length; r++) {
        var box = rows[r].querySelector('div[class*="w-\\[20px\\]"]');
        if (!box) continue;
        var on = findSel(rows[r].getAttribute('data-tg-title')) !== -1;
        box.style.background = on ? ACCENT : 'transparent';
        box.style.border = '1px solid ' + (on ? ACCENT : '#4B535D');
        box.innerHTML = on
          ? '<span class="material-symbols-outlined" style="font-size:14px;color:#0B0E13;">check</span>'
          : '';
      }

      /* selected list */
      if (listCard) {
        var inner = '';
        for (var s = 0; s < n; s++) {
          inner += '<div class="p-3 flex items-center gap-3' + (s < n - 1 ? ' hairline-b' : '') + '">'
            + '<span class="material-symbols-outlined text-on-surface-faint text-[16px] cursor-grab">drag_indicator</span>'
            + '<span class="font-label-mono text-[10px] text-accent-steel w-[12px]">' + (s + 1) + '</span>'
            + '<div class="flex flex-col flex-1 overflow-hidden"><span class="text-silver text-[13px] truncate">'
            + selected[s].title + '</span></div>'
            + '<span class="font-label-mono text-[9px] text-on-surface-muted">' + selected[s].minutes + ' MIN</span>'
            + '<button class="material-symbols-outlined text-on-surface-faint hover:text-error text-[16px]" '
            + 'data-tg-title="' + selected[s].title.replace(/"/g, '&quot;') + '">close</button></div>';
        }
        listCard.innerHTML = inner
          || '<div class="p-4 font-label-mono text-[9px] uppercase text-on-surface-faint">NO ESSAYS SELECTED — PICK FROM THE SOURCES ABOVE</div>';
      }

      /* tallies */
      var label = n + ' ESSAY' + (n === 1 ? '' : 'S') + ' · ' + total + ' MIN';
      if (pip) pip.textContent = label;
      if (trayLabel) trayLabel.textContent = label + ' SELECTED';
      if (readyLabel) {
        readyLabel.textContent = n > 0 ? 'READY TO COMPILE' : 'ADD ESSAYS TO COMPILE';
        readyLabel.style.color = n > 0 ? ACCENT : '#475263';
      }
      if (createBtn) {
        createBtn.innerHTML = 'CREATE STACK (' + n + ' ESSAY' + (n === 1 ? '' : 'S') + ' · ' + total
          + ' MIN) <span class="material-symbols-outlined text-[16px]">arrow_forward</span>';
        createBtn.style.opacity = n > 0 ? '1' : '0.4';
      }
    }

    /* remove from selected list (event delegation) */
    if (listCard) {
      listCard.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button[data-tg-title]') : null;
        if (!btn) return;
        var idx = findSel(btn.getAttribute('data-tg-title'));
        if (idx !== -1) selected.splice(idx, 1);
        markDirty();
        render();
      });
    }

    /* compile → handoff to hub (ported from old createStack flow) */
    if (createBtn) {
      createBtn.style.cursor = 'pointer';
      createBtn.addEventListener('click', function () {
        if (selected.length === 0) { toast('SELECT AT LEAST ONE ESSAY'); return; }
        var total = 0;
        for (var i = 0; i < selected.length; i++) total += selected[i].minutes;
        var nameEl = byText('span', 'Sunday Longform') || byText('div', 'Sunday Longform');
        var name = nameEl ? nameEl.textContent.trim() : 'New Editorial Stack';
        staged(createBtn, 'COMPILING…', function () {
          sessionStorage.setItem('tangentNewStack',
            JSON.stringify({ name: name, minutes: total, count: selected.length }));
          navToSafe('02-stacks.html');
        }, 900);
      });
    }

    render();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    switch (PAGE) {
      case '01-feed.html': initFeed(); break;
      case '02-stacks.html': initStacks(); break;
      case '03-tuning.html': initTuning(); break;
      case '04-reader.html': initReader(); break;
      case '05-stack-builder.html': initBuilder(); break;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

