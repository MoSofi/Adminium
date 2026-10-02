<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § Looking at a side without Adminium; do not edit -->

# Building an app's screens: Looking at a side without Adminium

Give `useStaff` sample rows and open the built page with `?demo` in its address, or straight from
the file. It then holds those rows in memory and saves nothing:

```tsx
import { sampleRows, useStaff } from '@adminiumjs/adminium/side';
import sample from '../../seeds/sample.json';

const loaded = useStaff({ demo: sampleRows(sample) });
```

To see a side with real data, install the app: [`adminium app try`](https://docs.adminium.dev/reference/cli/#app-try)
proves it installs and is served, and `adminium app pack` makes the file to install on your own
Adminium.
