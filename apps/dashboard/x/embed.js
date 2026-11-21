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
 * AN APP'S SCREEN, on an element of the site:
 *
 *   <div data-adminium-app="bookings" data-path="/book?service=gel" data-mode="inline">
 *     <a href="https://<your address>/apps/bookings/customer/book">Book online</a>
 *   </div>
 *
 * `data-adminium-app` is the app's key, or `<key>~<copy>` for a later copy.
 * `data-mode` is `inline` (the default), `button` (the element is the site's
 * own button, pressed to open a sheet) or `floating` (a launcher in a corner;
 * one per page, like the button). `data-label` is the launcher's words, at
 * most 28 letters, passed as text; `data-theme` is `light` or `dark`;
 * `data-title` names the frame. The path is checked against one strict
 * grammar and joined, never resolved, so it can only name a screen of this
 * server's app. The frame shows nothing until it has a size: until then the
 * element's own link stays, so a refused or switched-off frame leaves a plain
 * link. Beside a chat, a launcher takes the page's other corner. The site hears one thing, the event `adminium:booked` on the
 * element (`detail.code`), a value that opens nothing.
 *
 * Everything runs inside the frames, on their own host: no code of the form
 * or the chat runs in this page, nothing is stored and no cookie is set. The
 * only name added to the page is `window.adminium`: `adminium.chat.open()`
 * and `.close()` let the site open its chat from its own button, and
 * `adminium.app` its sheet;
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
  var SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
  // A path of the app: plain letters, no `//`, no `.` or `..` part, an optional plain query.
  var PATH = /^(?!.*\/\/)\/(?!(?:.*\/)?\.\.?(?:[/?]|$))[\w.~/-]*(\?[\w.~=&%-]*)?$/;
  var BOTTOM = 'env(safe-area-inset-bottom,0px)';
  var root = d.documentElement;
  // The page's own end side, from its direction, never the visitor's language.
  var side = root.dir === 'rtl' || getComputedStyle(root).direction === 'rtl' ? 'left' : 'right';
  // Every frame this copy drew: { f: the frame, b: its element, o: fixed over the page, a: an app's, m: its mode, r: ready }
  // (short, because a minifier keeps property names).
  var drawn = [];
  // The one frame of an app that sits over the page.
  var sheet = null;
  // The page's overflow while a sheet holds it still; null when it is not held.
  var held = null;

  function attr(el, name) {
    return el.getAttribute('data-' + name) || '';
  }

  function each(list, act) {
    for (var i = 0; i < list.length; i += 1) act(list[i]);
  }

  function px(n) {
    return Math.ceil(n) + 'px';
  }

  /** Once the page has a body to draw in. */
  function soon(act) {
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', act);
    else act();
  }

  function query() {
    var lang = root.lang || navigator.language || '';
    return 'frame=1' + (lang ? '&lang=' + encodeURIComponent(lang) : '');
  }

  function say(one, type, message) {
    message = message || {};
    message.type = 'adminium:' + type;
    if (one.f.contentWindow) one.f.contentWindow.postMessage(message, origin);
  }

  function view() {
    return { w: w.innerWidth, h: w.innerHeight, side: side };
  }

  function size(n) {
    return n === +n && n > 0 && n < 100000;
  }

  function hold(on) {
    var page = root.style;
    if (on == (held === null)) {
      if (on) {
        held = page.overflow;
        page.overflow = 'hidden';
      } else {
        page.overflow = held;
        held = null;
      }
    }
  }

  /** Whether this element is still to draw; asked last, it marks it drawn. */
  function fresh(box) {
    if (attr(box, 'adminium-drawn')) return false;
    box.setAttribute('data-adminium-drawn', '1');
    return true;
  }

  /** A frame of this server's, its title the element's own words or its name. */
  function frameOf(src, box, name) {
    var f = d.createElement('iframe');
    var one = { f: f, b: box };
    f.src = origin + src;
    f.title = attr(box, 'title') || name;
    f.setAttribute('referrerpolicy', 'no-referrer');
    drawn.push(one);
    return one;
  }

  function inPage(one, height) {
    one.f.style.cssText = 'width:100%;border:0;display:block;height:' + height;
    one.b.appendChild(one.f);
  }

  /** At no size, transparent over the page: the frame's document is light, and so is the frame. */
  function overPage(one) {
    one.o = 1;
    one.f.style.cssText = 'position:fixed;z-index:2147483000;border:0;margin:0;padding:0;background:transparent;color-scheme:light;width:0;height:0;bottom:' + BOTTOM + ';' + side + ':0';
    soon(() => {
      d.body.appendChild(one.f);
    });
  }

  function drawForm(box) {
    var slug = attr(box, 'adminium-form');
    if (!SLUG.test(slug) || !fresh(box)) return;
    var one = frameOf('/x/forms/' + slug + '?' + query(), box, slug);
    one.f.setAttribute('loading', 'lazy');
    inPage(one, '480px');
    one.f.addEventListener('load', () => {
      say(one, 'hello');
    });
  }

  function drawApp(box) {
    var name = attr(box, 'adminium-app').split('~');
    var mode = attr(box, 'mode') || 'inline';
    var path = attr(box, 'path') || '/';
    var inline = mode === 'inline';
    // The site drew its page again: the old element's frame goes with it.
    if (sheet && !root.contains(sheet.b)) {
      sheet.f.remove();
      sheet = null;
    }
    if (name.length > 2 || !name.every(SLUG.test, SLUG) || !PATH.test(path) || !(inline || mode === 'button' || mode === 'floating') || (!inline && sheet) || !fresh(box)) return;
    var one = frameOf('/apps/' + name.join('/') + '/customer' + path + (path.indexOf('?') < 0 ? '?' : '&') + query() + '&mode=' + mode + (attr(box, 'theme') === 'dark' ? '&theme=dark' : ''), box, name[0]);
    one.a = 1;
    one.m = mode;
    if (inline) inPage(one, '0');
    else {
      sheet = one;
      overPage(one);
      if (mode === 'button')
        box.addEventListener('click', (event) => {
          // Until the frame is ready the element is a plain link.
          if (!one.r) return;
          event.preventDefault();
          say(one, 'open');
        });
    }
  }

  function scan() {
    each(d.querySelectorAll('[data-adminium-form]'), drawForm);
    each(d.querySelectorAll('[data-adminium-app]'), drawApp);
  }

  /** The frame has something to show: only now does the element's own link give way, so a frame that never does leaves it. */
  function shows(one) {
    if (one.a && one.m != 'button')
      each(one.b.children, (child) => {
        if (child != one.f) child.hidden = true;
      });
  }

  /** A message from a frame this copy drew, of the server's own origin. */
  function hear(one, data) {
    var type = data.type;
    if (typeof type !== 'string' || type.indexOf('adminium:')) return;
    type = type.slice(9);
    var f = one.f;
    var style = f.style;
    var box = one.b;
    if (type === 'ready') {
      var hello = one.o ? view() : {};
      if (one.a) {
        one.r = 1;
        hello.mode = one.m;
        hello.label = attr(box, 'label').slice(0, 28);
      } else if (one.o) hello.page = location.origin + location.pathname;
      say(one, 'hello', hello);
    } else if (type === 'height') {
      if (!one.o && size(data.h) && data.h < 20000) {
        style.height = px(data.h);
        shows(one);
      }
    } else if (one.a && type === 'done') {
      box.dispatchEvent(new CustomEvent('adminium:booked', { bubbles: true, detail: typeof data.code == 'string' && /^[\w-]{1,32}$/.test(data.code) ? { code: data.code } : {} }));
    } else if (one.a && type === 'scroll') {
      f.scrollIntoView();
    } else if (one.o) {
      if (type === 'size' && size(data.w) && size(data.h)) {
        var full = data.sheet === true;
        style.width = full ? '100%' : px(data.w);
        style.height = full ? '100%' : px(data.h);
        style.top = full ? '0' : 'auto';
        style.bottom = full ? '0' : BOTTOM;
        // Beside a chat, on the other side: two launchers in one corner would cover each other.
        if (one.a && api.chat) {
          style[side] = '';
          style[side == 'left' ? 'right' : 'left'] = '0';
        }
        shows(one);
      } else if (type === 'open') {
        hold(data.sheet === true);
        if (one.a) f.focus();
      } else if (type === 'close') {
        hold(false);
        // A sheet with no launcher to go back to must not stay over the page, unseen, taking its clicks.
        if (one.a && style.width == '100%') style.width = style.height = '0';
        if (one.m == 'button') box.focus();
        // Back to the frame, unless it holds focus already (the chat then gave it to its launcher).
        else if (d.activeElement !== f) f.focus();
      } else if (type === 'unread' && data.n === +data.n && !one.a) api.chat.unread = data.n;
    }
  }

  w.addEventListener('message', (event) => {
    each(drawn, (one) => {
      if (event.origin === origin && event.source === one.f.contentWindow && event.data && typeof event.data === 'object') hear(one, event.data);
    });
  });
  w.addEventListener('resize', () => {
    each(drawn, (one) => {
      if (one.o) say(one, 'viewport', view());
    });
  });

  /** The site's own button opening or closing a frame over the page: the chat's, or the app's sheet. */
  function opener(type, one) {
    return () => {
      if (one || sheet) say(one || sheet, type);
    };
  }

  if (!api.forms) {
    api.forms = { scan: scan };
    api.app = { open: opener('open'), close: opener('close') };
    soon(scan);
  }

  var addOn = script && script.getAttribute('data-adminium-chat');
  if (addOn && SLUG.test(addOn) && !api.chat) {
    var chat = frameOf('/x/chat/' + addOn + '?' + query(), script, addOn);
    overPage(chat);
    api.chat = {
      open: opener('open', chat),
      close: opener('close', chat),
      unread: 0,
    };
  }

  api.consent = api.consent || (() => {});
  w.adminium = api;
})();
