(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'roomLayoutPlanner.v1';
  var EPS = 0.05;
  var COLOR_NAMES = ['Blue', 'Teal', 'Green', 'Amber', 'Orange', 'Rose', 'Violet', 'Slate'];

  var PRESETS = [
    ['Sleeping', [['Twin bed', 38, 75, 1], ['Twin XL bed', 38, 80, 1], ['Full bed', 54, 75, 1], ['Queen bed', 60, 80, 1], ['King bed', 76, 80, 1], ['Nightstand', 18, 16, 1], ['Dresser', 60, 18, 1], ['Wardrobe', 36, 24, 1]]],
    ['Seating', [['Sofa', 84, 36, 2], ['Loveseat', 60, 36, 2], ['Armchair', 34, 36, 2], ['Desk chair', 22, 22, 2], ['Ottoman', 24, 24, 2]]],
    ['Tables and desks', [['Desk', 60, 30, 3], ['Standing desk', 48, 24, 3], ['Dining table', 48, 30, 3], ['Coffee table', 48, 24, 3], ['Side table', 18, 18, 3], ['Console table', 48, 14, 3]]],
    ['Storage and media', [['TV stand', 55, 16, 4], ['Bookshelf', 31, 12, 4], ['Cube shelf', 58, 15, 4], ['Shoe rack', 30, 12, 4]]],
    ['Rugs (no collisions)', [['Rug 5 x 8 ft', 60, 96, 8, 'flat', 'Rug 150 × 240 cm'], ['Rug 8 x 10 ft', 96, 120, 8, 'flat', 'Rug 240 × 305 cm']]],
    ['Room features', [['Door', 32, 4, 5, 'door'], ['Window', 48, 4, 6, 'window'], ['Fixed obstacle', 24, 24, 8, 'lock']]]
  ];
  var PFLAT = [];
  PRESETS.forEach(function (g) { g[1].forEach(function (p) { PFLAT.push(p); }); });
  // Preset label and item name follow the current display unit.
  function presetName(p) { return isMetric() && p[5] ? p[5] : p[0]; }
  function presetLabel(p) {
    var name = presetName(p);
    if (p[4] === 'door' || p[4] === 'window') return name + ' (' + fmtLen(p[1], true) + ' wide)';
    return name + ' (' + fmtDims(p[1], p[2]) + ')';
  }

  var S = { room: { w: 168, d: 204 }, items: [], sel: null, snap: 3, bare: 'in', units: 'ftin', walk: false, path: 30, example: true, layouts: [], li: 0 };
  var uid = 1, hist = [], fut = [], lastSnap = '', delArm = -1, delArmTimer = 0;
  var A = { status: {}, partner: {}, issues: 0 };
  var SC = 1, PX = 1;
  var svg = $('plan');
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- units ----------
     Everything is stored in inches. The display unit only affects how numbers
     are shown and how a bare number (no suffix) is read. */
  var IN_CM = 2.54;      // centimetres per inch
  var CM_IN = 1 / IN_CM; // inches per centimetre
  var UNITS = {
    ftin: { label: 'Feet & inches', bare: 'in' },
    in: { label: 'Inches', bare: 'in' },
    cm: { label: 'Centimetres', bare: 'cm' },
    m: { label: 'Metres', bare: 'm' }
  };
  var BARE_LABELS = { in: 'inches', ft: 'feet', cm: 'centimetres', m: 'metres' };
  function isMetric() { return S.units === 'cm' || S.units === 'm'; }
  // Snap increments in inches, per measurement system.
  var SNAP_SETS = {
    in: [[0, 'Off'], [1, '1 inch'], [3, '3 inches'], [6, '6 inches']],
    cm: [[0, 'Off'], [1 * CM_IN, '1 cm'], [5 * CM_IN, '5 cm'], [10 * CM_IN, '10 cm']],
    m: [[0, 'Off'], [10 * CM_IN, '10 cm'], [50 * CM_IN, '50 cm'], [100 * CM_IN, '1 m']]
  };
  function snapSet() { return SNAP_SETS[isMetric() ? (S.units === 'm' ? 'm' : 'cm') : 'in']; }
  function nearestSnap(v) {
    var set = snapSet(), best = set[0][0], d = Infinity;
    set.forEach(function (o) {
      var dd = Math.abs(o[0] - (isFinite(v) ? v : 0));
      if (dd < d) { d = dd; best = o[0]; }
    });
    return best;
  }
  // Grid lines: 1 ft / 12 in in imperial, 50 cm in metric.
  function gridSteps() {
    return isMetric()
      ? { minor: 50 * CM_IN, per: 2 }
      : { minor: 12, per: 5 };
  }

  /* ---------- length parsing and formatting ---------- */
  function parseLen(str, bare) {
    var s = String(str).trim().toLowerCase();
    if (!s) return NaN;
    var neg = false;
    if (s.charAt(0) === '-' || s.indexOf('\u2212') === 0) { neg = true; s = s.slice(1).trim(); }
    var v = parseLenPositive(s, bare);
    return (v >= 0 && neg) ? -v : v;
  }
  function parseLenPositive(s, bare) {
    if (!s) return NaN;
    s = s.replace(/''/g, '"').replace(/[\u2032\u2019\u2018]/g, "'").replace(/[\u2033\u201D\u201C]/g, '"');
    var n = '(\\d+(?:\\.\\d+)?)';
    var m = s.match(new RegExp('^' + n + '\\s*(?:\'|ft|feet|foot)\\s*(?:' + n + '\\s*(?:"|in|inch|inches)?)?$'));
    if (m) return parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0);
    m = s.match(new RegExp('^' + n + '\\s*(?:"|in|inch|inches)$'));
    if (m) return parseFloat(m[1]);
    m = s.match(new RegExp('^' + n + '\\s*cm$'));
    if (m) return parseFloat(m[1]) / 2.54;
    m = s.match(new RegExp('^' + n + '\\s*m$'));
    if (m) return parseFloat(m[1]) * 100 / 2.54;
    m = s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]) * 12 + parseFloat(m[2]);
    m = s.match(new RegExp('^' + n + '$'));
    if (m) {
      var v = parseFloat(m[1]);
      if (bare === 'ft') return v * 12;
      if (bare === 'cm') return v / IN_CM;
      if (bare === 'm') return v * 100 / IN_CM;
      return v;
    }
    return NaN;
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function trim(n) { return String(r1(n)); }
  // Lengths are shown in the current display unit. `short` drops a zero inch
  // part so plan labels stay compact ("5′" instead of "5′ 0″").
  // Keyboard nudge distance, in inches, per measurement system.
  function nudgeSteps() {
    return isMetric() ? { step: 1 * CM_IN, big: 5 * CM_IN } : { step: 1, big: 6 };
  }
  // A single number in the current unit, without the unit suffix.
  function fmtNum(n) {
    if (S.units === 'cm') {
      var cm = n * IN_CM;
      return String(Math.abs(cm) < 10 ? Math.round(cm * 10) / 10 : Math.round(cm));
    }
    if (S.units === 'm') return (n * 0.0254).toFixed(2);
    return trim(r1(n));
  }
  function fmtLen(n, short) {
    if (S.units === 'cm') return fmtNum(n) + ' cm';
    if (S.units === 'm') return fmtNum(n) + ' m';
    n = r1(n);
    if (S.units === 'in') return trim(n) + '″';
    var neg = n < 0 ? '-' : '';
    var a = Math.abs(n);
    // Short labels stay in inches for small pieces so plan text stays compact.
    if (a < 12 || (short && a < 24)) return neg + trim(a) + '″';
    var ft = Math.floor(a / 12 + 1e-9);
    var inch = r1(a - ft * 12);
    if (inch >= 12) { ft += 1; inch = 0; }
    if (short && inch === 0) return neg + ft + '′';
    return neg + ft + '′ ' + trim(inch) + '″';
  }
  // A width × depth pair, with the unit written once.
  function fmtDims(w, d) {
    if (S.units === 'cm' || S.units === 'm') return fmtNum(w) + ' × ' + fmtNum(d) + (S.units === 'cm' ? ' cm' : ' m');
    return fmtLen(w, true) + ' × ' + fmtLen(d, true);
  }
  function fmtArea(sqIn) {
    if (isMetric()) {
      var m2 = sqIn * 0.00064516;
      return (m2 < 10 ? m2.toFixed(2) : m2.toFixed(1)) + ' m²';
    }
    return Math.round(sqIn / 144) + ' sq ft';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function normRoom(r) {
    var w = (r && r.windows) || {};
    return { w: r.w, d: r.d, windows: { top: !!w.top, right: !!w.right, bottom: !!w.bottom, left: !!w.left } };
  }

  /* ---------- geometry ---------- */
  function xf(it, lx, ly) {
    var a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
  }
  function corners(it) {
    var h = it.w / 2, k = it.d / 2;
    return [[-h, -k], [h, -k], [h, k], [-h, k]].map(function (p) { return xf(it, p[0], p[1]); });
  }
  function swingPoly(it) {
    var w = it.w, f = it.flip ? -1 : 1;
    var pts = [[-w / 2 * f, 0]];
    for (var i = 0; i <= 10; i++) {
      var a = i / 10 * Math.PI / 2;
      pts.push([(-w / 2 + w * Math.cos(a)) * f, w * Math.sin(a)]);
    }
    return pts.map(function (p) { return xf(it, p[0], p[1]); });
  }
  function bbox(poly) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    poly.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function overlap(P, Q) {
    var polys = [P, Q];
    for (var k = 0; k < 2; k++) {
      var poly = polys[k];
      for (var i = 0; i < poly.length; i++) {
        var p = poly[i], q = poly[(i + 1) % poly.length];
        var nx = q[1] - p[1], ny = p[0] - q[0];
        var L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        var aMin = 1e12, aMax = -1e12, bMin = 1e12, bMax = -1e12, d, j;
        for (j = 0; j < P.length; j++) { d = P[j][0] * nx + P[j][1] * ny; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
        for (j = 0; j < Q.length; j++) { d = Q[j][0] * nx + Q[j][1] * ny; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
        if (aMax <= bMin + EPS || bMax <= aMin + EPS) return false;
      }
    }
    return true;
  }
  function isSolid(it) { return it.kind === 'item' && !it.flat; }
  function unionBounds() {
    var b = { x0: 0, y0: 0, x1: S.room.w, y1: S.room.d };
    S.items.forEach(function (it) {
      if (it.kind !== 'area') return;
      var a = bbox(corners(it));
      b.x0 = Math.min(b.x0, a.x0); b.y0 = Math.min(b.y0, a.y0);
      b.x1 = Math.max(b.x1, a.x1); b.y1 = Math.max(b.y1, a.y1);
    });
    return b;
  }
  // Doors and windows snap to room walls and to the edges of sketched areas.
  function wallLines() {
    var W = S.room.w, D = S.room.d;
    var L = [
      { horiz: true, at: 0, from: 0, to: W, rot: 0, room: true },
      { horiz: true, at: D, from: 0, to: W, rot: 180, room: true },
      { horiz: false, at: 0, from: 0, to: D, rot: 270, room: true },
      { horiz: false, at: W, from: 0, to: D, rot: 90, room: true }
    ];
    S.items.forEach(function (a) {
      if (a.kind !== 'area') return;
      var b = bbox(corners(a));
      L.push({ horiz: true, at: b.y0, from: b.x0, to: b.x1, rot: 0 });
      L.push({ horiz: true, at: b.y1, from: b.x0, to: b.x1, rot: 180 });
      L.push({ horiz: false, at: b.x0, from: b.y0, to: b.y1, rot: 270 });
      L.push({ horiz: false, at: b.x1, from: b.y0, to: b.y1, rot: 90 });
    });
    return L;
  }

  function analyze() {
    var st = {}, partner = {};
    S.items.forEach(function (i) { st[i.id] = []; });
    var W = S.room.w, D = S.room.d;
    var areas = S.items.filter(function (i) { return i.kind === 'area'; }).map(function (a) { return bbox(corners(a)); });
    var solids = S.items.filter(isSolid).map(function (it) { return { it: it, poly: corners(it) }; });
    function add(id, tag) { if (st[id].indexOf(tag) < 0) st[id].push(tag); }
    function inArea(p) {
      for (var j = 0; j < areas.length; j++) {
        var b = areas[j];
        if (p[0] >= b.x0 - EPS && p[0] <= b.x1 + EPS && p[1] >= b.y0 - EPS && p[1] <= b.y1 + EPS) return true;
      }
      return false;
    }
    solids.forEach(function (o) {
      if (o.poly.some(function (p) { return (p[0] < -EPS || p[0] > W + EPS || p[1] < -EPS || p[1] > D + EPS) && !inArea(p); })) add(o.it.id, 'outside');
    });
    for (var i = 0; i < solids.length; i++) {
      for (var j = i + 1; j < solids.length; j++) {
        if (solids[i].it.ov || solids[j].it.ov) continue;
        if (overlap(solids[i].poly, solids[j].poly)) {
          add(solids[i].it.id, 'overlap'); add(solids[j].it.id, 'overlap');
          if (!partner[solids[i].it.id]) partner[solids[i].it.id] = solids[j].it.name;
          if (!partner[solids[j].it.id]) partner[solids[j].it.id] = solids[i].it.name;
        }
      }
    }
    S.items.filter(function (i) { return i.kind === 'door'; }).forEach(function (dr) {
      var z = swingPoly(dr);
      solids.forEach(function (o) {
        if (overlap(z, o.poly)) {
          add(o.it.id, 'door'); add(dr.id, 'door');
          if (!partner[dr.id]) partner[dr.id] = o.it.name;
        }
      });
    });
    var issues = 0;
    S.items.forEach(function (i) { if (i.kind === 'item' && st[i.id].length) issues++; });
    return { status: st, partner: partner, issues: issues };
  }
  function chipFor(it) {
    var s = A.status[it.id] || [];
    if (s.indexOf('overlap') >= 0) return { t: 'Overlaps ' + (A.partner[it.id] || 'item'), c: 'bad' };
    if (s.indexOf('outside') >= 0) return { t: 'Outside room', c: 'bad' };
    if (s.indexOf('door') >= 0) return { t: it.kind === 'door' ? 'Swing blocked' : 'Blocks door', c: 'warn' };
    return null;
  }

  /* ---------- state, history, storage ---------- */
  function snapshot() { return JSON.stringify({ room: S.room, items: S.items }); }
  // S.room and S.items stand for the current layout, but undo, delete, clear and
  // load replace them with new objects; write them back before the layouts are
  // saved or the current layout changes.
  function syncCur() {
    var L = S.layouts[S.li];
    if (L) { L.room = S.room; L.items = S.items; }
  }
  function persist() {
    syncCur();
    try {
      localStorage.setItem(STORE, JSON.stringify({ v: 3, li: S.li, layouts: S.layouts, snap: S.snap, bare: S.bare, units: S.units, walk: S.walk, path: S.path, example: S.example, hist: hist.slice(-30) }));
    } catch (e) { /* storage unavailable */ }
  }
  var persistTimer = 0;
  function persistSoon() {
    if (persistTimer) return;
    persistTimer = setTimeout(function () { persistTimer = 0; persist(); }, 400);
  }
  function saveOnExit() {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    persist();
  }
  function commit() {
    var snap = snapshot();
    if (snap !== lastSnap) {
      hist.push(lastSnap); if (hist.length > 100) hist.shift();
      fut = []; lastSnap = snap; S.example = false;
    }
    persist(); updateUndo();
  }
  function applySnap(snap) {
    var o = JSON.parse(snap);
    S.room = normRoom(o.room); S.items = o.items;
    if (!S.items.some(function (i) { return i.id === S.sel; })) S.sel = null;
    renderAll(true); persist(); updateUndo();
  }
  function undo() { if (!hist.length) return; fut.push(lastSnap); lastSnap = hist.pop(); applySnap(lastSnap); }
  function redo() { if (!fut.length) return; hist.push(lastSnap); lastSnap = fut.pop(); applySnap(lastSnap); }
  function updateUndo() { $('undo').disabled = !hist.length; $('redo').disabled = !fut.length; }

  function cleanItem(o) {
    var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
    var kind = o.kind === 'door' || o.kind === 'window' || o.kind === 'area' ? o.kind : 'item';
    var it = {
      id: uid++, name: String(o.name || 'Item').slice(0, 40), kind: kind,
      w: clamp(num(o.w, 30), 1, 600), d: clamp(num(o.d, 30), 1, 600),
      x: num(o.x, 0), y: num(o.y, 0), rot: ((num(o.rot, 0) % 360) + 360) % 360,
      color: clamp(Math.round(num(o.color, 1)), 1, 8), flat: !!o.flat && kind === 'item',
      ov: !!o.ov && kind === 'item',
      lock: !!o.lock, flip: !!o.flip
    };
    if (kind === 'area') { it.rot = 0; it.flat = false; }
    return it;
  }
  function exampleItems() {
    var L = [
      { name: 'Rug 5 x 8 ft', kind: 'item', w: 96, d: 60, x: 68, y: 146, rot: 270, color: 8, flat: true },
      { name: 'Queen bed', kind: 'item', w: 60, d: 80, x: 84, y: 40, rot: 0, color: 1 },
      { name: 'Nightstand', kind: 'item', w: 18, d: 16, x: 44, y: 8, rot: 0, color: 1 },
      { name: 'Nightstand', kind: 'item', w: 18, d: 16, x: 124, y: 8, rot: 0, color: 1 },
      { name: 'Desk', kind: 'item', w: 60, d: 30, x: 153, y: 40, rot: 90, color: 3 },
      { name: 'Desk chair', kind: 'item', w: 22, d: 22, x: 126, y: 40, rot: 90, color: 2 },
      { name: 'Sofa', kind: 'item', w: 84, d: 36, x: 18, y: 150, rot: 270, color: 2 },
      { name: 'Coffee table', kind: 'item', w: 48, d: 24, x: 62, y: 150, rot: 270, color: 3 },
      { name: 'TV stand', kind: 'item', w: 55, d: 16, x: 160, y: 150, rot: 90, color: 4 },
      { name: 'Dresser', kind: 'item', w: 60, d: 18, x: 70, y: 195, rot: 180, color: 1 },
      { name: 'Window', kind: 'window', w: 60, d: 4, x: 84, y: 0, rot: 0, color: 6 },
      { name: 'Door', kind: 'door', w: 32, d: 4, x: 120, y: 204, rot: 180, color: 5 }
    ];
    return L.map(cleanItem);
  }
  function useExample() {
    uid = 1;
    if (!S.layouts[S.li]) S.layouts[S.li] = { name: 'Layout 1', room: normRoom({ w: 168, d: 204 }), items: [] };
    S.layouts[S.li].room = normRoom({ w: 168, d: 204 });
    S.layouts[S.li].items = exampleItems();
    bindCur();
    S.sel = null; S.example = true;
  }
  function uniqueName(base) {
    var n = base, i = S.layouts.length + 1;
    if (!S.layouts.some(function (l) { return l.name === n; })) return n;
    for (;;) { n = base + ' ' + i; if (!S.layouts.some(function (l) { return l.name === n; })) return n; i++; }
  }
  function addLayout(fromCurrent) {
    syncCur();
    var name = uniqueName(fromCurrent ? S.layouts[S.li].name + ' copy' : 'Layout');
    // cleanItem re-stamps ids so copies don't collide with originals
    S.layouts.push({
      name: name,
      room: fromCurrent ? normRoom(S.room) : normRoom(S.room),
      items: fromCurrent ? S.items.map(function (o) { var c = JSON.parse(JSON.stringify(o)); return cleanItem(c); }) : []
    });
    S.li = S.layouts.length - 1;
    bindCur();
    S.sel = null;
    delArm = -1;
    commit(); persist(); renderAll(true);
    toast(fromCurrent ? 'Copied to ' + name : 'Created ' + name);
  }
  function switchLayout(i) {
    if (i === S.li || !S.layouts[i]) return;
    syncCur();
    S.li = i;
    bindCur();
    S.sel = null;
    hist = []; fut = []; lastSnap = snapshot();
    delArm = -1;
    persist(); renderAll(true); updateUndo();
    toast('Switched to ' + S.layouts[i].name);
  }
  function delLayout(i) {
    if (delArm !== i) {
      delArm = i;
      syncTabs();
      if (delArmTimer) clearTimeout(delArmTimer);
      delArmTimer = setTimeout(function () { delArm = -1; syncTabs(); }, 3500);
      return;
    }
    delArm = -1;
    if (delArmTimer) clearTimeout(delArmTimer);
    syncCur();
    S.layouts.splice(i, 1);
    if (i < S.li) S.li--;
    if (S.li >= S.layouts.length) S.li = S.layouts.length - 1;
    if (S.li < 0) S.li = 0;
    if (!S.layouts.length) S.layouts = [{ name: 'Layout 1', room: normRoom({ w: 360, d: 300 }), items: [] }];
    bindCur();
    S.sel = null;
    hist = []; fut = []; lastSnap = snapshot();
    persist(); renderAll(true); updateUndo();
    toast('Layout deleted');
  }
  function renameLayout(inp) {
    var v = inp.value.trim().slice(0, 30);
    if (v) S.layouts[S.li].name = v;
    persist();
    syncTabs();
  }
  function bindCur() {
    var L = S.layouts[S.li];
    if (!L) return;
    S.room = L.room;
    S.items = L.items;
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if ((o.v === 2 || o.v === 3) && Array.isArray(o.layouts)) {
        var ok = o.layouts.filter(function (l) {
          return l && l.room && (l.room.w > 0) && (l.room.d > 0) && Array.isArray(l.items);
        }).map(function (l) {
          return { name: String(l.name || 'Layout').slice(0, 30), room: normRoom(l.room), items: l.items.map(cleanItem) };
        });
        if (!ok.length) return false;
        S.layouts = ok;
        S.li = isFinite(o.li) ? clamp(Math.round(o.li), 0, ok.length - 1) : 0;
      } else {
        if (!o || !o.room || !(o.room.w > 0) || !(o.room.d > 0) || !Array.isArray(o.items)) return false;
        S.layouts = [{ name: 'Layout 1', room: normRoom(o.room), items: o.items.map(cleanItem) }];
        S.li = 0;
      }
      bindCur();
      S.sel = null;
      S.units = UNITS[o.units] ? o.units : 'ftin';
      S.bare = BARE_LABELS[o.bare] ? o.bare : UNITS[S.units].bare;
      S.snap = nearestSnap(o.snap);
      S.walk = !!o.walk;
      S.path = o.path >= 12 && o.path <= 72 ? o.path : 30;
      S.example = !!o.example;
      hist = Array.isArray(o.hist) ? o.hist.filter(function (x) { return typeof x === 'string'; }).slice(-30) : [];
      fut = [];
      return true;
    } catch (e) { return false; }
  }

  /* ---------- svg helpers ---------- */
  function se(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function stext(parent, x, y, str, cls, size, extra) {
    var t = se('text', { x: x, y: y, 'font-size': size, 'text-anchor': 'middle', class: cls }, parent);
    if (extra) for (var k in extra) t.setAttribute(k, extra[k]);
    t.textContent = str;
    return t;
  }
  function toRoom(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ---------- canvas ---------- */
  function renderCanvas(keep) {
    var W = S.room.w, D = S.room.d;
    var wrap = $('canvasWrap');
    var cw = Math.max(260, wrap.clientWidth || 600);
    var maxH = Math.max(340, window.innerHeight - 230);
    var m = 36;
    var ub = unionBounds();
    var minX = ub.x0, minY = ub.y0, maxX = ub.x1, maxY = ub.y1;
    if (drawTool) { minX -= 96; minY -= 96; maxX += 96; maxY += 96; }
    var s;
    if (keep && SC > 0) s = SC;
    else s = Math.max(0.15, Math.min((cw - 2 * m) / (maxX - minX), (maxH - 2 * m) / (maxY - minY)));
    SC = s; PX = 1 / s;
    var M = m / s;
    minX -= M; minY -= M; maxX += M; maxY += M;
    svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY));
    svg.style.width = (maxX - minX) * s + 'px';
    svg.style.height = (maxY - minY) * s + 'px';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var defs = se('defs', {}, svg);
    var cp = se('clipPath', { id: 'roomClip' }, defs);
    se('rect', { x: 0, y: 0, width: W, height: D }, cp);
    se('rect', { x: 0, y: 0, width: W, height: D, class: 'room' }, svg);

    var grid = se('g', { class: 'grid' }, svg), i, n;
    var gs = gridSteps();
    for (i = gs.minor, n = 1; i < W; i += gs.minor, n++) {
      se('line', { x1: i, y1: 0, x2: i, y2: D, class: n % gs.per === 0 ? 'strong' : '' }, grid);
    }
    for (i = gs.minor, n = 1; i < D; i += gs.minor, n++) {
      se('line', { x1: 0, y1: i, x2: W, y2: i, class: n % gs.per === 0 ? 'strong' : '' }, grid);
    }
    se('rect', { x: 0, y: 0, width: W, height: D, class: 'wall' }, svg);
    var rw = S.room.windows || {};
    var wg = se('g', {}, svg);
    [['top', 0, 0, W, 0], ['bottom', 0, D, W, D], ['left', 0, 0, 0, D], ['right', W, 0, W, D]].forEach(function (q) {
      if (rw[q[0]]) drawWallWindows(wg, q);
    });

    // overall dimensions — anchored outside the room plus any sketched areas
    var dg = se('g', { class: 'dim' }, svg);
    var ty = Math.min(0, ub.y0) - M * 0.5, tx = Math.min(0, ub.x0) - M * 0.5, tk = 5 * PX;
    se('line', { x1: 0, y1: ty, x2: W, y2: ty }, dg);
    se('line', { x1: 0, y1: ty - tk, x2: 0, y2: ty + tk }, dg);
    se('line', { x1: W, y1: ty - tk, x2: W, y2: ty + tk }, dg);
    stext(dg, W / 2, ty, fmtLen(W), 'dimtext', 12 * PX, { dy: '0.35em', 'stroke-width': 4 * PX });
    se('line', { x1: tx, y1: 0, x2: tx, y2: D }, dg);
    se('line', { x1: tx - tk, y1: 0, x2: tx + tk, y2: 0 }, dg);
    se('line', { x1: tx - tk, y1: D, x2: tx + tk, y2: D }, dg);
    stext(dg, 0, 0, fmtLen(D), 'dimtext', 12 * PX, { dy: '0.35em', 'stroke-width': 4 * PX, transform: 'translate(' + tx + ' ' + (D / 2) + ') rotate(-90)' });

    var flats = S.items.filter(function (i) { return i.kind === 'item' && i.flat; });
    var solids = S.items.filter(isSolid);
    var wins = S.items.filter(function (i) { return i.kind === 'window'; });
    var doors = S.items.filter(function (i) { return i.kind === 'door'; });
    var layer = se('g', {}, svg);
    S.items.filter(function (i) { return i.kind === 'area'; }).forEach(function (it) { drawItem(it, layer); });
    flats.forEach(function (it) { drawItem(it, layer); });
    if (S.walk) {
      var hg = se('g', { 'clip-path': 'url(#roomClip)' }, layer);
      solids.forEach(function (it) {
        var pts = corners(it).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
        se('polygon', { points: pts, class: 'halo', 'stroke-width': S.path }, hg);
      });
    }
    solids.forEach(function (it) { drawItem(it, layer); });
    wins.forEach(function (it) { drawItem(it, layer); });
    doors.forEach(function (it) { drawItem(it, layer); });

    // distances to walls for the selected furniture
    var sel = cur();
    if (sel && sel.kind === 'item') {
      var bb = bbox(corners(sel)), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      var gg = se('g', { class: 'gap' }, layer);
      var gaps = [
        { g: bb.x0, x1: 0, y1: cy, x2: bb.x0, y2: cy, tx: bb.x0 / 2, ty: cy },
        { g: W - bb.x1, x1: bb.x1, y1: cy, x2: W, y2: cy, tx: (bb.x1 + W) / 2, ty: cy },
        { g: bb.y0, x1: cx, y1: 0, x2: cx, y2: bb.y0, tx: cx, ty: bb.y0 / 2 },
        { g: D - bb.y1, x1: cx, y1: bb.y1, x2: cx, y2: D, tx: cx, ty: (bb.y1 + D) / 2 }
      ];
      gaps.forEach(function (q) {
        if (q.g < 0.4) return;
        se('line', { x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2 }, gg);
        if (q.g * SC >= 30) stext(gg, q.tx, q.ty, fmtLen(q.g, true), 'gaptext', 11 * PX, { dy: '0.35em', 'stroke-width': 3.5 * PX });
      });
    }
  }

  function drawWallWindows(parent, q) {
    var side = q[0], x1 = q[1], y1 = q[2], x2 = q[3], y2 = q[4], t = 5;
    var g = se('g', { style: '--ic: var(--c1)' }, parent);
    var horiz = y1 === y2;
    if (horiz) {
      se('rect', { x: x1, y: y1 - t / 2, width: x2 - x1, height: t, class: 'frame' }, g);
      se('line', { x1: x1, y1: y1 - t / 2, x2: x2, y2: y1 - t / 2, class: 'wallline' }, g);
      se('line', { x1: x1, y1: y1 + t / 2, x2: x2, y2: y1 + t / 2, class: 'wallline' }, g);
      se('line', { x1: x1, y1: y1, x2: x2, y2: y1, class: 'winline' }, g);
    } else {
      se('rect', { x: x1 - t / 2, y: y1, width: t, height: y2 - y1, class: 'frame' }, g);
      se('line', { x1: x1 - t / 2, y1: y1, x2: x1 - t / 2, y2: y2, class: 'wallline' }, g);
      se('line', { x1: x1 + t / 2, y1: y1, x2: x1 + t / 2, y2: y2, class: 'wallline' }, g);
      se('line', { x1: x1, y1: y1, x2: x1, y2: y2, class: 'winline' }, g);
    }
    var len = horiz ? x2 - x1 : y2 - y1;
    if (len * SC >= 90) {
      var off = 14 * PX, fs = 10 * PX, tx, ty, rot = 0;
      if (side === 'top') { tx = (x1 + x2) / 2; ty = off; }
      else if (side === 'bottom') { tx = (x1 + x2) / 2; ty = y1 - off; }
      else if (side === 'left') { tx = off; ty = (y1 + y2) / 2; rot = -90; }
      else { tx = x1 - off; ty = (y1 + y2) / 2; rot = 90; }
      stext(g, 0, 0, 'WINDOWS', 'winlabel', fs, { dy: '0.35em', transform: 'translate(' + tx + ' ' + ty + ') rotate(' + rot + ')' });
    }
  }

  function drawItem(it, parent) {
    var st = A.status[it.id] || [];
    var cls = ['item', it.kind, it.flat ? 'flat' : '', it.lock ? 'locked' : '',
      (st.indexOf('overlap') >= 0 || st.indexOf('outside') >= 0) ? 'bad' : '',
      st.indexOf('door') >= 0 ? 'warn' : ''].filter(Boolean).join(' ');
    var g = se('g', { class: cls, 'data-id': it.id, transform: 'translate(' + it.x + ' ' + it.y + ') rotate(' + it.rot + ')' }, parent);
    g.style.setProperty('--ic', 'var(--c' + it.color + ')');
    var w = it.w, d = it.d, pad = 2 * PX;

    if (it.kind === 'item' || it.kind === 'area') {
      se('rect', { x: -w / 2, y: -d / 2, width: w, height: d, class: 'body' }, g);
      if (it.kind === 'item' && !it.flat) se('line', { x1: -w * 0.18, y1: d / 2 - 1.5 * PX, x2: w * 0.18, y2: d / 2 - 1.5 * PX, class: 'tick' }, g);
      var bb = bbox(corners(it));
      var aw = (bb.x1 - bb.x0) * SC, ah = (bb.y1 - bb.y0) * SC;
      var showName = aw >= 34 && ah >= 16, showDims = aw >= 62 && ah >= 32;
      if (showName) {
        var maxCh = Math.max(3, Math.floor(aw / 6.8));
        var nm = it.name.length > maxCh ? it.name.slice(0, maxCh - 1) + '\u2026' : it.name;
        var fs = 12 * PX;
        var tg = se('g', { transform: 'rotate(' + (-it.rot) + ')' }, g);
        stext(tg, 0, showDims ? -0.1 * fs : 0.35 * fs, nm, '', fs);
        if (showDims) stext(tg, 0, 1.25 * fs, fmtDims(w, d), 'dims', 10 * PX);
      }
    } else if (it.kind === 'window') {
      se('rect', { x: -w / 2, y: -28, width: w, height: 56, class: 'hit' }, g);
      se('rect', { x: -w / 2, y: -d / 2 - 0.5, width: w, height: d + 1, class: 'frame' }, g);
      se('line', { x1: -w / 2, y1: -d / 2, x2: -w / 2, y2: d / 2, class: 'jamb' }, g);
      se('line', { x1: w / 2, y1: -d / 2, x2: w / 2, y2: d / 2, class: 'jamb' }, g);
      se('line', { x1: -w / 2, y1: 0, x2: w / 2, y2: 0, class: 'winline' }, g);
    } else {
      var inner = se('g', it.flip ? { transform: 'scale(-1 1)' } : {}, g);
      var path = 'M ' + (-w / 2) + ' 0 L ' + (w / 2) + ' 0 A ' + w + ' ' + w + ' 0 0 1 ' + (-w / 2) + ' ' + w + ' Z';
      se('path', { d: path, class: 'swing' }, inner);
      se('rect', { x: -w / 2, y: -d / 2 - 0.5, width: w, height: d + 1, class: 'frame' }, inner);
      se('line', { x1: -w / 2, y1: -d / 2, x2: -w / 2, y2: d / 2, class: 'jamb' }, inner);
      se('line', { x1: w / 2, y1: -d / 2, x2: w / 2, y2: d / 2, class: 'jamb' }, inner);
      se('line', { x1: -w / 2, y1: 0, x2: -w / 2, y2: w, class: 'leaf' }, inner);
    }
    if (S.sel === it.id) {
      if (it.kind === 'item' || it.kind === 'area') se('rect', { x: -w / 2 - pad, y: -d / 2 - pad, width: w + 2 * pad, height: d + 2 * pad, class: 'selbox' }, g);
      else if (it.kind === 'window') se('rect', { x: -w / 2 - pad, y: -d / 2 - pad - 3, width: w + 2 * pad, height: d + 2 * pad + 6, class: 'selbox' }, g);
      else {
        var sg = se('g', it.flip ? { transform: 'scale(-1 1)' } : {}, g);
        se('rect', { x: -w / 2 - pad, y: -d / 2 - pad, width: w + 2 * pad, height: w + d / 2 + 2 * pad, class: 'selbox' }, sg);
      }
    }
  }

  /* ---------- panels ---------- */
  function cur() {
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.sel) return S.items[i];
    return null;
  }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function renderList() {
    var list = $('list');
    while (list.firstChild) list.removeChild(list.firstChild);
    $('itemCount').textContent = S.items.length;
    if (!S.items.length) { list.appendChild(h('p', 'empty', 'No items yet. Choose a piece of furniture above and press Add.')); return; }
    S.items.forEach(function (it) {
      var row = h('div', 'li' + (S.sel === it.id ? ' on' : ''));
      row.setAttribute('data-id', it.id);
      row.style.setProperty('--ic', 'var(--c' + it.color + ')');
      var b = h('button', 'liMain');
      b.type = 'button';
      b.appendChild(h('span', 'dot'));
      var mid = h('span', '');
      mid.style.minWidth = '0';
      mid.appendChild(h('span', 'nm', it.name));
      mid.appendChild(h('span', 'sz', fmtDims(it.w, it.d) + (it.kind === 'item' ? '' : ' ' + it.kind)));
      mid.firstChild.style.display = 'block';
      b.appendChild(mid);
      var c = chipFor(it) || (it.lock ? { t: 'Locked', c: 'lock' } : null) || (it.ov ? { t: 'Overlap allowed', c: 'lock' } : null);
      b.appendChild(c ? h('span', 'chip ' + c.c, c.t) : h('span', ''));
      row.appendChild(b);
      var x = h('button', 'liDel', '×');
      x.type = 'button'; x.setAttribute('data-del', it.id); x.setAttribute('aria-label', 'Delete ' + it.name); x.title = 'Delete';
      row.appendChild(x);
      list.appendChild(row);
    });
  }
  function setVal(id, v, force) {
    var el = $(id);
    if (!force && document.activeElement === el) return;
    el.value = v; el.classList.remove('invalid');
  }
  function syncRoomFields(force) {
    setVal('roomW', fmtLen(S.room.w), force);
    setVal('roomD', fmtLen(S.room.d), force);
    setVal('pathW', fmtLen(S.path, true), force);
    $('bareUnit').value = S.bare;
    $('units').value = S.units;
    $('snap').value = String(S.snap);
    $('walk').checked = S.walk;
    var rwin = S.room.windows || {};
    $('winT').checked = !!rwin.top; $('winR').checked = !!rwin.right;
    $('winB').checked = !!rwin.bottom; $('winL').checked = !!rwin.left;
  }
  function syncEditor(force) {
    var it = cur();
    $('edEmpty').hidden = !!it; $('edForm').hidden = !it;
    if (!it) return;
    setVal('edName', it.name, force);
    setVal('edW', fmtLen(it.w, true), force);
    setVal('edD', fmtLen(it.d, true), force);
    setVal('edX', fmtLen(it.x, true), force);
    setVal('edY', fmtLen(it.y, true), force);
    setVal('edRot', String(Math.round(it.rot)), force);
    $('edFlat').checked = it.flat; $('edLock').checked = it.lock;
    $('edFlatWrap').hidden = it.kind !== 'item';
    $('edOv').checked = it.ov;
    $('edOvWrap').hidden = it.kind !== 'item' || it.flat;
    var sw = $('swatches').children;
    for (var i = 0; i < sw.length; i++) sw[i].setAttribute('aria-pressed', String(i + 1 === it.color));
  }
  function renderSel() {
    var it = cur();
    var info = $('selInfo');
    while (info.firstChild) info.removeChild(info.firstChild);
    var has = !!it;
    ['bRot', 'bDup', 'bDel'].forEach(function (id) { $(id).disabled = !has; });
    $('bRot').hidden = has && it.kind !== 'item';
    $('bFlip').hidden = !(has && it.kind === 'door');
    if (!it) { info.textContent = 'Nothing selected'; return; }
    info.appendChild(h('b', '', it.name));
    var rot = it.kind === 'item' ? '  at ' + Math.round(it.rot) + '\u00B0' : '';
    info.appendChild(h('span', 'mono', '  ' + fmtDims(it.w, it.d) + rot + (it.lock ? '  locked' : '')));
  }
  function renderStats() {
    var floor = S.room.w * S.room.d;
    var used = 0;
    S.items.forEach(function (i) { if (isSolid(i)) used += i.w * i.d; });
    var pct = floor > 0 ? Math.round(used / floor * 100) : 0;
    var st = $('stats');
    while (st.firstChild) st.removeChild(st.firstChild);
    st.appendChild(document.createTextNode('Floor '));
    st.appendChild(h('b', '', fmtArea(floor)));
    st.appendChild(document.createTextNode('  ·  Furniture '));
    st.appendChild(h('b', '', fmtArea(used) + ' (' + pct + '%)'));
    var is = $('issues');
    if (!S.items.some(isSolid)) { is.textContent = ''; is.className = 'issues'; }
    else if (A.issues === 0) { is.textContent = 'No conflicts'; is.className = 'issues ok'; }
    else { is.textContent = A.issues + (A.issues === 1 ? ' item needs attention' : ' items need attention'); is.className = 'issues bad'; }
    $('banner').hidden = !S.example;
    var be = $('bannerExample');
    if (be) be.textContent = 'Example layout in a ' + fmtLen(S.room.w, true) + ' × ' + fmtLen(S.room.d, true) + ' studio.';
    var gl = $('gridNote');
    if (gl) gl.textContent = isMetric() ? 'Grid lines are 50 cm apart.' : 'Grid lines are 1 ft apart.';
    var nn = $('nudgeNote');
    if (nn) {
      var ns = nudgeSteps();
      nn.textContent = 'Arrow keys nudge ' + fmtLen(ns.step, true) + ' (Shift for ' + fmtLen(ns.big, true) + ').';
    }
  }
  function syncTabs() {
    var bar = $('tabs');
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    S.layouts.forEach(function (l, i) {
      var t = h('div', 'tab' + (i === S.li ? ' on' : ''));
      var b = h('button', 'tbtn');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = l.name || 'Layout';
      b.setAttribute('data-switch', i);
      b.title = i === S.li ? 'Click to rename' : 'Switch to "' + b.textContent + '"';
      b.setAttribute('aria-selected', i === S.li ? 'true' : 'false');
      t.appendChild(b);
      if (S.layouts.length > 1) {
        var x = h('button', 'x' + (delArm === i ? ' armed' : ''), '×');
        x.type = 'button';
        x.setAttribute('data-del', i);
        x.setAttribute('aria-label', 'Delete layout "' + b.textContent + '"');
        x.title = 'Delete layout — click again to confirm';
        t.appendChild(x);
      }
      bar.appendChild(t);
    });
    var nb = h('div', 'tab newbtn');
    nb.style.cursor = 'pointer';
    var btn = h('button', 'tbtn', '+ New layout');
    btn.type = 'button';
    btn.title = 'Start an empty layout with the same room size';
    btn.setAttribute('data-new', '1');
    nb.appendChild(btn);
    bar.appendChild(nb);
    var cb = h('div', 'tab newbtn');
    cb.style.cursor = 'pointer';
    var cbtn = h('button', 'tbtn', 'Copy current');
    cbtn.type = 'button';
    cbtn.title = 'Duplicate the current layout, furniture included';
    cbtn.setAttribute('data-copy', '1');
    cb.appendChild(cbtn);
    bar.appendChild(cb);
  }

  function renderAll(force) {
    A = analyze();
    syncTabs();
    renderCanvas(); renderList(); syncEditor(!!force); renderSel(); renderStats(); syncRoomFields(!!force);
  }

  /* ---------- placing and dragging ---------- */
  function snapv(v) { return S.snap > 0 ? Math.round(v / S.snap) * S.snap : r1(v); }
  function placeItem(it, cx, cy) {
    var W = S.room.w, D = S.room.d;
    if (it.kind === 'area') { it.x = snapv(cx); it.y = snapv(cy); return; }
    if (it.kind !== 'item') {
      var best = null;
      wallLines().forEach(function (l) {
        var d = l.horiz ? Math.abs(cy - l.at) + Math.max(l.from - cx, cx - l.to, 0)
                        : Math.abs(cx - l.at) + Math.max(l.from - cy, cy - l.to, 0);
        if (l.room) d -= 0.01;
        if (!best || d < best.d) best = { l: l, d: d };
      });
      var l = best.l, half = it.w / 2, lo = l.from + half, hi = l.to - half;
      if (l.horiz) {
        it.rot = l.rot; it.y = l.at;
        it.x = hi >= lo ? clamp(snapv(cx), lo, hi) : (l.from + l.to) / 2;
      } else {
        it.rot = l.rot; it.x = l.at;
        it.y = hi >= lo ? clamp(snapv(cy), lo, hi) : (l.from + l.to) / 2;
      }
      return;
    }
    var ub = unionBounds();
    var x = snapv(clamp(cx, ub.x0, ub.x1)), y = snapv(clamp(cy, ub.y0, ub.y1));
    if (S.snap > 0) {
      var tmp = { w: it.w, d: it.d, rot: it.rot, x: x, y: y };
      var bb = bbox(corners(tmp));
      var hx = (bb.x1 - bb.x0) / 2, hy = (bb.y1 - bb.y0) / 2;
      var xs = [0, W], ys = [0, D];
      S.items.forEach(function (o) {
        if (o.id === it.id || (!isSolid(o) && o.kind !== 'area')) return;
        var b = bbox(corners(o));
        xs.push(b.x0, b.x1); ys.push(b.y0, b.y1);
      });
      var tol = Math.max(2, S.snap);
      var bestX = null, bestY = null;
      xs.forEach(function (c) {
        [c - (x - hx), c - (x + hx)].forEach(function (sh) {
          if (Math.abs(sh) <= tol && (bestX === null || Math.abs(sh) < Math.abs(bestX))) bestX = sh;
        });
      });
      ys.forEach(function (c) {
        [c - (y - hy), c - (y + hy)].forEach(function (sh) {
          if (Math.abs(sh) <= tol && (bestY === null || Math.abs(sh) < Math.abs(bestY))) bestY = sh;
        });
      });
      if (bestX !== null) x += bestX;
      if (bestY !== null) y += bestY;
    }
    it.x = r1(x); it.y = r1(y);
  }

  var drag = null;
  var drawTool = false, band = null;
  function disarmDraw() {
    drawTool = false; band = null;
    var b = $('drawArea');
    if (b) { b.classList.remove('armed'); b.textContent = 'Draw area'; }
    var old = document.getElementById('bandLayer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  $('drawArea').addEventListener('click', function () {
    if (drawTool) { disarmDraw(); renderAll(true); return; }
    drawTool = true;
    this.classList.add('armed');
    this.textContent = 'Cancel drawing';
    toast('Drag a rectangle on the plan, outside or inside the room. Esc cancels.');
    renderAll(true);
  });
  function updateBand() {
    var x0 = snapv(band.x0), y0 = snapv(band.y0), x1 = snapv(band.x1), y1 = snapv(band.y1);
    band.rect.setAttribute('x', Math.min(x0, x1));
    band.rect.setAttribute('y', Math.min(y0, y1));
    band.rect.setAttribute('width', Math.abs(x1 - x0));
    band.rect.setAttribute('height', Math.abs(y1 - y0));
  }
  function finishBand() {
    var b = band; band = null;
    var x0 = snapv(b.x0), y0 = snapv(b.y0), x1 = snapv(b.x1), y1 = snapv(b.y1);
    disarmDraw();
    var w = Math.abs(x1 - x0), d = Math.abs(y1 - y0);
    if (w < 6 || d < 6) { toast('Drag a bigger rectangle (at least 6\u2033).'); renderAll(true); return; }
    var it = cleanItem({ name: 'Area', kind: 'area', w: w, d: d, x: (x0 + x1) / 2, y: (y0 + y1) / 2, color: 8 });
    S.items.push(it); S.sel = it.id;
    commit(); renderAll(true);
  }
  svg.addEventListener('pointerdown', function (e) {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    if (drawTool) {
      var p0 = toRoom(e);
      var g = se('g', { id: 'bandLayer' }, svg);
      var r = se('rect', { class: 'bandrect', x: p0.x, y: p0.y, width: 0, height: 0 }, g);
      band = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y, rect: r };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
      return;
    }
    var node = e.target.closest ? e.target.closest('[data-id]') : null;
    if (!node) { if (S.sel !== null) { S.sel = null; renderAll(true); } return; }
    var id = parseInt(node.getAttribute('data-id'), 10);
    S.sel = id;
    var it = cur();
    var p = toRoom(e);
    drag = (it && !it.lock) ? { id: id, ox: p.x - it.x, oy: p.y - it.y, moved: false } : null;
    if (drag) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    // Redraw next frame: rebuilding the plan now would detach the touched element before
    // its touchstart fires, and the touchstart handler below needs it to claim the gesture.
    requestAnimationFrame(function () { renderAll(true); });
    e.preventDefault();
  });
  svg.addEventListener('pointermove', function (e) {
    if (band) { var p = toRoom(e); band.x1 = p.x; band.y1 = p.y; updateBand(); return; }
    if (!drag) return;
    var it = cur(); if (!it) return;
    p = toRoom(e);
    placeItem(it, p.x - drag.ox, p.y - drag.oy);
    drag.moved = true;
    persistSoon();
    A = analyze(); renderCanvas(true); renderList(); syncEditor(false); renderSel(); renderStats();
  });
  function endDrag() {
    if (band) { finishBand(); return; }
    if (!drag) return;
    var moved = drag.moved; drag = null;
    if (moved) { commit(); renderAll(true); }
  }
  // touch-action is ignored on SVG children, so a finger drag on an item would turn into a
  // page scroll and cancel the pointer stream. Claim the touch when it starts on a movable
  // item or while drawing; anywhere else on the plan still scrolls the page.
  svg.addEventListener('touchstart', function (e) {
    if (drawTool) { e.preventDefault(); return; }
    var node = e.target.closest ? e.target.closest('[data-id]') : null;
    if (!node) return;
    var id = parseInt(node.getAttribute('data-id'), 10);
    var it = S.items.filter(function (i) { return i.id === id; })[0];
    if (it && !it.lock) e.preventDefault();
  }, { passive: false });
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', function (e) {
    var node = e.target.closest ? e.target.closest('[data-id]') : null;
    if (!node) return;
    var it = cur();
    if (it && it.kind === 'item' && !it.lock) rotateSel();
  });

  /* ---------- actions ---------- */
  function addItem(spec) {
    var n = S.items.length;
    var it = {
      id: uid++, name: spec.name, w: spec.w, d: spec.d, kind: spec.kind || 'item', color: spec.color || 1,
      flat: !!spec.flat, lock: !!spec.lock, flip: false, rot: 0, x: 0, y: 0
    };
    if (it.kind !== 'item') { it.x = S.room.w / 2; it.y = 0; }
    else {
      it.x = clamp(r1(S.room.w / 2 + (n % 6) * 8 - 20), 0, S.room.w);
      it.y = clamp(r1(S.room.d / 2 + (n % 6) * 8 - 20), 0, S.room.d);
    }
    S.items.push(it); S.sel = it.id;
    commit(); renderAll(true);
  }
  function rotateSel() {
    var it = cur(); if (!it || it.kind !== 'item' || it.lock) return;
    it.rot = (it.rot + 90) % 360;
    commit(); renderAll(true);
  }
  function dupSel() {
    var it = cur(); if (!it) return;
    var c = JSON.parse(JSON.stringify(it));
    c.id = uid++;
    if (it.kind === 'item') { c.x = clamp(it.x + 12, 0, S.room.w); c.y = clamp(it.y + 12, 0, S.room.d); }
    else if (it.kind === 'area') { c.x = it.x + 12; c.y = it.y + 12; }
    else { c.x = clamp(it.x + 12, 0, S.room.w); }
    c.lock = false;
    S.items.push(c); S.sel = c.id;
    commit(); renderAll(true);
  }
  function delItem(id) {
    S.items = S.items.filter(function (i) { return i.id !== id; });
    if (S.sel === id) S.sel = null;
    commit(); renderAll(true);
  }
  function delSel() {
    var it = cur(); if (!it) return;
    delItem(it.id);
  }
  function nudge(dx, dy) {
    var it = cur(); if (!it || it.lock) return;
    var old = S.snap; S.snap = 0;
    placeItem(it, it.x + dx, it.y + dy);
    S.snap = old;
    commit(); renderAll(true);
  }

  var armedTimers = {};
  function twoStep(btnId, armedLabel, action) {
    var b = $(btnId), label = b.textContent;
    b.addEventListener('click', function () {
      if (b.classList.contains('armed')) {
        clearTimeout(armedTimers[btnId]);
        b.classList.remove('armed'); b.textContent = label;
        action();
      } else {
        b.classList.add('armed'); b.textContent = armedLabel;
        armedTimers[btnId] = clearTimeout(armedTimers[btnId]);
        armedTimers[btnId] = setTimeout(function () { b.classList.remove('armed'); b.textContent = label; }, 3500);
      }
    });
  }
  function toast(t) {
    var m = $('msg'); m.textContent = t;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { m.textContent = ''; }, 3500);
  }
  function showCrash(err) {
    if (window.console && console.error) console.error(err);
    var b = $('banner');
    if (b) {
      b.hidden = false;
      b.className = 'banner err';
      b.textContent = 'The planner hit an error: ' + ((err && err.message) || 'unknown') + '. Your saved layout is still in this browser — reload to try again.';
    }
  }
  window.addEventListener('error', function (e) { showCrash(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { showCrash(e.reason); });

  /* ---------- wiring ---------- */
  function buildPresetOptions() {
    var sel = $('preset'), idx = 0, keep = sel.value;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    PRESETS.forEach(function (g) {
      var og = document.createElement('optgroup'); og.label = g[0];
      g[1].forEach(function (p) {
        var o = document.createElement('option');
        o.value = String(idx++);
        o.textContent = presetLabel(p);
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (keep) sel.value = keep;
  }
  function buildSnapOptions() {
    var sel = $('snap'), keep = S.snap;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    snapSet().forEach(function (o) {
      var op = document.createElement('option');
      op.value = String(o[0]);
      op.textContent = o[1];
      sel.appendChild(op);
    });
    S.snap = nearestSnap(keep);
    sel.value = String(S.snap);
  }
  function setUnits(u) {
    if (!UNITS[u] || u === S.units) return;
    S.units = u;
    S.bare = UNITS[u].bare;
    buildSnapOptions();
    buildPresetOptions();
    persist();
    renderAll(true);
  }

  (function buildControls() {
    buildPresetOptions();
    buildSnapOptions();
    var sw = $('swatches');
    for (var i = 1; i <= 8; i++) {
      (function (n) {
        var b = h('button', 'sw');
        b.type = 'button'; b.title = COLOR_NAMES[n - 1]; b.setAttribute('aria-label', COLOR_NAMES[n - 1]);
        b.style.setProperty('--sw', 'var(--c' + n + ')');
        b.addEventListener('click', function () { var it = cur(); if (!it) return; it.color = n; commit(); renderAll(true); });
        sw.appendChild(b);
      })(i);
    }
  })();

  $('addPreset').addEventListener('click', function () {
    var p = PFLAT[parseInt($('preset').value, 10)];
    if (!p) return;
    addItem({ name: presetName(p), w: p[1], d: p[2], color: p[3], kind: p[4] === 'door' ? 'door' : p[4] === 'window' ? 'window' : 'item', flat: p[4] === 'flat', lock: p[4] === 'lock' });
  });
  $('addCustom').addEventListener('click', function () {
    var w = parseLen($('cW').value, S.bare), d = parseLen($('cD').value, S.bare);
    var msg = $('cMsg');
    if (!(w >= 1 && w <= 600) || !(d >= 1 && d <= 600)) {
      msg.textContent = 'Enter a width and depth, for example 36 and 24.'; msg.hidden = false; return;
    }
    msg.hidden = true;
    addItem({ name: ($('cName').value.trim() || 'Item').slice(0, 40), w: r1(w), d: r1(d), color: 7, flat: $('cFlat').checked });
    $('cName').value = ''; $('cW').value = ''; $('cD').value = ''; $('cFlat').checked = false;
  });
  ['cName', 'cW', 'cD'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') $('addCustom').click(); });
  });

  function roomField(id, key) {
    $(id).addEventListener('change', function () {
      var v = parseLen($(id).value, S.bare);
      var msg = $('roomMsg');
      if (!(v >= 36 && v <= 1200)) {
        $(id).classList.add('invalid');
        msg.textContent = 'Could not read that size. Try 14\' 6", 174 or 380 cm (between 3 ft and 100 ft).'; msg.className = 'note err';
        return;
      }
      msg.textContent = 'Type sizes like 14\' 6", 14ft 6in, 174, 12.5 ft or 380 cm.'; msg.className = 'note';
      S.room[key] = r1(v);
      commit(); renderAll(true);
    });
  }
  roomField('roomW', 'w'); roomField('roomD', 'd');
  $('pathW').addEventListener('change', function () {
    var v = parseLen($('pathW').value, S.bare);
    if (!(v >= 12 && v <= 72)) { $('pathW').classList.add('invalid'); return; }
    S.path = r1(v); persist(); renderAll(true);
  });
  $('walk').addEventListener('change', function () { S.walk = $('walk').checked; persist(); renderAll(false); });
  [['winT', 'top'], ['winR', 'right'], ['winB', 'bottom'], ['winL', 'left']].forEach(function (pr) {
    $(pr[0]).addEventListener('change', function () { S.room.windows[pr[1]] = $(pr[0]).checked; commit(); renderAll(true); });
  });
  $('bareUnit').addEventListener('change', function () { S.bare = $('bareUnit').value; persist(); });
  $('units').addEventListener('change', function () { setUnits($('units').value); });
  $('snap').addEventListener('change', function () { S.snap = parseFloat($('snap').value) || 0; persist(); });

  function lenField(id, key, min, max) {
    $(id).addEventListener('change', function () {
      var it = cur(); if (!it) return;
      var lo = (key === 'x' || key === 'y') ? -1200 : min;
      var v = parseLen($(id).value, S.bare);
      if (!(v >= lo && v <= max)) { $(id).classList.add('invalid'); return; }
      it[key] = r1(v); commit(); renderAll(true);
    });
  }
  lenField('edW', 'w', 1, 600); lenField('edD', 'd', 1, 600);
  lenField('edX', 'x', 0, 100000); lenField('edY', 'y', 0, 100000);
  $('edName').addEventListener('change', function () {
    var it = cur(); if (!it) return;
    it.name = $('edName').value.trim().slice(0, 40) || it.name;
    commit(); renderAll(true);
  });
  $('edRot').addEventListener('change', function () {
    var it = cur(); if (!it) return;
    var v = parseFloat($('edRot').value);
    if (!isFinite(v)) { $('edRot').classList.add('invalid'); return; }
    it.rot = ((v % 360) + 360) % 360; commit(); renderAll(true);
  });
  $('edFlat').addEventListener('change', function () { var it = cur(); if (!it) return; it.flat = $('edFlat').checked; commit(); renderAll(true); });
  $('edOv').addEventListener('change', function () { var it = cur(); if (!it) return; it.ov = $('edOv').checked; commit(); renderAll(true); });
  $('edLock').addEventListener('change', function () { var it = cur(); if (!it) return; it.lock = $('edLock').checked; commit(); renderAll(true); });

  $('tabs').addEventListener('click', function (e) {
    var n = e.target.closest ? e.target.closest('[data-new]') : null;
    if (n) { addLayout(false); return; }
    var c = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (c) { addLayout(true); return; }
    var d = e.target.closest ? e.target.closest('[data-del]') : null;
    if (d) { delLayout(parseInt(d.getAttribute('data-del'), 10)); return; }
    var s = e.target.closest ? e.target.closest('[data-switch]') : null;
    if (!s) return;
    var i = parseInt(s.getAttribute('data-switch'), 10);
    // Clicking the tab that's already open renames it, which also works on touch screens.
    if (i === S.li) renameTab(s);
    else switchLayout(i);
  });
  function renameTab(b) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = S.layouts[S.li].name;
    inp.maxLength = 30;
    inp.setAttribute('aria-label', 'Layout name');
    // Swap the button out rather than nesting the input in it: Firefox won't let you type inside a button.
    b.parentNode.replaceChild(inp, b);
    inp.focus();
    inp.select();
    var closed = false;
    function done(save) {
      if (closed) return;
      closed = true;
      if (save) renameLayout(inp);
      else syncTabs();
    }
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    });
    inp.addEventListener('blur', function () { done(true); });
  }

  $('list').addEventListener('click', function (e) {
    var del = e.target.closest ? e.target.closest('[data-del]') : null;
    if (del) { delItem(parseInt(del.getAttribute('data-del'), 10)); return; }
    var b = e.target.closest ? e.target.closest('[data-id]') : null;
    if (!b) return;
    S.sel = parseInt(b.getAttribute('data-id'), 10);
    renderAll(true);
  });
  $('bRot').addEventListener('click', rotateSel);
  $('bFlip').addEventListener('click', function () { var it = cur(); if (!it || it.kind !== 'door') return; it.flip = !it.flip; commit(); renderAll(true); });
  $('bDup').addEventListener('click', dupSel);
  $('bDel').addEventListener('click', delSel);
  $('edDel').addEventListener('click', delSel);
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);

  twoStep('clearAll', 'Click again to clear', function () { S.items = []; S.sel = null; commit(); renderAll(true); });
  twoStep('resetExample', 'Click again to replace', function () {
    useExample();
    commit(); S.example = true; persist(); renderAll(true); toast('Example loaded');
  });

  $('copyLayout').addEventListener('click', function () {
    var json = JSON.stringify({ room: S.room, items: S.items });
    var box = $('io'); box.value = json;
    function fallback() { box.focus(); box.select(); toast('Select the text and copy it with Ctrl+C or Cmd+C'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () { toast('Layout copied'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  });
  function copyShareLink() {
    var url = shareUrl();
    var box = $('io'); box.value = url;
    function fallback() { box.focus(); box.select(); toast('Select the link and copy it'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('Share link copied'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }
  $('copyLink').addEventListener('click', copyShareLink);
  $('copyLinkTop').addEventListener('click', copyShareLink);
  $('loadLayout').addEventListener('click', function () {
    var raw = ($('io').value || '').trim();
    var link = /(?:^|[#&])l=([A-Za-z0-9\-_]+)/.exec(raw);
    if (link && loadFromCode(link[1])) {
      commit(); persist(); renderAll(true); toast('Layout loaded from link');
      return;
    }
    try {
      var o = JSON.parse(raw);
      if (!o || !o.room || !(o.room.w >= 36) || !(o.room.d >= 36) || !Array.isArray(o.items)) throw new Error('bad');
      uid = 1;
      S.room = normRoom({ w: clamp(o.room.w, 36, 1200), d: clamp(o.room.d, 36, 1200), windows: o.room.windows });
      S.items = o.items.map(cleanItem); S.sel = null;
      commit(); renderAll(true); toast('Layout loaded');
    } catch (e) { toast('That text is not a saved layout.'); $('msg').style.color = 'var(--bad)'; setTimeout(function () { $('msg').style.color = ''; }, 3500); }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'INPUT' && ['checkbox', 'radio', 'button'].indexOf(t.type) < 0) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (k === 'd' || k === 'D')) { if (cur()) { e.preventDefault(); dupSel(); } return; }
    if (mod || e.altKey) return;
    if (k === 'Escape' && (drawTool || band)) { disarmDraw(); renderAll(true); return; }
    if (!cur()) return;
    var steps = nudgeSteps();
    var step = e.shiftKey ? steps.big : steps.step;
    if (k === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
    else if (k === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
    else if (k === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
    else if (k === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
    else if (k === 'r' || k === 'R') { rotateSel(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); delSel(); }
    else if (k === 'Escape') { S.sel = null; renderAll(true); }
  });

  var raf = 0;
  function onResize() { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderCanvas); }
  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', saveOnExit);
  window.addEventListener('beforeunload', saveOnExit);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveOnExit(); });
  window.addEventListener('hashchange', function () {
    if (loadFromHash()) { persist(); renderAll(true); toast('Opened a shared layout'); }
  });
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('canvasWrap'));

  /* ---------- share links ----------
     The layout is packed into a compact JSON object, then base64url encoded
     into the URL hash so a link can carry a whole room plan. */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  var KIND_CODE = { item: 0, door: 1, window: 2, area: 3 };
  var CODE_KIND = ['item', 'door', 'window', 'area'];
  function packLayout() {
    var w = S.room.windows || {};
    return {
      v: 1,
      r: [r1(S.room.w), r1(S.room.d)],
      w: [w.top ? 1 : 0, w.right ? 1 : 0, w.bottom ? 1 : 0, w.left ? 1 : 0],
      i: S.items.map(function (it) {
        var flags = KIND_CODE[it.kind] || 0;
        if (it.flat) flags |= 4;
        if (it.ov) flags |= 8;
        if (it.lock) flags |= 16;
        if (it.flip) flags |= 32;
        return [it.name, r1(it.w), r1(it.d), r1(it.x), r1(it.y), it.rot, it.color, flags];
      })
    };
  }
  function unpackLayout(o) {
    if (!o || o.v !== 1 || !Array.isArray(o.r) || !Array.isArray(o.i)) throw new Error('bad');
    var room = normRoom({ w: clamp(+o.r[0] || 0, 36, 1200), d: clamp(+o.r[1] || 0, 36, 1200) });
    if (Array.isArray(o.w)) {
      room.windows.top = !!o.w[0]; room.windows.right = !!o.w[1];
      room.windows.bottom = !!o.w[2]; room.windows.left = !!o.w[3];
    }
    var items = o.i.map(function (a) {
      if (!Array.isArray(a)) throw new Error('bad');
      var flags = a[7] | 0;
      return cleanItem({
        name: a[0], w: a[1], d: a[2], x: a[3], y: a[4], rot: a[5], color: a[6],
        kind: CODE_KIND[flags & 3], flat: !!(flags & 4), ov: !!(flags & 8),
        lock: !!(flags & 16), flip: !!(flags & 32)
      });
    });
    return { room: room, items: items };
  }
  function shareCode() { return b64encode(JSON.stringify(packLayout())); }
  function shareUrl() {
    var base = location.href.split('#')[0];
    return base + '#l=' + shareCode();
  }
  function loadFromCode(code) {
    try {
      var data = unpackLayout(JSON.parse(b64decode(code)));
      uid = 1;
      S.layouts.push({ name: 'Shared layout', room: data.room, items: data.items });
      S.li = S.layouts.length - 1;
      bindCur();
      S.sel = null;
      S.example = false;
      hist = []; fut = []; lastSnap = snapshot();
      return true;
    } catch (e) { return false; }
  }
  function loadFromHash() {
    var m = /^#l=(.+)$/.exec(location.hash || '');
    if (!m) return false;
    var ok = loadFromCode(m[1]);
    // Drop the code from the address once it's imported, so a reload doesn't add the layout again.
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { /* file:// in some browsers */ }
    return ok;
  }

  /* ---------- PDF export ---------- */
  var PLAN_CLASSES = /^(room|grid|wall|dim|dimtext|gaptext|halo|item|frame|jamb|swing|leaf|winline|hit|wallline|winlabel|area)$/;
  var PLAN_VARS = ['bg', 'fg', 'muted', 'line', 'accent', 'accent-fg', 'grid', 'grid-strong', 'room', 'wall',
    'bad', 'warn', 'ok', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'font-ui', 'font-head', 'font-mono'];
  function planCss(m, cs) {
    var names = PLAN_VARS;
    var out = 'svg{';
    for (var i = 0; i < names.length; i++) out += '--' + names[i] + ':' + cs.getPropertyValue('--' + names[i]).trim() + ';';
    out += '}';
    for (var sh = 0; sh < document.styleSheets.length; sh++) {
      var rules;
      try { rules = document.styleSheets[sh].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.selectorText || !r.style) continue;
        var sels = r.selectorText.split(',');
        var ok = true;
        for (var s = 0; s < sels.length; s++) {
          var t = sels[s].trim();
          // every selector must start with a plan class, which excludes page-level tag rules
          var mm = /^\.(room|grid|wall|dim|dimtext|gap|gaptext|halo|item|selbox|frame|jamb|swing|leaf|winline|hit|wallline|winlabel)\b/.exec(t);
          var first = mm ? mm[1] : '';
          if (!first || !PLAN_CLASSES.test(first)) { ok = false; break; }
        }
        if (!ok) continue;
        var css = r.style.cssText.replace(/vector-effect:\s*[^;"']+/g, '');
        css = css.replace(/stroke-width:\s*([\d.]+)/g, function (_, n) { return 'stroke-width:' + (parseFloat(n) * m).toFixed(4); });
        out += r.selectorText + '{' + css + '}';
      }
    }
    return out;
  }
  // Colours for an export: the plan's own, or for print the light palette, read from a
  // hidden probe so the plan on screen never changes colour.
  function exportStyle(print) {
    if (!print) return getComputedStyle(svg);
    var probe = document.createElement('span');
    probe.className = 'print-palette';
    probe.hidden = true;
    svg.parentNode.appendChild(probe);
    var cs = getComputedStyle(probe), copy = {};
    PLAN_VARS.forEach(function (n) { copy['--' + n] = cs.getPropertyValue('--' + n); });
    probe.parentNode.removeChild(probe);
    return { getPropertyValue: function (n) { return copy[n] || ''; } };
  }
  function buildPlanSvg(print) {
    var vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return null;
    var cssW = parseFloat(svg.style.width) || svg.clientWidth;
    var cssH = parseFloat(svg.style.height) || svg.clientHeight;
    if (!(cssW > 0) || !(cssH > 0)) return null;
    var m = vb[2] / cssW; // room units per screen px, so stroke widths export at screen weight
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVGNS);
    clone.setAttribute('width', cssW);
    clone.setAttribute('height', cssH);
    var st = document.createElementNS(SVGNS, 'style');
    var cs = exportStyle(print);
    st.textContent = planCss(m, cs);
    clone.insertBefore(st, clone.firstChild);
    var junk = clone.querySelectorAll('.selbox, .gap, .bandrect');
    for (var i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
    return { clone: clone, cssW: cssW, cssH: cssH, bg: cs.getPropertyValue('--bg').trim() };
  }
  function serializePlan(b) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(b.clone);
  }
  function rasterizePlan(b, cb) {
    var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serializePlan(b));
    var img = new Image();
    img.onload = function () {
      try {
        var k = Math.max(1, Math.min(4, 2200 / Math.max(b.cssW, b.cssH)));
        var cw = Math.round(b.cssW * k), ch = Math.round(b.cssH * k);
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = b.bg || '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        cb(cv, cw, ch);
      } catch (err) { cb(null, 0, 0); }
    };
    img.onerror = function () { cb(null, 0, 0); };
    img.src = src;
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function exportPdf() {
    var btn = $('exportPdf');
    btn.disabled = true;
    function done(err) {
      btn.disabled = false;
      toast(err ? 'Could not export the PDF.' : 'PDF downloaded.');
    }
    try {
      var b = buildPlanSvg(true);
      if (!b) { done(true); return; }
      rasterizePlan(b, function (cv, cw, ch) {
        if (!cv) { done(true); return; }
        try {
          downloadPdf(cv.toDataURL('image/jpeg', 0.94), cw, ch);
          done(false);
        } catch (err) { done(true); }
      });
    } catch (e) { done(true); }
  }
  function exportPng() {
    var btn = $('exportPng');
    btn.disabled = true;
    function done(err) {
      btn.disabled = false;
      toast(err ? 'Could not export the PNG.' : 'PNG downloaded.');
    }
    try {
      var b = buildPlanSvg();
      if (!b) { done(true); return; }
      rasterizePlan(b, function (cv) {
        if (!cv) { done(true); return; }
        try {
          cv.toBlob(function (blob) {
            if (!blob) { done(true); return; }
            downloadBlob(blob, 'room-plan.png');
            done(false);
          }, 'image/png');
        } catch (err) { done(true); }
      });
    } catch (e) { done(true); }
  }
  function exportSvg() {
    var btn = $('exportSvg');
    btn.disabled = true;
    function done(err) {
      btn.disabled = false;
      toast(err ? 'Could not export the SVG.' : 'SVG downloaded.');
    }
    try {
      var b = buildPlanSvg();
      if (!b) { done(true); return; }
      downloadBlob(new Blob([serializePlan(b)], { type: 'image/svg+xml' }), 'room-plan.svg');
      done(false);
    } catch (e) { done(true); }
  }
  function downloadPdf(jpegDataUrl, wPx, hPx) {
    var bin = atob(jpegDataUrl.split(',')[1]);
    var imgU8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) imgU8[i] = bin.charCodeAt(i);
    var ptW = String(Math.round(wPx * 72 / 150 * 100) / 100);
    var ptH = String(Math.round(hPx * 72 / 150 * 100) / 100);
    var parts = [], offset = 0;
    function emitStr(t) {
      var a = new Uint8Array(t.length);
      for (var i = 0; i < t.length; i++) a[i] = t.charCodeAt(i) & 0xFF;
      parts.push(a); offset += a.length;
    }
    function emitBytes(u) { parts.push(u); offset += u.length; }
    emitStr('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');
    var o1 = offset; emitStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    var o2 = offset; emitStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    var o3 = offset; emitStr('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW + ' ' + ptH + '] /Resources << /XObject << /Im1 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n');
    var o4 = offset;
    emitStr('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + imgU8.length + ' >>\nstream\n');
    emitBytes(imgU8);
    emitStr('\nendstream\nendobj\n');
    var contentStr = 'q\n' + ptW + ' 0 0 ' + ptH + ' 0 0 cm\n/Im1 Do\nQ';
    var o5 = offset;
    emitStr('5 0 obj\n<< /Length ' + contentStr.length + ' >>\nstream\n' + contentStr + '\nendstream\nendobj\n');
    var xrefPos = offset;
    var pad = function (n, w) { var t = '0000000000' + n; return t.slice(-w); };
    var xr = 'xref\n0 6\n0000000000 65535 f \n';
    [o1, o2, o3, o4, o5].forEach(function (o) { xr += pad(o, 10) + ' 00000 n \n'; });
    emitStr(xr + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');
    var blob = new Blob(parts, { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'room-plan.pdf';
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  $('exportPdf').addEventListener('click', exportPdf);
  $('exportPng').addEventListener('click', exportPng);
  $('exportSvg').addEventListener('click', exportSvg);

  /* ---------- start ---------- */
  try {
    if (!load()) useExample();
    if (loadFromHash()) { persist(); toast('Opened a shared layout'); }
    lastSnap = snapshot();
    renderAll(true);
    updateUndo();
  } catch (err) { showCrash(err); }
})();
