<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § `ADMINIUM_BUNDLED_ADD_ONS`; do not edit -->

# Installing add-ons: `ADMINIUM_BUNDLED_ADD_ONS`

Where the boot seed looks for the bundled set. Default: `./add-ons-bundle`,
relative to the server's working directory — which is where the Docker image
parks it, so a container needs nothing set. The desktop app sets the variable
itself, pointing at the copy inside its own resources.

Override it to seed from your own directory of pre-verified packages:

```bash
ADMINIUM_BUNDLED_ADD_ONS=/srv/adminium/add-ons-bundle adminium start
```

The layout is flat: `<key>-<version>.tgz` next to a `<key>-<version>.tgz.integrity`
sidecar holding the `sha512-…` string. A directory that does not exist is a
no-op, not an error. Every tarball is verified against its sidecar on the way
into the store — the variable chooses where the seed reads from, never whether
verification happens.

On a host with no persistent disk, this folder is the only place an add-on
outside the bundled set survives a deploy. The image's working directory is
`/app`, so an image you build from the published one can add files to the
folder it already has, with nothing to set:

```dockerfile
FROM ghcr.io/mosofi/adminium:<version>
COPY add-ons-bundle/ /app/add-ons-bundle/
```

Put in the exact version you install. A version the image does not carry is
lost again at the next deploy.
