---
'@adminium/meta': patch
---

Say what `auth.require2fa` actually does. It is advisory, and its name is not.

The setting reads as a perimeter — "Require TOTP for all users" — and the
registry entry that defines it said nothing more than that. Two things read the
flag in the entire product, both in `apps/server/src/routes/auth/handlers.ts`:

    needsTwoFactorSetup    -> twoFactorSetupRequired on the login reply
                              and on GET /auth/session
    disable2faHandler      -> ForbiddenError on POST /auth/2fa/disable

The first is a signal, not a denial, and that part is deliberate: `/auth/2fa/
enroll` and `/auth/2fa/activate` are both `requireAuth`, so refusing the session
would leave a user with no door to enroll through. The second stops an enrolled
account opting back out.

Nothing else reads it. No preHandler blocks an un-enrolled principal, so any
client that ignores the signal — anything that is not our own dashboard — keeps
a full session and can call every route without enrolling. Our dashboard is in
fact the only thing that would honour it, and today it does not: `twoFactorSetup
Required` appears nowhere in `apps/dashboard/src`. API-key principals are outside
the question structurally — `apps/server/src/plugins/auth.ts` resolves an
`Authorization: Bearer adm_…` key and returns before a session exists, so no
session-conditioned gate would reach them even if one were written.

The flag is also `portable`, which the entry did not mention and which has teeth:
`export/redaction.ts` derives the export allow-list from this registry, and the
import service replays settings through `settingsRepo.set`, so a bundle can land
`true` on an instance where nobody has TOTP enrolled. That is survivable only
because the flag is not a perimeter — everyone can still log in, so an admin
turns it back off at Settings → Security. Where no admin UI is reachable the
floor is SQL, because there is no `adminium settings` subcommand (the CLI has
eight commands and none of them writes a setting):

    DELETE FROM adminium_settings WHERE key = 'auth.require2fa';

Deleting the row is enough — `repos/settings.ts` `get()` returns the registry
default for a key with no row, and that default is `false`.

Documentation only. No behaviour changes, and enforcement is deliberately not
added here: a half-enforced control that reads as a perimeter is worse than one
documented as partial, and closing the gap is a decision with a blast radius
(every API client of an instance that has the flag on) rather than a patch.
