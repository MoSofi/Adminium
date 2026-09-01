---
'@adminium/server': patch
---

All three connect kinds now work: OAuth2 lands, host-run, with PKCE.

26 D2 refuses a subset — *"shipping two of three means one of four add-ons
cannot be connected, which is a dead entry in a list the user can see"* — so
this closes it. `import-canva` is connectable.

**Adminium runs the flow, which is what makes acceptance #2 true.** The add-on
declares where to authorize and gets handed an access token when there is one;
it never holds the client secret, never sees the code verifier, and never
performs the exchange. PKCE sits on top of a confidential-client flow
deliberately: the authorization code travels back through a browser, and a
verifier the browser never saw is what makes an intercepted code useless alone.

**The OAuth endpoints are held to the add-on's own egress allow-list.** The
manifest validator requires an `oauth2` connect to declare both URLs and does
*not* require their hosts to appear in `network.allow` — so an add-on could
declare a token endpoint at `evil.example` while its allow-list said
`api.canva.com`, and Adminium would have POSTed a client secret and an
authorization code to a host the operator never consented to. That is closed
here, and the exchange goes through the same guarded client an add-on's own
calls use, so there is one allow-list enforced in one place. It is re-checked on
refresh, not only at connect.

**Completion is a POST, not a GET callback.** The provider redirects the browser
to a dashboard page, which reads the query and posts it. That keeps the
side-effecting route a POST — carrying CSRF protection, the audit marker and
rate limiting — rather than a GET that mutates, which this server's route
ratchets would not even see.

The pending flow lives in memory, mirroring `bridge/store.ts`: single-use so a
replayed code is inert, short-lived, bounded so looping on start cannot grow the
heap, and never on disk, because the verifier and the client secret are live
credentials for the ninety seconds someone spends on a consent screen. The
limitation is stated rather than left to be discovered: a multi-process
deployment can land the completion on a process that did not start the flow.

Two smaller decisions worth naming. A refresh response that omits
`refresh_token` means *keep the one you have* — dropping it there would silently
make the grant one-shot. And the token endpoint's error body is never echoed
into an error message: an OAuth error routinely reflects the parameters it was
sent, which here includes a client secret, and that message reaches an
operator's screen and the log. What an add-on can see of an OAuth credential is
the access token and nothing else — not the client secret, and not the refresh
token, which is the long-lived half a compromised add-on could use to mint
access tokens after being disconnected.
