/* pad.js — on-screen controls for the SM64 web build.
 *
 * How state reaches the game: the engine is compiled with SDL2 (emscripten), and
 * sm64-port's controller_sdl.c polls the Gamepad API through SDL. So instead of
 * synthesising key events we expose a *virtual standard-mapping gamepad* on
 * navigator.getGamepads(). SDL cannot tell it apart from a real controller, which
 * means touch, a physical pad and the keyboard all drive the same code path.
 *
 * Button map used by controller_sdl.c:
 *   0 (A)  -> A     2 (X)  -> B     4/6 (LB/LT) -> Z
 *   5 (RB) -> R     9 (Start) -> START
 *   axes 0/1 -> analogue stick, axes 2/3 -> C buttons
 */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  var enabled = Q.get('touch') === '1' || (Q.get('touch') !== '0' && coarse);
  var built = false;
  var gameReady = false;

  var BUTTONS = ['A', 'B', 'Z', 'L', 'R', 'Start', 'CU', 'CD', 'CL', 'CR', 'DU', 'DD', 'DL', 'DR'];
  var S = { x: 0, y: 0 };
  for (var i = 0; i < BUTTONS.length; i++) S[BUTTONS[i]] = 0;

  /* standard mapping -> N64 button */
  var MAP = { A: 0, B: 2, Start: 9, Z: 6, L: 4, R: 5, DU: 12, DD: 13, DL: 14, DR: 15 };
  /* Z also on the left shoulder, R also on the right trigger: belt and braces */
  var EXTRA = { Z: [4, 6], R: [5, 7] };

  /* ------------------------------------------------------------ real pads */
  var nativeGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : function () { return []; };
  function realPad() {
    var pads = nativeGetGamepads();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected && !pads[i].__virtual) return pads[i];
    }
    return null;
  }

  /* -------------------------------------------------------- virtual pad */
  function virtualPad() {
    var buttons = [];
    for (var b = 0; b < 17; b++) buttons.push({ pressed: false, touched: false, value: 0 });
    for (var k in MAP) {
      if (MAP.hasOwnProperty(k) && S[k]) {
        buttons[MAP[k]] = { pressed: true, touched: true, value: 1 };
      }
    }
    for (var e in EXTRA) {
      if (EXTRA.hasOwnProperty(e) && S[e]) {
        for (var j = 0; j < EXTRA[e].length; j++) {
          buttons[EXTRA[e][j]] = { pressed: true, touched: true, value: 1 };
        }
      }
    }
    /* C buttons ride the right stick; right = +x, down = +y */
    var cx = (S.CR ? 1 : 0) - (S.CL ? 1 : 0);
    var cy = (S.CD ? 1 : 0) - (S.CU ? 1 : 0);
    return {
      id: 'SM64 Touch Pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)',
      index: 0, connected: true, mapping: 'standard', __virtual: true,
      timestamp: performance.now(),
      axes: [S.x, -S.y, cx, cy],
      buttons: buttons,
      vibrationActuator: null
    };
  }

  function installVirtualPad() {
    if (!enabled) return;
    navigator.getGamepads = function () {
      if (realPad() || !built) return nativeGetGamepads();
      return [virtualPad(), null, null, null];
    };
    var announce = function () {
      try {
        var ev = new Event('gamepadconnected');
        ev.gamepad = virtualPad();
        window.dispatchEvent(ev);
      } catch (e) { /* older browsers */ }
    };
    announce();
    setInterval(announce, 2000); /* SDL re-scans on its own; this is cheap insurance */
  }

  /* --------------------------------------------------------------- styles */
  /* Layout is done with flex/grid so controls can never overlap each other:
     #zone-right is a bottom-right column (C pad, then the A/B/Z row) and the
     stick floats in the bottom-left zone. Sizes scale with vmin. */
  var CSS = '' +
  '#pad{position:fixed;inset:0;z-index:20;pointer-events:none;display:none;' +
  '  --btn:clamp(46px,10.5vmin,80px);--big:clamp(58px,13.5vmin,100px);--cell:calc(var(--btn)*.84);' +
  '  --stick:clamp(96px,30vmin,158px);' +
  '  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}' +
  '#pad.on{display:block}' +
  '#pad .zone{position:absolute;pointer-events:none}' +
  '#zone-left{left:0;bottom:0;width:46%;height:58%;pointer-events:auto}' +
  '#zone-right{right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));' +
  '  display:flex;flex-direction:column;align-items:flex-end;gap:10px}' +
  '#pad .btn{position:relative;display:flex;align-items:center;justify-content:center;pointer-events:auto;' +
  '  border-radius:50%;border:2px solid rgba(255,255,255,.34);color:#fff;font-weight:800;' +
  '  letter-spacing:.04em;background:rgba(30,38,52,.46);backdrop-filter:blur(3px);padding:0;' +
  '  box-shadow:0 4px 14px rgba(0,0,0,.42),inset 0 -3px 0 rgba(0,0,0,.28);' +
  '  touch-action:none;-webkit-tap-highlight-color:transparent;transition:transform .05s,filter .05s,background .05s;}' +
  '#pad .btn.on{transform:scale(.93);filter:brightness(1.5);background:rgba(90,120,190,.75)}' +
  /* C buttons: 3x3 grid, one per side */
  '#pad .cgroup{display:grid;grid-template-columns:repeat(3,var(--cell));grid-template-rows:repeat(3,var(--cell));' +
  '  gap:2px;place-items:center;pointer-events:none}' +
  '#pad .c{width:var(--cell);height:var(--cell);font-size:calc(var(--cell)*.32);' +
  '  background:radial-gradient(circle at 36% 30%,#ffd95c,#bd8b00);color:#241c00}' +
  '#pad .cu{grid-area:1/2/2/3} #pad .cl{grid-area:2/1/3/2}' +
  '#pad .cr{grid-area:2/3/3/4} #pad .cd{grid-area:3/2/4/3}' +
  /* A / B / Z row */
  '#pad .face{display:flex;align-items:flex-end;gap:10px;pointer-events:none}' +
  '#pad .a{width:var(--big);height:var(--big);font-size:calc(var(--big)*.34);' +
  '  background:radial-gradient(circle at 36% 30%,#6b98ff,#2043c0)}' +
  '#pad .b{width:var(--btn);height:var(--btn);font-size:calc(var(--btn)*.34);' +
  '  background:radial-gradient(circle at 36% 30%,#5fd67a,#158035)}' +
  '#pad .z{width:var(--btn);height:calc(var(--btn)*.8);border-radius:15px;font-size:calc(var(--btn)*.3);' +
  '  background:linear-gradient(#6b7284,#3a3f4d)}' +
  /* START lives in the top-left corner, clear of both thumbs and the C pad */
  '#pad .st{position:fixed;left:max(10px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));' +
  '  width:calc(var(--btn)*1.5);height:calc(var(--btn)*.62);border-radius:999px;font-size:11px;' +
  '  background:linear-gradient(#e0574f,#8e1f1a)}' +
  '#stick{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));' +
  '  width:var(--stick);height:var(--stick);border-radius:50%;border:3px solid rgba(255,255,255,.26);' +
  '  background:radial-gradient(circle,rgba(255,255,255,.12),rgba(255,255,255,.02));' +
  '  touch-action:none;pointer-events:auto;transition:transform .06s ease-out}' +
  '#stick.active{transition:none}' +
  '#knob{position:absolute;left:50%;top:50%;width:42%;height:42%;margin:-21% 0 0 -21%;border-radius:50%;' +
  '  background:radial-gradient(circle at 36% 30%,#e3e6ee,#767d90);box-shadow:0 4px 12px rgba(0,0,0,.55);' +
  '  pointer-events:none}' +
  '#pad .hint{position:absolute;left:50%;transform:translateX(-50%);bottom:2px;font-size:10px;' +
  '  color:rgba(255,255,255,.42);pointer-events:none;white-space:nowrap}' +
  '@media (max-height:430px){ #pad{--btn:44px;--big:56px;--stick:92px} #pad .hint{display:none} }';

  /* ------------------------------------------------------------------ DOM */
  var root, stickEl, knobEl, zoneLeft;

  function el(tag, cls, html, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  function build() {
    if (built) return;
    built = true;

    el('style', null, CSS, document.head);

    root = el('div', '', '', document.body);
    root.id = 'pad';

    zoneLeft = el('div', 'zone', '', root);
    zoneLeft.id = 'zone-left';
    stickEl = el('div', '', '<div id="knob"></div>', zoneLeft);
    stickEl.id = 'stick';
    knobEl = document.getElementById('knob');

    var right = el('div', 'zone', '', root);
    right.id = 'zone-right';

    /* C buttons: 3x3 grid, placed one per side by CSS */
    var cg = el('div', 'cgroup', '', right);
    addBtn(cg, 'btn c cu', 'C', 'CU');
    addBtn(cg, 'btn c cl', 'C', 'CL');
    addBtn(cg, 'btn c cr', 'C', 'CR');
    addBtn(cg, 'btn c cd', 'C', 'CD');

    var face = el('div', 'face', '', right);
    addBtn(face, 'btn z', 'Z', 'Z');
    addBtn(face, 'btn b', 'B', 'B');
    addBtn(face, 'btn a', 'A', 'A');

    /* START is fixed to the top-left corner, outside the flow */
    addBtn(root, 'btn st', 'START', 'Start');

    el('div', 'hint', 'drag to move &nbsp;·&nbsp; A jump &nbsp;·&nbsp; B punch &nbsp;·&nbsp; Z crouch', root);

    bindStick();
    setOn(enabled);
  }

  function addBtn(parent, cls, label, name) {
    var b = el('button', cls, label, parent);
    b.type = 'button';
    b.setAttribute('aria-label', name);
    b.dataset.b = name;
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      /* Capture keeps the button held while the finger slides off it. Some
         browsers (and synthetic pointers) throw here, which must never stop
         the press from registering. */
      capture(b, e.pointerId);
      S[name] = 1;
      b.classList.add('on');
      if (navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
    }, { passive: false });
    var up = function (e) {
      if (e) e.preventDefault();
      S[name] = 0;
      b.classList.remove('on');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', function (e) { if (e.buttons === 0) up(e); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }

  /* ---------------------------------------------------------------- stick */
  var stickId = null, cx = 0, cy = 0, radius = 1, homeX = 0, homeY = 0;

  function capture(el, id) {
    try { if (el.setPointerCapture) el.setPointerCapture(id); } catch (err) { /* not capturable */ }
  }

  function bindStick() {
    stickEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      stickId = e.pointerId;
      stickEl.classList.add('active');
      var r = stickEl.getBoundingClientRect();
      homeX = r.left + r.width / 2;
      homeY = r.top + r.height / 2;
      radius = Math.max(8, r.width * 0.42);
      capture(stickEl, e.pointerId);
      /* floating origin: re-centre the base on the first touch inside the zone */
      move(e.clientX, e.clientY);
    }, { passive: false });

    zoneLeft.addEventListener('pointerdown', function (e) {
      if (e.target !== zoneLeft) return;
      e.preventDefault();
      var r = stickEl.getBoundingClientRect();
      /* bring the stick to the thumb */
      stickEl.style.left = (e.clientX - r.width / 2 - zoneLeft.getBoundingClientRect().left) + 'px';
      stickEl.style.bottom = (zoneLeft.getBoundingClientRect().bottom - e.clientY - r.height / 2) + 'px';
      stickId = e.pointerId;
      stickEl.classList.add('active');
      var r2 = stickEl.getBoundingClientRect();
      homeX = r2.left + r2.width / 2;
      homeY = r2.top + r2.height / 2;
      radius = Math.max(8, r2.width * 0.42);
      capture(stickEl, e.pointerId);
      S.x = 0; S.y = 0;
      knobEl.style.transform = '';
    }, { passive: false });

    function move(clientX, clientY) {
      var dx = clientX - homeX;
      var dy = clientY - homeY;
      var len = Math.sqrt(dx * dx + dy * dy);
      var max = radius;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; len = max; }
      knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      var nx = dx / max, ny = dy / max;
      /* 0.14 dead zone, then rescale so the full range stays usable */
      var mag = Math.min(1, Math.sqrt(nx * nx + ny * ny));
      if (mag < 0.14) { S.x = 0; S.y = 0; return; }
      var s = (mag - 0.14) / (1 - 0.14) / mag;
      S.x = nx * s;
      S.y = -ny * s;      /* up is +y in our convention */
    }

    window.addEventListener('pointermove', function (e) {
      if (e.pointerId !== stickId) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    }, { passive: false });

    function release(e) {
      if (e.pointerId !== stickId) return;
      stickId = null;
      S.x = 0; S.y = 0;
      knobEl.style.transform = '';
      stickEl.classList.remove('active');
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  /* --------------------------------------------------------------- public */
  function setOn(on) {
    if (!built) return;
    enabled = on;
    root.classList.toggle('on', !!on && !realPad());
  }

  function releaseAll() {
    for (var i = 0; i < BUTTONS.length; i++) S[BUTTONS[i]] = 0;
    S.x = 0; S.y = 0;
    stickId = null;
    if (built) {
      var bs = root.querySelectorAll('.btn.on');
      for (var j = 0; j < bs.length; j++) bs[j].classList.remove('on');
      if (knobEl) knobEl.style.transform = '';
    }
  }

  window.__pad = {
    state: S,
    sample: function () { return realPad() ? null : S; },
    toggle: function () { setOn(!enabled); return enabled; },
    isOn: function () { return enabled; },
    onGameReady: function () {
      gameReady = true;
      if (enabled) setOn(true);
    }
  };

  /* ------------------------------------------------------------- lifecycle */
  function boot() {
    if (document.body) { build(); installVirtualPad(); }
    else document.addEventListener('DOMContentLoaded', function () { build(); installVirtualPad(); });

    window.addEventListener('gamepadconnected', function () {
      if (realPad()) setOn(false);   /* a real controller wins */
    });
    window.addEventListener('gamepaddisconnected', function () {
      if (!realPad() && coarse) setOn(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseAll();   /* never leave a button stuck */
    });
    window.addEventListener('blur', releaseAll);
    window.addEventListener('orientationchange', function () { releaseAll(); rect(); });

    function rect() {
      document.body.classList.toggle('landscape', window.innerWidth > window.innerHeight);
    }
    rect();
    window.addEventListener('resize', rect);
  }

  boot();
})();
