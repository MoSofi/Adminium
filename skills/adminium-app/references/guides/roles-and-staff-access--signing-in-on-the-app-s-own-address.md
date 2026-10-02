<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Signing in on the app's own address; do not edit -->

# App roles and staff access: Signing in on the app's own address

On `/apps/<key>/staff/`, someone who is not signed in is sent to the dashboard's sign-in page and
returned to the app afterwards.

On a domain attached to the staff side, the sign-in page belongs to the business instead:

- the header shows the first letter and name of the workspace (or the app's name while the
  workspace still has the default name), and "*app* · Staff sign-in";
- the footer reads "Shared tablet? Everyone signs in with their own account.";
- the form has a **Keep me signed in on this tablet** box;
- after a successful sign-in, including two-factor, the page shows **Opening** *app*… and
  "Signed in as *name*" while the app loads.

Staff sign in once per domain, because a session belongs to the address it was made on. See
[An app surface on its own domain](https://docs.adminium.dev/self-hosting/app-domains/#what-a-mapped-staff-domain-does-about-sign-in).

> **Note: What the tablet box changes**
> **Keep me signed in on this tablet** starts ticked. Ticked, the session survives closing the
> browser. Unticked, the browser forgets the session when it closes, which suits a tablet that
> several people share. The box does the same thing as **Keep me signed in** on the dashboard's own
> sign-in page, and it applies to a two-factor sign-in as well.
>
> Either way, the session ends after 7 days without use or at the workspace's session limit, whichever
> comes first. A browser that reopens its last tabs may bring back an unticked session too, so on a
> shared tablet **Sign out** is still the reliable way to end one.
