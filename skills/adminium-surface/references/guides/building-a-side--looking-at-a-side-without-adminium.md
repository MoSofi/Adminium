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

To see a side with real data, install the app: [`adminium app try`](https://docs.adminium.dev/reference/cli/#app-try)
proves it installs and is served, and `adminium app pack` makes the file to install on your own
Adminium.
