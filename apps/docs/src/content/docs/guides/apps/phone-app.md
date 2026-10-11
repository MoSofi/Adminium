---
title: A phone app for an app
description: Give an app a phone side — a React Native (Expo) app for customers that uses the public API with a key of its own — and see it in the Designer's Phone tab and on a real phone.
---

An app can bring a **phone app** for its customers beside its dashboard pages and its web screens.
It is an [Expo](https://expo.dev) project (React Native) in the app's folder, at
`apps/<key>/mobile/`. Like a [customer side](/guides/apps/building-a-side/), it talks to the
[public API](/guides/apps/public-access/) and reaches only what the app's `manifest/access.json`
grants. Nobody is signed in as staff in it.

It is a side of the app, and it is not a web side:

- Adminium **builds it only as a preview**, in a project that is being designed or developed
  (`adminium design`, `adminium dev`). `adminium start`, a packed app and an installed app never
  serve it. A phone app is not a second website.
- The preview is the phone app drawn by a browser (Expo's export for the web): close to the
  phone, not the phone. **Open on a phone** runs the real app on a real phone.
- Shipping the app to a store is Expo's own work, outside Adminium. What Adminium gives a
  shipped phone app is its **app key** and the public API.

## Add one

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

It shows what will run, asks, and installs the packages. The packages are named by a version
from the npm registry and nothing else: a package given as an address, a git repository or a
file is refused, and so is a lock file that fetches from anywhere else. On a terminal the yes is kept in the
project (`.adminium/approved-builds.json`); in the desktop app it is kept per computer, so a
folder never arrives approved.

## The folder

```
apps/orders/
├── manifest/app.json           "frontends": [{ "side": "mobile", "kind": "expo" }]
├── manifest/access.json        what customers may reach: the phone app's whole reach
└── mobile/
    ├── App.tsx                 yours: the first screen
    ├── src/                    yours: more screens and parts (.ts, .tsx, .json)
    ├── assets/                 yours: pictures
    ├── src/adminium.ts         Adminium's: how the app connects
    ├── package.json            Adminium's
    ├── app.json                Adminium's
    ├── index.ts                Adminium's
    └── tsconfig.json           Adminium's
```

The files marked "Adminium's" are written with the side and are the same in every app. The check
refuses a phone side that holds anything Expo would run as configuration: `babel.config.*`,
`metro.config.*`, `app.config.*`, `.babelrc`, a `.env` or any other dot file, `scripts` in
`package.json`, a plugin in `app.json` that is a file. Those are how code gets run that nobody
said yes to.

An app with a phone side needs the Adminium that knows the side, or a newer one: adding one raises
`compatibility.minAdminiumVersion` in `app.json`.

## Write a screen

A screen is a React Native component. `src/adminium.ts` gives it the connection:

```tsx
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { Row } from '@adminiumjs/public-client';

import { en, tableName, useAdminium, type Connection } from './src/adminium';

export function App() {
  const loaded = useAdminium(); // { state: 'loading' | 'error' | 'ready', value }
  if (loaded.state !== 'ready') return <Text>{loaded.state === 'error' ? loaded.message : en('Loading…')}</Text>;
  return <Menu connection={loaded.value} />;
}

function Menu({ connection }: { connection: Connection }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void connection.client.list(tableName(connection, 'dishes'), { limit: 50 }).then((listed) => setRows(listed.data));
  }, [connection]);
  return <FlatList data={rows} keyExtractor={(row) => String(row['id'])} renderItem={({ item }) => <View><Text>{String(item['name'])}</Text></View>} />;
}
```

- `connection.client` is the [public client](/guides/apps/building-a-side/): `list`, `get`,
  `create`, `update`, `claim`. `tableName` turns a table's short name into the name its public
  endpoints go by on this install.
- There is no HTML and no CSS file: parts come from `react-native`, every piece of text is inside
  `<Text>`, and styles are objects (`StyleSheet.create`). A phone has no address bar: which screen
  shows is a state.
- A customer who signs in does it with a [claim](/guides/apps/identity-and-own-links/):
  `client.claim({ … })`, and a code sent by email with `requestCode` and `verifyCode`. A sign-in
  **link** opens in a web page and is refused for a phone app. The session is kept in the phone's
  secure store.
- A phone has no `crypto`, no `Worker` and no `localStorage`. `src/adminium.ts` stands in for the
  first; the public client does without the second.

## See it

**In the Designer**, the preview has a **Phone app** side: the app in a phone's frame, reloaded
when it is built again. The Designer does not look at this side (it takes no picture of it), and
its style menu is for the web screens.

**On a real phone**, press **Open on a phone** under the frame. It shows a code. A phone with
[Expo Go](https://expo.dev/go), on the same network as your computer, scans it and runs the real
app against your computer's data.

- Nothing is sent to anyone else: no tunnel, no account.
- The Designer itself stays on your computer. What is opened to the network is a door for the
  phone preview only, on the one address you pick: it passes the app's bundle, its pictures and
  the app's public API, and nothing else.
- Only the first phone to scan the code is let in. For another phone, stop and show a new code.
- It closes when you stop it, when the Designer stops, and after half an hour with no phone using
  it.
- The first time, your computer's firewall may ask whether to let it accept connections.
- Expo Go runs one version of Expo's SDK. The dialog names the one the phone app is written for;
  a phone with another one is told so by Expo Go.
- A network that keeps its devices apart (many guest networks) cannot work.

`adminium dev` builds the same preview at `/apps/<key>/mobile/`, on your computer's own names
only (`localhost`). When the phone app is not built (nobody said yes yet, its packages are
missing, or its code does not build), `adminium dev` says why on its own line, and the rest of
the app is served as it is. The code for a phone is in the Designer.

## The app key

A phone app is a program, not a web page: it sends no `Origin`. So an app with a phone side gets a
key of its own kind beside its customer key, an **app key** (`adm_app_…`):

- It is accepted with no `Origin`, and **refused from a browser** (any `Origin` or `Sec-Fetch-*`
  header). A key taken out of a phone app is useless in a web page.
- It reaches the tables the customer key reaches, with a visitor's limits and the human check.
  It is never a server key. Two things a page can do it cannot: a sign-in **link** (it opens in a
  web page) is refused for it, and it is not handed to a page that asks for the app's settings.
- It is made when the app is installed or applied, and only when the app grants public access. An
  update that adds a phone side asks for it like any new access. Revoke it in Studio → API keys
  and no update makes it again. It is a second key: revoking the website's key does not revoke it.
- Switching the app's customer side off stops the phone app too.

It does not make the public API safer against a program: a program can already send the header a
browser key asks for. It gives the phone app a key of its own, replaced without touching the
website.

In the Designer's "Open on a phone", the phone app is given the key and the address by itself. A
phone app you build for a store reads them from three values at build time:

| Value | What |
|---|---|
| `EXPO_PUBLIC_ADMINIUM_URL` | The address of the Adminium the app is installed on, as a phone reaches it |
| `EXPO_PUBLIC_ADMINIUM_KEY` | The app key: Studio → API keys → the app's "phone app" key → reveal |
| `EXPO_PUBLIC_ADMINIUM_TABLES` | Optional. A JSON object, short table name → public name, when the app's tables are not named `<key>_<table>` |

That server needs the public API on (`ADMINIUM_PUBLIC_API_ORIGINS`, for example `self`) and an
address a phone can reach over https.

## What it does not do yet

- The Designer adds no package to a phone side: it uses the ones it came with.
- An app whose only side is a phone app cannot be listed on the marketplace.
- Many phones behind one address (a mobile network) share that address's limits until they sign
  in.
- On plain http, a page of the same host can use an app key: serve Adminium over https.
- An older Adminium shown a project folder with a phone side says the manifest is not valid,
  rather than "needs a newer Adminium".
