<!-- produced from apps/docs/src/content/docs/projects/folder.md § `package.json`; do not edit -->

# The project folder: `package.json`

```json
{
  "scripts": {
    "dev": "adminium dev",
    "build": "adminium build",
    "start": "adminium start",
    "check": "adminium check",
    "pull": "adminium pull"
  },
  "dependencies": { "@adminiumjs/adminium": "0.3.17" },
  "devDependencies": { "esbuild": "^0.28.0", "@types/react": "^19.2.0" }
}
```

| Command | |
|---|---|
| `npm run dev` | Run it, with the folder and Studio in step |
| `npm run build` | Compile the config and your code into `.adminium/build/` |
| `npm start` | Run the build, the way a server does |
| `npm run check` | [Check](https://docs.adminium.dev/projects/pull-and-check/#check) the project without starting it |
| `npm run pull` | [Write pages](https://docs.adminium.dev/projects/pull-and-check/) into the folder |

The Adminium version is **exact**, not a range, so the project moves to a new
release only when you say so — see
[upgrading](https://docs.adminium.dev/projects/deploy/#upgrading-adminium). `esbuild` builds your config
and code; `@types/react` is only for your editor, because your pages render with
the dashboard's own React.
