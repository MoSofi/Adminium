---
'@adminium/server': patch
---

Stop secrets surviving the log. The redaction set only ever protected one depth.

`REDACT_PATHS` reads as though `*.password` covers "password at any level".
It does not — pino's `*` is exactly one level. Measured against the installed
pino 10.3.1:

    { password }             depth 1  -> NOT redacted
    { a: { password } }      depth 2  -> redacted
    { a: { b: { password }}} depth 3  -> NOT redacted
    { users: [{ password }]} array    -> NOT redacted

So every `*.`-prefixed entry — `*.token`, `*.secret`, `*.apiKey`, `*.dsn`,
`*.bootToken`, `*.ADMINIUM_SECRET` — guarded depth 2 and nothing else.
`@pinojs/redact`'s own README says "redacts password at any level", which is
very likely how the list came to be written that way. The obvious repair is a
trap: `'**.pass'` is accepted by pino's path validator and matches nothing at
any depth, so it would look applied and redact nothing.

Redaction is now a rule rather than a list: a `formatters.log` hook walks the
whole object to any depth and through arrays. The path list is kept — it is
exact for `req.headers.*` and costs nothing — but it is no longer the guarantee.

Fields that were covered at NO depth and now are: `pass` and `passEncrypted`
(the SMTP credential — the stored ciphertext AND the decrypted plaintext, which
is the more valuable of the two), `otpauthUrl` (a string carrying the full TOTP
seed), `recoveryCodes`, `challengeToken`, `secretEncrypted`, and `lastError`
(driver errors routinely quote the whole connection string — `export/redaction.ts`
already refused to export it for that reason while the log had no equivalent).

The comment in `email/config.ts` asserting pino redacted the SMTP password is
corrected. It was false, and it is the kind that stops the next person checking —
`app.ts` had already documented the very rule it violated, in the `bootToken`
note directly above the list.

The scrub returns class instances by reference, so the `req` and `err`
serializers still see real objects (pino runs formatters before serializers, so
cloning an Error would have cost its message and stack). It is total against
throwing getters, circular references and depth, and returns the same reference
when nothing matched. `test/log-redaction.test.ts` drives the real `buildLogger`
and asserts on the bytes it writes — four of its cases fail against the previous
state.
