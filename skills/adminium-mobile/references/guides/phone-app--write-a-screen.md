<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md § Write a screen; do not edit -->

# A phone app for an app: Write a screen

A screen is a React Native component. `src/adminium.ts` gives it the connection:

```tsx
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { Row } from '@adminiumjs/public-client';

import { en, tableName, useAdminium, type Connection } from './src/adminium';

export function App() {
  const loaded = useAdminium(); // { state: 'loading' | 'error' | 'ready', value }
  if (loaded.state !== 'ready') return <Text>{loaded.state === 'error' ? loaded.message : en('Loading…')}</Text>;
  return <Menu connection={loaded.value} />;
}

function Menu({ connection }: { connection: Connection }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void connection.client.list(tableName(connection, 'dishes'), { limit: 50 }).then((listed) => setRows(listed.data));
  }, [connection]);
  return <FlatList data={rows} keyExtractor={(row) => String(row['id'])} renderItem={({ item }) => <View><Text>{String(item['name'])}</Text></View>} />;
}
```

- `connection.client` is the [public client](https://docs.adminium.dev/guides/apps/building-a-side/): `list`, `get`,
  `create`, `update`, `claim`. `tableName` turns a table's short name into the name its public
  endpoints go by on this install.
- There is no HTML and no CSS file: parts come from `react-native`, every piece of text is inside
  `<Text>`, and styles are objects (`StyleSheet.create`). A phone has no address bar: which screen
  shows is a state.
- A customer who signs in does it with a [claim](https://docs.adminium.dev/guides/apps/identity-and-own-links/):
  `client.claim({ … })`, and a code sent by email with `requestCode` and `verifyCode`. A sign-in
  **link** opens in a web page and is refused for a phone app. The session is kept in the phone's
  secure store.
- A phone has no `crypto`, no `Worker` and no `localStorage`. `src/adminium.ts` stands in for the
  first; the public client does without the second.
