<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § What a served screen may not load; do not edit -->

# Building an app's screens: What a served screen may not load

Adminium serves a side under its own content policy, so a screen may load only from the address
it came from:

- **No script, stylesheet or font from another host.** Bundle them: install the package and import
  it, or put the file in the side's folder.
- **No inline script.** The build writes none, and one added by hand would not run.
- **No request to another host.** A side cannot call a third-party API from the browser.
- **Pictures** from the same address, or from a host the operator has listed in
  [`ADMINIUM_CSP_IMG_HOSTS`](https://docs.adminium.dev/self-hosting/env-vars/).
