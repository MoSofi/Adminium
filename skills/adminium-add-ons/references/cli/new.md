<!-- produced from apps/docs/src/content/docs/reference/cli.md § `new`; do not edit -->

# CLI reference: `new`

```
adminium new [name] [--database <url> | --sample | --import <folder>] [--yes]
```

Creates a [project](https://docs.adminium.dev/projects/): a folder you open, edit and commit. With a
name, it creates `<name>/`, which must not exist yet or must be empty. Without
one (or with `.`), the current folder becomes the project.

In the current folder nothing that exists is changed. Missing files are added,
`package.json` and `.gitignore` are added to, and when the folder already has
`dev`, `build`, `start` or `check` scripts, Adminium's go in as `adminium:dev`
and so on. It refuses your home folder, the filesystem root, and a folder that
is already a project.

It then writes `.env` with a new `ADMINIUM_SECRET`, starts a git repository,
installs the dependencies with the package manager that ran it, and prints what
to run next.

A folder whose `data/` already holds an Adminium instance keeps it, and
`--import` copies one in first (`~/.adminium` after [`try`](https://docs.adminium.dev/reference/cli/#try), for
example). Its secret is never replaced: `new` takes it from `.env` or the
environment, asks for it, or stops, and it checks that the secret opens the
instance's stored connection strings before changing anything. The instance's
connections become the project's databases: the oldest is `main`, the others
are named after their connection. `adminium.config.ts` lists them, each
reading its URL from `.env` (`DATABASE_URL`, then `<KEY>_DATABASE_URL`). Those
variables start empty, because the URLs stay stored, encrypted, in the
instance. Its pages and schema customizations are written to `pages/` and
`schema/`.

| Flag | Default | |
|---|---|---|
| `--database <url>` | asked, or none | The database the admin is built from, written to `.env` as `DATABASE_URL` |
| `--sample` | | Create a small demo company database (SQLite) and use it |
| `-y`, `--yes` | | Answer every question with its default |
| `--no-install` | | Do not install dependencies |
| `--no-git` | | Do not start a git repository |
| `--package-manager <name>` | the one running `new` | `npm`, `pnpm`, `yarn` or `bun` |
| `--import <folder>` | | Copy the instance in this data folder into the project first |
| `--adminium <spec>` | this version | Adminium to install: a version, or a tarball path |

`--database` and `--sample` are refused for an existing instance, which brings
its own databases.

The project gets:

| File | |
|---|---|
| `adminium.config.ts` | Which databases the admin is built from, and other settings |
| `.env`, `.env.example` | The secret and the database URLs. `.env` stays out of git. |
| `package.json` | `@adminiumjs/adminium` pinned to an exact version; `dev`, `build`, `start`, `check` and `pull` scripts; `esbuild`, which builds the project's code, and `@types/react`, for editors |
| `Dockerfile` | Builds the project on the official image, at the same version |
| `tsconfig.json`, `.gitignore`, `.dockerignore`, `README.md` | |

---
