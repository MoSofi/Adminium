<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § Looking at a side without Adminium; do not edit -->

# Building an app's screens: Looking at a side without Adminium

Give `useStaff` sample rows and open the staff screen with `?demo` in its address. It then holds
those rows in memory and saves nothing. `sampleRows` works out the common sample directives (`@ref`,
`@ago`, `@in`, `@day`) near enough to look at a screen:

```tsx
import { sampleRows, useStaff } from '@adminiumjs/adminium/side';
import sample from '../../seeds/sample.json';

const loaded = useStaff({ demo: sampleRows(sample) });
```

To see a side with real data, run the project: under [`adminium dev`](https://docs.adminium.dev/projects/apps/#run-it-from-the-folder)
the app is installed from its folder, the side is built on every save and served at
`/apps/<key>/<side>/`, and an open screen reloads by itself when you save. A screen that wants to
keep its state instead calls `stopReloading()` and handles `onAppChanged(listener)` itself.
[`adminium app try`](https://docs.adminium.dev/reference/cli/#app-try) proves the app installs on a fresh Adminium, and
`adminium app pack` makes the file to install on another one.
