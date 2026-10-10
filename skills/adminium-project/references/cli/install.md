<!-- produced from apps/docs/src/content/docs/reference/cli.md § `install`; do not edit -->

# CLI reference: `install`

```
adminium install [--check] [--update]
```

Installs the packages the project in this folder lists: from `package-lock.json` when there is
one (`npm ci`), else a plain install, and never a package's own install scripts. When it
finishes it writes `node_modules/.adminium-install.json`, which says what was installed and for
which kind of computer.

`--check` installs nothing. It says whether an install is needed and why (nothing installed, an
install that did not finish, packages installed on another kind of computer, or a list of
packages that changed since), and exits `0` when everything is in place and `3` when it is not.

`--update` first sets the project's own Adminium packages (`@adminiumjs/adminium` and
`@adminiumjs/public-client`) to the version of the Adminium that runs the command, then installs.
Use it after you update Adminium, so that the project's code and the server agree.

You rarely run this yourself: on a terminal, your package manager does the same job. The
Adminium desktop app runs it before it opens a project.
