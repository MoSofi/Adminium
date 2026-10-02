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
