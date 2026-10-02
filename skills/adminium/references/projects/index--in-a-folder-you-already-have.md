<!-- produced from apps/docs/src/content/docs/projects/index.md § In a folder you already have; do not edit -->

# Create a project: In a folder you already have

Run `new` with no name and the current folder becomes the project:

```bash
cd my-app
npx @adminiumjs/adminium new
```

It changes nothing that is already there. Missing files are added, and

- `package.json` keeps every value it has; Adminium's dependency and its
  `dev`, `build`, `start`, `check` and `pull` scripts are added. A script name
  you already use is kept, and Adminium's goes in as `adminium:dev` and so on.
- `.gitignore` gets the lines it is missing, appended.
- `.env` is created if it is missing. If it exists, only missing keys are
  added, and `ADMINIUM_SECRET` is never touched.

It asks first when the folder is not empty, and refuses your home folder, the
filesystem root, and a folder that is already a project.
