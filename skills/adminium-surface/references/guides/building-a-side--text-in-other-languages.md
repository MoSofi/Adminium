<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § Text in other languages; do not edit -->

# Building an app's screens: Text in other languages

A new app is in English. Wrap text people read in `en()`:

```tsx
import { en } from '@adminiumjs/adminium/side';

<button>{en('Add')}</button>
```

`en()` returns the text unchanged. It is a mark, so that the day the app gains a second language
every string to translate is found by searching for `en(`.
