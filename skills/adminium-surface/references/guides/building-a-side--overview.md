<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md; do not edit -->

# Building an app's screens

An app can bring screens of its own beside its dashboard pages: a **staff side** for your team and
a **customer side** for the public. Each is a small React app in the app's folder, built by
[`adminium app build`](https://docs.adminium.dev/reference/cli/#app-build) and served by Adminium at
`/apps/<key>/staff/` and `/apps/<key>/customer/`. This page is about writing them.
[An app in your project](https://docs.adminium.dev/projects/apps/) covers the folder, the manifest and the commands.
