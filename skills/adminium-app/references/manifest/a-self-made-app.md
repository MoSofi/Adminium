<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app; do not edit -->

# Manifest spec: A self-made app

An app whose publisher is `local` was made on an Adminium: in [a project folder](https://docs.adminium.dev/projects/apps/),
or saved from a database with [Save as app](https://docs.adminium.dev/guides/your-own-apps/save-as-app/). Such a file may
carry fields no released app does, because it describes a dashboard a person built by hand. Each is
refused in a manifest from any other publisher, and each needs Adminium 0.3.49, so the file sets
`compatibility.minAdminiumVersion` to at least `0.3.49` (Save as app does it for you).
