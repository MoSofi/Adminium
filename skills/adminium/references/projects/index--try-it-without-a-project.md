<!-- produced from apps/docs/src/content/docs/projects/index.md § Try it without a project; do not edit -->

# Create a project: Try it without a project

```bash
npx @adminiumjs/adminium try
```

`try` is the interactive setup wizard with no folder to create: it asks whether
to continue in your browser or in the terminal, walks through connecting a
database and generating the admin, and starts the server. Its data goes to
`~/.adminium`, unless you started it in a folder that is a project of some other
kind (one with a `package.json`, a `.git` or a compose file), where it uses
`./data` beside it. You can adopt either later with `new --import` above. `try`
needs an interactive terminal, and it refuses to run inside an Adminium
project — there, `npm run dev` is the command.
