<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md § The folder; do not edit -->

# A phone app for an app: The folder

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
