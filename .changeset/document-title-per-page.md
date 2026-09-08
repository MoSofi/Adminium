---
'@adminium/dashboard': patch
---

The browser tab names the page. `document.title` had one publisher — branding,
at the root route — so every screen rendered a tab reading "Adminium" and a
strip of six open tabs said nothing about which page each one was. It is now
composed by a single owner from two slots: the workspace name, and the screen.

Inside the shell the topbar is the one writer, so the tab mirrors the `<h1>`
and the two can never disagree. Screens whose heading cannot identify them
publish a tab name of their own: a record page reads "Amara Osei · Clients ·
Adminium", a full-page system state names the state rather than the page it
replaced. Sign-in, the routed 404 and the direct-addressed system states have
no shell above them and name themselves.

Two Studio screens drew their own header and published none, so the shell's h1
fell back to "Home" above them — the schema editor, and the AI review, which
was rendering a second `<h1>` in its summary card. Both now publish their real
heading, so the topbar, the tab and the body agree.
