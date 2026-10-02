<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Compatibility; do not edit -->

# Manifest spec: Compatibility

```json
"compatibility": {
  "minAdminiumVersion": "0.3.13",
  "engines": ["postgres", "mysql", "sqlite"],
  "requires": ["realtime"]
}
```

| Field | Required | Rule |
|---|---|---|
| `minAdminiumVersion` | yes | The oldest Adminium the package runs on. An install on an older server is refused. |
| `maxAdminiumVersion` | no | An exclusive upper bound. It must be greater than `minAdminiumVersion`. The installer does not enforce it in this release. |
| `engines` | no | The databases the package's tables work on: `postgres`, `mysql`, `sqlite`. At least one when present. Informational in this release. |
| `requires` | no | Capabilities the package cannot run without, from the same list as `capabilities`. Informational in this release. |
| `updatesFrom` | no | The installed versions this release can update in place, as a semver range (`>=0.2.0`, `^0.2.0`, `>=0.2.0 <1.0.0`, `^1.0.0 \|\| >=2.0.0`), up to 120 characters. Absent means any older version. |

Use `updatesFrom` when a release changes its tables in a way an update cannot carry. An install
outside the range is not offered the update, and an update or upload of it is refused with a
message telling the operator to uninstall the old version first. That is better than an update
that fails half-way.

Versions are compared on `major.minor.patch` only: a pre-release tag is ignored, so
`"minAdminiumVersion": "0.3.0-rc.4"` is met by any `0.3.0` build.

When a package starts using a field that an older Adminium does not know, raise
`minAdminiumVersion` to the release that reads it. An older server then tells the operator to
upgrade instead of reporting the manifest as invalid.
