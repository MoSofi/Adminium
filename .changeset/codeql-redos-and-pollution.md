---
'@adminium/server': patch
'@adminium/i18n': patch
---

**Three findings from the CodeQL backlog, fixed rather than dismissed.** Each was checked against
the code before being acted on; the rest of the backlog is false positives in the same sweep and
is being dismissed separately.

- **A version string could burn a minute of CPU.** `EXACT_VERSION_PATTERN` gates which add-on and
  app versions the installer accepts from the catalogue. It repeated
  `[-+][0-9A-Za-z.-]+`, and because that class also contains `-`, `-a-b` could be one segment or
  two — so a version that fails to match backtracks through every split. `0.0.0+` followed by 24
  `--` pairs took **74 seconds** to reject, 22 pairs took 9.7 s and 18 took 207 ms: a clean
  doubling. The tail is now one optional group, which accepts exactly the same strings (checked
  against 119 of them) and rejects the payload in microseconds. The input path is the first-party
  catalogue over https, so this was not reachable by an ordinary caller — but it guarded the
  add-on supply chain with an exponential regex.

- **A translation key could reach `Object.prototype`.** `nestBundle` splits a dotted key and
  assigns down the path, so a key containing `__proto__` wrote through to the prototype and gave
  every object in the process the property. Keys are not always ours: the runtime-translations
  feature stores them in the database, and this is an exported entry point of the package. Nodes
  are now prototype-less, so such a key round-trips as an ordinary own property instead of being
  dropped or escaping.

- **The release rehearsal printed a real secret.** `rehearse-npx.mjs` prints a ready-to-copy
  command including `ADMINIUM_SECRET=`. With the variable unset that is a throwaway value
  generated for the run; with it set — and it is the production secret's own variable — the
  script echoed the operator's real secret to stdout, and from there into scrollback, a screen
  share or a pasted bug report. It now prints `$ADMINIUM_SECRET` when the value came from the
  environment, so the shell expands it and the secret never reaches the terminal.

Both library fixes carry a test that fails against the old code: the version test rejects the
backtracking payload under a time budget, and the bundle test asserts nothing outside the bundle
changed.
