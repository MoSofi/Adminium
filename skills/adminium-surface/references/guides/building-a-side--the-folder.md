<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § The folder; do not edit -->

# Building an app's screens: The folder

```
apps/repairs/
├── manifest/app.json           "frontends": [{ "side": "staff", "kind": "spa" }, …]
├── staff/
│   ├── src/main.tsx            where the side starts
│   ├── src/App.tsx             your screens
│   ├── src/app.css             imported from main.tsx
│   ├── nav.json                its screens, for the dashboard's sidebar (optional)
│   └── public/                 files served as they are (optional)
└── customer/
    └── src/main.tsx
```

`main.tsx` mounts the app on the page's `root` element:

```tsx
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(<App />);
```

Everything `main.tsx` imports is bundled: your components, CSS, and images and fonts imported by
address (`import logo from './logo.svg'`). The page itself is written by the build. There is no
`index.html` to edit.
