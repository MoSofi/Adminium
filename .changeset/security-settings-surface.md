---
'@adminium/i18n': patch
---

Give `GET|PUT /settings/security` a screen, and stop the 2FA switch overpromising.

The three enforced `auth.*` knobs — `sessionTtlHours`, `require2fa`,
`passwordMinLength` — had a route, a Zod schema, an RBAC gate and a full set of
translated strings in all 8 locales, and no way to reach any of it short of
curl. `settingsHub.security.*` had sat unused in `common.json` since M5, and
the page's own test asserted the absence with a rationale ("no auth flow
enforces them yet") that stopped being true when enforcement landed.

Settings → Security is now a second card on the workspace settings form. It is
the same form, deliberately: one Save button, one review-then-confirm modal
listing the changed fields, and two independent section-puts underneath. Two
save buttons on one screen is how half a settings change gets shipped.

`auth.allowSignup` is still not surfaced — the route does not accept it, so a
fourth control would save nothing. Its strings stay unused, as they were.

The honesty problem, and what was done about it. The only existing description
of the toggle was "Every member must enable 2FA to sign in." That is false.
`auth.require2fa` is advisory: it flags un-enrolled accounts with
`twoFactorSetupRequired` and refuses `POST /auth/2fa/disable`, and that is all
it does. No preHandler blocks an un-enrolled principal, and API-key principals
are outside the question structurally, because `plugins/auth.ts` resolves a
bearer key and returns before a session exists. So one new key —
`settingsHub.security.require2fa.note` — states the boundary next to the switch
that throws it, in the same words as the `auth.require2fa` docblock in the
settings registry:

    Advisory, not a barrier: members without 2FA are sent to set it up and can
    no longer turn it off, but their sign-in is never blocked, and API keys are
    unaffected.

The existing `desc` is left alone. Rewording it costs 8 locales and buys
nothing once the boundary is stated beside it.

The two numbers are held as typed text rather than as `number` state, because
`number` cannot express "momentarily empty while being retyped" — clearing 720
to type 24 would otherwise snap the field to 0. Both mirror the route's bounds
client-side, so an out-of-range value is refused on the field instead of coming
back as a 422 over a save that also carried a logo.
