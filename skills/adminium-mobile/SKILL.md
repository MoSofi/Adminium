---
name: adminium-mobile
description: Build the phone app of an Adminium app — a React Native (Expo) app for customers that uses the public API with the app's own key. Use when someone wants a phone app, a mobile app, an iOS or Android app for an Adminium app. Open `adminium` and `adminium-app` first; the phone app sits on the app's manifest and its public access.
license: AGPL-3.0-only
---

# A phone app for an Adminium app

The phone side is an Expo project in `apps/<key>/mobile/`. It is for **customers**: nobody is
signed in as staff, and it reaches only what `manifest/access.json` grants, through the public
API. It is not a web side: it has no address, and Adminium serves it to nobody. What staff do,
they do in the dashboard.

Create it with **new** `--mobile`, or `add_side` with `"mobile"`. That writes the files, adds
`{ "side": "mobile", "kind": "expo" }` to `frontends`, and installs Expo's packages (about
350 MB) once a person said yes. The app then needs this Adminium or newer.

## The files

| File | Whose |
|---|---|
| `mobile/App.tsx` | Yours: the first screen. Export `App` |
| `mobile/src/*.ts`, `*.tsx`, `*.json` | Yours: more screens and parts |
| `mobile/assets/*` | Yours: pictures |
| `mobile/src/adminium.ts` | Adminium's: how the app connects. Import from it, never change it |
| `mobile/package.json`, `app.json`, `index.ts`, `tsconfig.json` | Adminium's. Never write them |

Never add `babel.config.*`, `metro.config.*`, `app.config.*`, a `.env` or any dot file: Expo
would run them, and the check refuses the app.

## Connect, read and write

```tsx
import { en, tableName, useAdminium, type Connection } from './src/adminium';

export function App() {
  const loaded = useAdminium();          // { state: 'loading' | 'error' | 'ready', value }
  if (loaded.state !== 'ready') return <Text>{loaded.state === 'error' ? loaded.message : en('Loading…')}</Text>;
  return <Screens connection={loaded.value} />;
}
// connection.client is the public client; tableName gives a table's public name from its short one.
const rows = (await connection.client.list(tableName(connection, 'items'), { limit: 50 })).data;
await connection.client.create(tableName(connection, 'requests'), { message });
```

- A public list takes only `limit`, `offset` and `cursor`: sort and narrow in the screen.
- An error is a `PublicApiError` with a `code`. Say your own sentence to the customer; never
  show `error.message`.
- Wrap every word a customer reads in `en('…')`.
- A person seeing their own rows signs in with a **claim**: `await client.claim({ email, code })`
  answers `true` when the details match, then list the `…_claimed` table. For a mailed code:
  `client.requestCode({ purpose: 'verify' })`, then `client.verifyCode({ code })`. A sign-in
  **link** opens in a web page and is refused for a phone app. The session is kept in the
  phone's secure store by `adminium.ts`; `client.signOut()` ends it.

## React Native, not HTML

- Parts come from `react-native`: `View`, `Text`, `Pressable`, `TextInput`, `ScrollView`,
  `FlatList`, `Image`, `ActivityIndicator`, `SafeAreaView`, `Switch`, `Modal`. There is no
  `<div>`, `<button>`, `<a>`, `<form>` or `<input>`, and no CSS file or `className`.
- Every piece of text is inside `<Text>`.
- Styles are objects: `StyleSheet.create({ … })`, with `flex`, `gap`, `padding`, `fontSize`.
  Sizes are numbers, never `'12px'` or `rem`. Layout is flex, in a column unless
  `flexDirection: 'row'`.
- A screen is a component, and which one shows is a state (`useState<'list' | 'detail'>`).
  There is no address bar, `window.location`, `Link` or router.
- A press target is at least 44 high. Give `accessibilityRole` and `accessibilityLabel` to a
  `Pressable` that is not plain text.
- Call every hook at the top of its component, before any return.
- Long lists use `FlatList` with `keyExtractor`, never `rows.map` inside a `ScrollView`.

## What a phone does not have

`document`, `window`, `localStorage`, `fetch` with cookies, `crypto.subtle`, `Worker`, web
fonts and `<img>`. Use `Image` with `source={{ uri }}`; a table's picture needs `pictureUrl`
from `@adminiumjs/public-client`, as on a customer side. The phone app uses the packages it
came with (`react-native`, `expo-status-bar`, `expo-secure-store`, `expo-crypto`, the public
client): no other package is added to it here, and `request_package` is for the web sides. Do
without, and tell the person what was left out.

## Seeing it

**build** makes a preview for the web, shown in the Designer's Phone tab: the same code,
drawn by a browser, so close to the phone and not the phone. "Open on a phone" there gives a
code for Expo Go on a phone on the same network: that runs the real app against this
machine's data. The app's own key for a phone app is made when the app is applied, and is
never the browser's key.

## Finish

**check**, **build**, then **run**. The check reads back what customers may reach; the build
says the first error of the phone app in its own words. Fix it in `App.tsx` or `src/`.
