# The verbs, as commands

Every Adminium skill names verbs. With a shell, they are these commands, run in the project folder
(the one holding `adminium.config.ts`). `<key>` may be left out when the project has one app.

| Verb | Command |
|---|---|
| version | `npx @adminiumjs/adminium --version` |
| new project | `npx @adminiumjs/adminium new <name> --yes` (add `--sample` for a sample database, `--no-git` inside another repository), then `cd <name>` |
| new | `npx @adminiumjs/adminium app new <key> [--name "<Name>"] [--staff] [--customer]` |
| check | `npx @adminiumjs/adminium app check <key>` |
| check, as data | `npx @adminiumjs/adminium app check <key> --json` |
| build | `npx @adminiumjs/adminium app build <key>` |
| run | `npx @adminiumjs/adminium dev --port <n> --host 127.0.0.1` (or `npm run dev -- --host 127.0.0.1`). Older versions listen on all addresses by default, and there the public API is not registered without `ADMINIUM_TRUST_PROXY`, so a customer screen loads nothing. It does not end: run it in the background, and to stop it kill the process that is listening on the port, then see that the port is free. It prints `Adminium is running at <address>`; the app's screens are at `<address>/apps/<key>/<side>/` |
| build the project | `npx @adminiumjs/adminium build` (what a deploy runs; it builds every app too) |
| try | `npx @adminiumjs/adminium app try <key>` (`--json` for data, `--keep` to keep its folder) |
| try, with add-ons | `npx @adminiumjs/adminium app try <key> --add-ons <folder>` |
| pack | `npx @adminiumjs/adminium app pack <key>` |
| split | `npx @adminiumjs/adminium app check <key> --split` (one `manifest.json` → part files) |
| check the project | `npx @adminiumjs/adminium check` |
| help | `npx @adminiumjs/adminium app <command> --help` |

`app try` is not `try`: plain `adminium try` is the setup wizard for running Adminium with no
project, and it waits for a person at a terminal. The app commands are documented in
`references/cli/app.md`.

Always write the package name in full, `@adminiumjs/adminium`. The bare name `adminium` on npm is
somebody else's package.

Exit codes: `0` passed, `2` the check or a try step failed (read the `✗` lines), `1` anything else.

In a tool without a shell, the same verbs are that tool's own actions with the same names.
