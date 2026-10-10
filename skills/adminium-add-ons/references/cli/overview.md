<!-- produced from apps/docs/src/content/docs/reference/cli.md; do not edit -->

# CLI reference

```
adminium [command] [options]
```

Run with **no command** to create a project: it asks for a folder name and runs
[`new`](https://docs.adminium.dev/reference/cli/#new). Inside a project, it lists the project's commands instead. The
setup wizard that used to run here is now [`try`](https://docs.adminium.dev/reference/cli/#try).

On npm the CLI is published as **`@adminiumjs/adminium`** — the scoped name is
the only correct install spec (`npx @adminiumjs/adminium`); the binary it
installs is `adminium`. The unscoped npm name `adminium` is an unrelated
third-party package, so never run `npx adminium`.

On a server, add the version (`npx @adminiumjs/adminium@0.3.23 start`). Without
one, npx installs any newer release it finds, and with no terminal attached it
does so without asking. See
[A VPS without Docker](https://docs.adminium.dev/self-hosting/vps/) for a pinned install under systemd,
and [Deploy a project](https://docs.adminium.dev/projects/deploy/) when the server runs a project — a
project pins its version in `package.json` and does not have this problem.

You can also run the CLI from a
[source checkout](https://docs.adminium.dev/getting-started/quickstart/#run-from-a-source-checkout)
(`node apps/server/dist/cli/index.js`) or through the
[Docker image](https://docs.adminium.dev/getting-started/docker/), whose entrypoint is the same CLI.

CLI subcommands call the same services the Studio's HTTP routes call — one code
path, two front doors. A run created by `generate-prompt` is the same kind of row
the Studio creates; an introspection from the CLI is the same snapshot.
