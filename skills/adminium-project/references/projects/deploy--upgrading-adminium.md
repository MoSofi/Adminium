<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Upgrading Adminium; do not edit -->

# Deploy a project: Upgrading Adminium

The version is pinned in two places, and they must agree:

```bash
npm install --save-exact @adminiumjs/adminium@0.3.17
# then change the Dockerfile's FROM tag to 0.3.17
npm run check                # this is what compares the two
npm run build
```

Meta-store migrations run when the new version starts and cannot be undone, so
back the meta store up first and read [Upgrading](https://docs.adminium.dev/self-hosting/upgrades/). A
build made by another Adminium version is refused: the deploy rebuilds it.

> **Note: These host recipes have not been tried on live accounts yet**
> They are written against each platform's documented settings and against the
> same manifests in [`deploy/`](https://github.com/MoSofi/Adminium/tree/main/deploy)
> that the published image uses. Docker and Compose, and the systemd setup above,
> are the paths that get exercised. If a platform needs something different,
> please [open an issue](https://github.com/MoSofi/Adminium/issues).
