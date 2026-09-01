---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The Studio add-ons page can now acquire an add-on, not just install one that is
already there.

Three things it could not do before, and each was missing for its own reason.

**A download is a job, and the page treated it as a request.** `POST
/add-ons/download` answers `{ jobId }` the moment the work is enqueued — the
bytes arrive later, on the worker, with its retries and its cancellation. The
page reported success on that reply, so an operator saw "done", refreshed, and
found nothing staged. It now follows the job to an actual terminal state and
shows what step it is on. A failure is reported as the failure it was, with the
server's own reason, rather than as a download that quietly did not happen.

**Sideload had no surface at all.** The route existed; nothing in the product
reached it, which left an air-gapped operator with a documented capability and
no way to use it. The form asks for the package, its key, its version and its
`sha512-…` integrity — and the hash is required rather than optional. That path
runs the identical verify-then-hardened-unpack a registry download runs, one
code path for bundled, npm and upload, so it needs the same thing a download
gets from the registry: a hash supplied by something other than the bytes being
checked. `npm pack --json` prints exactly that value, so the person doing the
sideloading can produce it without trusting this page. Computing it from the
uploaded file would have been verifying the bytes against themselves.

The key and version are asked for rather than read out of the tarball,
deliberately: the store's directory grammar is `<key>/<version>/`, and deriving
either from a filename an operator can rename is how a package ends up staged
under somebody else's name.

**The online-catalogue switch had no route to write to.** It is a
settings-registry boolean, and every other one lives under `/settings/*` — which
is gated on `settings.manage`. That is precisely the permission the add-on wave
spent a task un-reserving `manifests.manage` to avoid: a switch deciding whether
this deployment talks to a package registry is not the same authority as
renaming a workspace. So it is `PUT /api/v1/add-ons/catalog`, under the add-ons'
own permission, audited like everything else there.

The reply carries something the design did not anticipate. `ADMINIUM_NETWORK_FEATURES=off`
and desktop air-gap mode outrank the stored setting, so an operator can switch
browsing on and have it stay off. The route reports the **effective** state plus
whether an environment veto is overriding it, and the page says so in words — a
toggle that springs back with no explanation reads as a broken page rather than
as a policy.

The plan also asked for a cache invalidation hook here, on the pattern the
public-API gate uses. There is nothing to invalidate: the catalog client reads
the setting on every call and caches nothing. Building the hook would have been
a no-op with a name implying otherwise.

Fourteen new strings across all eight locales, German and French translated, the
rest drafted from English and marked for review the way the i18n gate expects.
