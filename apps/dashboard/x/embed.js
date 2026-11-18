/* SPDX-License-Identifier: AGPL-3.0-only */
/*
 * The website loader: put a form, or a live chat, on your own site.
 *
 *   <div data-adminium-form="showroom-visit"></div>
 *   <script src="https://<your address>/x/embed.js" async></script>
 *
 *   <script src="https://<your address>/x/embed.js" data-adminium-chat="live-chat" async></script>
 *
 * A FORM is drawn in a frame of its own page (`/x/forms/<slug>?frame=1`), in
 * the page's language, and the frame is sized to the form as it grows.
 *
 * A CHAT is one frame (`/x/chat/<addOn>?frame=1`), fixed to the page's
 * bottom corner on the page's own end side (right, or left on a right-to-
 * left page), whatever language the visitor reads the chat in. It starts at
 * no size: the chat sizes it once it is ready (the launcher, the open
 * window), or fills the screen as a sheet on a phone, when the page under it
 * stops scrolling. When the chat closes, focus comes back to its frame.
 * Loaded twice, it still draws one launcher.
 *
 * Everything runs inside the frames, on their own host: no code of the form
 * or the chat runs in this page, nothing is stored and no cookie is set. The
 * only name added to the page is `window.adminium`: `adminium.chat.open()`
 * and `.close()` let the site open its chat from its own button;
 * `adminium.consent(...)` is kept for the site's own cookie banner to speak
 * for the frames, and does nothing yet.
 *
 * Messages are taken only from a frame this loader drew and only from the
 * server's own origin, and sent only to that origin. The chat is told the
 * page's size and side, and once, the page it is on (origin and path, never
 * the query).
 *
 * Served minified (`vite.x.config.ts`); this is its source.
 */
(function () {
  'use strict';
  var w = window;
  var d = document;
  var api = w.adminium || {};
  var script = d.currentScript;
  var origin;
  try {
    origin = new URL(script && script.src ? script.src : '', d.baseURI).origin;
  } catch (e) {
    return;
  }
  var frames = [];
  var SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

  function lang() {
    return d.documentElement.lang || (navigator.language || '');
  }

  function address(door, name) {
    return origin + '/x/' + door + '/' + encodeURIComponent(name) + '?frame=1' + (lang() ? '&lang=' + encodeURIComponent(lang()) : '');
  }

  function say(frame, message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, origin);
  }

  /** A message to this loader: of the server's origin, from a frame it drew, an object. */
  function heard(event, frame) {
    return event.origin === origin && frame && event.source === frame.contentWindow && event.data && typeof event.data === 'object';
  }

  // ── Forms ───────────────────────────────────────────────────────────────

  function draw(box) {
    var slug = box.getAttribute('data-adminium-form') || '';
    if (!SLUG.test(slug) || box.getAttribute('data-adminium-drawn') === '1') return;
    box.setAttribute('data-adminium-drawn', '1');
    var frame = d.createElement('iframe');
    frame.src = address('forms', slug);
    frame.title = box.getAttribute('data-title') || slug;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.height = '480px';
    frame.addEventListener('load', function () {
      say(frame, { type: 'adminium:hello' });
    });
    frames.push(frame);
    box.appendChild(frame);
  }

  function scan() {
    var boxes = d.querySelectorAll('[data-adminium-form]');
    for (var i = 0; i < boxes.length; i += 1) draw(boxes[i]);
  }

  if (!api.forms) {
    w.addEventListener('message', function (event) {
      var frame = null;
      for (var i = 0; i < frames.length; i += 1) if (frames[i].contentWindow === event.source) frame = frames[i];
      if (!heard(event, frame)) return;
      var data = event.data;
      if (data.type === 'adminium:ready') say(frame, { type: 'adminium:hello' });
      else if (data.type === 'adminium:height' && typeof data.h === 'number' && data.h > 0 && data.h < 20000) frame.style.height = Math.ceil(data.h) + 'px';
    });
    api.forms = { scan: scan };
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', scan);
    else scan();
  }

  // ── The chat ────────────────────────────────────────────────────────────

  var addOn = script && script.getAttribute('data-adminium-chat');
  if (addOn && SLUG.test(addOn) && !api.chat) {
    var root = d.documentElement;
    var frame = d.createElement('iframe');
    var style = frame.style;
    // The page's own end side, from its direction, never the visitor's language.
    var side = root.dir === 'rtl' || getComputedStyle(root).direction === 'rtl' ? 'left' : 'right';
    // The page's overflow while the sheet holds it still; null when it is not held.
    var held = null;
    var size = function (n) {
      return typeof n === 'number' && n > 0 && n < 100000;
    };
    var view = function (type) {
      return { type: type, w: w.innerWidth, h: w.innerHeight, side: side };
    };
    var hold = function (on) {
      if (on && held === null) {
        held = root.style.overflow;
        root.style.overflow = 'hidden';
      } else if (!on && held !== null) {
        root.style.overflow = held;
        held = null;
      }
    };
    frame.src = address('chat', addOn);
    frame.title = script.getAttribute('data-title') || addOn;
    frame.setAttribute('referrerpolicy', 'no-referrer');
    // Transparent over the page: the frame's document is light, and so is the frame.
    style.cssText = 'position:fixed;z-index:2147483000;border:0;margin:0;padding:0;background:transparent;color-scheme:light;width:0;height:0;bottom:env(safe-area-inset-bottom,0px);' + side + ':0';
    w.addEventListener('message', function (event) {
      if (!heard(event, frame)) return;
      var data = event.data;
      if (data.type === 'adminium:ready') {
        var hello = view('adminium:hello');
        hello.page = w.location.origin + w.location.pathname;
        say(frame, hello);
      } else if (data.type === 'adminium:size' && size(data.w) && size(data.h)) {
        var sheet = data.sheet === true;
        style.width = sheet ? '100%' : Math.ceil(data.w) + 'px';
        style.height = sheet ? '100%' : Math.ceil(data.h) + 'px';
        style.top = sheet ? '0' : 'auto';
        style.bottom = sheet ? '0' : 'env(safe-area-inset-bottom,0px)';
      } else if (data.type === 'adminium:open') hold(data.sheet === true);
      else if (data.type === 'adminium:close') {
        hold(false);
        // Back to the frame, unless it holds focus already (the chat then gave it to its launcher).
        if (d.activeElement !== frame) frame.focus();
      } else if (data.type === 'adminium:unread' && typeof data.n === 'number') api.chat.unread = data.n;
    });
    w.addEventListener('resize', function () {
      say(frame, view('adminium:viewport'));
    });
    api.chat = {
      open: function () {
        say(frame, { type: 'adminium:open' });
      },
      close: function () {
        say(frame, { type: 'adminium:close' });
      },
      unread: 0,
    };
    if (d.body) d.body.appendChild(frame);
    else
      d.addEventListener('DOMContentLoaded', function () {
        d.body.appendChild(frame);
      });
  }

  api.consent = api.consent || function () {};
  w.adminium = api;
})();
