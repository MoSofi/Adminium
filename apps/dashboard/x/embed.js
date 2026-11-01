/* SPDX-License-Identifier: AGPL-3.0-only */
/*
 * The website loader: put a form on your own site.
 *
 *   <div data-adminium-form="showroom-visit"></div>
 *   <script src="https://<your address>/x/embed.js" async></script>
 *
 * It draws the form in a frame of its own page (`/x/forms/<slug>?frame=1`),
 * in the page's language, and sizes the frame to the form as it grows. The
 * form runs inside the frame, on its own host: no code of the form runs in
 * this page, nothing is stored and no cookie is set. The only name it adds
 * to the page is `window.adminium`; `adminium.consent(...)` is kept for the
 * site's own cookie banner to speak for the frame, and does nothing yet.
 *
 * It listens to one message: a frame's height, taken only from a frame it
 * drew and only from the form's own origin.
 */
(function () {
  'use strict';
  var w = window;
  var d = document;
  var api = w.adminium || {};
  if (api.forms) return;
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

  function hello(frame) {
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'adminium:hello' }, origin);
  }

  function draw(box) {
    var slug = box.getAttribute('data-adminium-form') || '';
    if (!SLUG.test(slug) || box.getAttribute('data-adminium-drawn') === '1') return;
    box.setAttribute('data-adminium-drawn', '1');
    var frame = d.createElement('iframe');
    var query = '?frame=1' + (lang() ? '&lang=' + encodeURIComponent(lang()) : '');
    frame.src = origin + '/x/forms/' + encodeURIComponent(slug) + query;
    frame.title = box.getAttribute('data-title') || slug;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.height = '480px';
    frame.addEventListener('load', function () {
      hello(frame);
    });
    frames.push(frame);
    box.appendChild(frame);
  }

  function scan() {
    var boxes = d.querySelectorAll('[data-adminium-form]');
    for (var i = 0; i < boxes.length; i += 1) draw(boxes[i]);
  }

  function frameOf(source) {
    for (var i = 0; i < frames.length; i += 1) if (frames[i].contentWindow === source) return frames[i];
    return null;
  }

  w.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    var frame = frameOf(event.source);
    var data = event.data;
    if (!frame || !data || typeof data !== 'object') return;
    if (data.type === 'adminium:ready') hello(frame);
    else if (data.type === 'adminium:height' && typeof data.h === 'number' && data.h > 0 && data.h < 20000) frame.style.height = Math.ceil(data.h) + 'px';
  });

  api.forms = { scan: scan };
  api.consent = function () {};
  w.adminium = api;
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
