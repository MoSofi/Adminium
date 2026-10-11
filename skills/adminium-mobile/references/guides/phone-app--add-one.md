<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md § Add one; do not edit -->

# A phone app for an app: Add one

In the Designer, pick **Mobile** in the "what to build" menu, or ask for a phone app. On a
terminal:

```bash
npx @adminiumjs/adminium app new orders --mobile
```

Either way a person is asked first, once: a phone side installs Expo's packages (about 350 MB,
about a minute, from npm) into `apps/<key>/mobile/node_modules`, and Expo's build runs the code of
those packages on your computer. Typing `--mobile` is that yes. In the Designer it is a question in
the chat, or the button on the Phone tab.

The yes is kept for the phone app's package list and settings **as they read then**
(`package.json`, its lock file, `app.json`, `index.ts`, `tsconfig.json`). Change one of them and
you are asked again. For a phone side that came from somewhere else (a folder someone sent you):

```bash
npx @adminiumjs/adminium app approve-build orders
```

It shows what will run, asks, and installs the packages. On a terminal the yes is kept in the
project (`.adminium/approved-builds.json`); in the desktop app it is kept per computer, so a
folder never arrives approved.
