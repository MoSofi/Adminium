<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § Every copy of the app; do not edit -->

# Building an app's screens: Every copy of the app

An app may be installed once on each database of a server: two shops, each with its own database
([An app on several databases](https://docs.adminium.dev/self-hosting/apps-per-database/)). The first copy's screens are at
`/apps/<key>/<side>/`. A later copy's are at `/apps/<key>/<slug>/<side>/`, where `<slug>` is a short
name made from its database's name (`/apps/maker/kiln/staff/`). On a domain mapped to the app, a
side is at `/`.

A side opens for a later copy only when its frontend says it can, with `"instances": true` in the
manifest's `frontends` (Adminium 0.3.49 and later):

```json
"frontends": [{ "side": "staff", "kind": "spa", "entry": "index.html", "instances": true }]
```

Before you set it, make sure the side works wherever it is served:

- **It finds its base.** The side module already does: `useStaff()` and `useCustomer()` read the
  config beside the page, and `<Link>`, `go()` and `pageHref()` add the side's base. A side that
  builds addresses itself takes the base from `mountBase()` in `@adminiumjs/adminium/side`, never
  from a fixed `/apps/<key>/<side>/`.
- **It names its copy.** Each copy's sides are served their own `surface-config.json`, in the side's
  base. It carries `installId` (the copy) and `slug` (its part of the address, `""` for the first
  copy). Send `installId` back as the `X-Adminium-Install` header on every call to a route under
  `/api/v1/apps/<key>/…` or `/api/v1/add-ons/<key>/…`, so the server acts on this copy and on this
  database's copy of each add-on. With several copies and no header, such a call is refused `409`
  `APP_INSTALL_AMBIGUOUS`.

```ts
import { mountBase } from '@adminiumjs/adminium/side';

const base = mountBase(); // '/apps/maker/kiln/staff/' on a later copy
const config = await (await fetch(`${base}surface-config.json`, { credentials: 'same-origin' })).json();
const install: Record<string, string> = config.installId ? { 'x-adminium-install': config.installId } : {};

await fetch('/api/v1/apps/maker/rules', { credentials: 'same-origin', headers: { ...install } });
```

The rows a staff session reads and writes need nothing more: its calls name the copy's database
already. A customer side needs nothing more either: the key its config hands it belongs to one
copy. A config from a server older than per-database installs carries no `installId`; send no
header then.
