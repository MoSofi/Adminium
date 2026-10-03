<!-- produced from apps/docs/src/content/docs/reference/cli.md § `app approve-build`; do not edit -->

# CLI reference: `app approve-build`

```
adminium app approve-build [key] [--yes]
```

For an app that builds its screens with a command of its own (a copy the Designer made with
**Make it yours**): shows the two commands in `apps/<key>/build.json`, the install and the build,
and asks whether they may run. They run in the app's folder, as you, whenever the project is built.
Until they are approved the app is listed with that as its problem and is not built.

The approval is of their exact words, kept in `.adminium/approved-builds.json`. Change a character
of `build.json` and it has to be given again. `--yes` approves without asking, for a script that has
shown the commands another way.
