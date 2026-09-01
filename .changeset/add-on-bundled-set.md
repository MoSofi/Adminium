---
'@adminium/server': patch
'@adminium/desktop': patch
'@adminium/docs': patch
---

The ghcr image and the desktop build now carry the six first-party add-ons as
a pre-verified bundled set.

The boot seed (32 D3) has existed since the store landed, but nothing ever put
a bundle where it looks — every image and installer shipped an empty Add-ons
page and called the air-gap story done. Now a release script
(`scripts/release/fetch-add-ons-bundle.mjs`) downloads the six tarballs at
build time against exact version + sha512 pins
(`scripts/release/add-ons-bundle.json`, copied from the release ledger — never
`latest`, no redirects, timing-safe digest comparison, refusal on any
unpinnable entry), and writes the flat
`<key>-<version>.tgz` + `.tgz.integrity` layout the seed reads. The Docker
build parks it at `/app/add-ons-bundle`, which the runtime stage's CWD makes
the server's own default; desktop-release.yml parks it in
`resources/add-ons-bundle` next to the demo seed.

The desktop shell now closes the loop in both directions: `buildServerEnv`
points `ADMINIUM_BUNDLED_ADD_ONS` at the packaged directory (only when it
actually exists — dev checkouts ship no bundle), and the variable joins
`STRIPPED_INHERITED_ENV_KEYS`, because it names a directory the server installs
packages FROM, hashes and all — an inherited value was a whole package set
chosen by whoever can set an environment variable.

Seeding stays copy-if-absent with every hash re-verified on the way in, so the
build-time verification is the first check, not the only one. A new
self-hosting docs page (Installing add-ons) states the rest of the story
plainly: the bundled set browses with zero network, the online catalog is a
default-off opt-in that contacts exactly two hosts and discloses the
deployment's IP and exact package@version to npm, and air-gapped installs
sideload with a hash from the release ledger.
