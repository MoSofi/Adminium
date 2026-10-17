<!-- produced from apps/docs/src/content/docs/reference/cli.md § `design`; do not edit -->

# CLI reference: `design`

```
adminium design [folder] [--port <n>] [--no-open]
```

Opens Adminium Designer in your browser, signed in: describe an app, and a model you choose writes
it into `apps/<key>/` while Adminium checks it, applies it and shows it.

- Outside a project it makes one first, in `folder` (default `my-app`), as `new` would, with a
  database file of its own (`data/app.sqlite`) and no questions.
- The server runs in this process, on this machine only (`127.0.0.1`, whatever `HOST` says), on the
  first free port from 4700 unless `--port` names one. It answers to `127.0.0.1:<port>`,
  `localhost:<port>` and `[::1]:<port>` and nothing else; the preview of what is built is served on
  `localhost`, the Designer itself on `127.0.0.1`.
- The first time, it makes the project's owner with no password. The link it opens signs that
  owner in, once, within fifteen minutes; a second tab or a copied link shows "This link has been
  used", and running the command again makes a new one. Give the owner an address and a password with
  [`owner set`](https://docs.adminium.dev/reference/cli/#owner) before the project runs anywhere else. A project whose owner has a
  password gets no link: sign in as usual.
- The folder is the master copy, as under [`dev`](https://docs.adminium.dev/reference/cli/#dev). Files you change by hand are picked up at
  the Designer's next turn.

`--no-open` prints the link instead of opening the browser. Stop it with Ctrl-C.
