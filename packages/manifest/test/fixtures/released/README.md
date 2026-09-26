# Released manifests

Byte-exact copies of manifests (and sample bundles) that shipped, read from each
repository's release tag. `released-apps.test.ts` re-hashes every file listed in
`index.json`, so a hand edit fails; these files are never fixed to suit the
current validator — a release that no longer validates is a regression in this
repository, not in the fixture.

Each `index.json` entry names the repository, the tag, the commit the tag points
at, the path inside the repository (`source`), the file here (`file`) and its
sha256.

## Adding a release

From a clone of the released repository (never its working tree: read the tag):

```sh
git -C <clone> show <tag>:<source> > <file>
shasum -a 256 <file>
git -C <clone> rev-list -n1 <tag>
```

then add one line to `index.json`. A `*.manifest.json` file joins every check
for its kind (app or add-on); a `*.sample.json` file is checked against the
manifest fixture with the same name before `.sample.json`.
