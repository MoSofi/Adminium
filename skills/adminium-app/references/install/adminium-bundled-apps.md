<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § `ADMINIUM_BUNDLED_APPS`; do not edit -->

# Installing apps: `ADMINIUM_BUNDLED_APPS`

Where the boot seed looks for the bundled set. Default: `./apps-bundle`, relative to the server's
working directory. The published Docker image has no such folder. Its working directory is `/app`,
so an image you build from it can add `/app/apps-bundle` and needs nothing set:

```dockerfile
FROM ghcr.io/mosofi/adminium:<version>
COPY apps-bundle/ /app/apps-bundle/
```

Each app is a `<key>-<version>.tgz` next to a `<key>-<version>.tgz.integrity` file holding its
`sha512-…` fingerprint, the one shown beside its Download link. Every file is checked against its
fingerprint at boot, and a version already in the store is skipped. Put in the exact version you
install: a version the image does not carry is lost again at the next deploy on a host with no
persistent disk. See [Environment variables](https://docs.adminium.dev/self-hosting/env-vars/#adminium_bundled_apps).
