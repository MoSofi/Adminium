/*
 * The customer side of __NAME__.
 *
 * It is public: nobody is signed in. Adminium serves it a browser key, and
 * with that key it reaches the public API — and there ONLY what
 * manifest/access.json grants. A table that is not listed there cannot be
 * read from this code, whatever it tries. Write access.json first, run
 * `adminium app check` to read back what it grants, then write the screen.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPublicClient, type Row } from '@adminiumjs/public-client';
import { en, useCustomer, type CustomerConfig } from '@adminiumjs/adminium/side';

/** The table's short name: the `ref` of manifest/tables/items.json. */
const ITEMS = 'items';

export function App() {
  const loaded = useCustomer();
  if (loaded.state === 'loading') return <p className="note">{en('Loading…')}</p>;
  if (loaded.state === 'error') return <p className="note error">{loaded.message}</p>;
  return <Items config={loaded.value} />;
}

function Items({ config }: { config: CustomerConfig }) {
  const client = useMemo(() => createPublicClient({ baseUrl: config.baseUrl, publishableKey: config.publishableKey }), [config]);
  // The name the table's public endpoint goes by on this install.
  const items = config.tables[ITEMS] ?? ITEMS;
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await client.list(items, { order: 'id.desc', limit: 20 })).data);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [client, items]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    try {
      await client.create(items, { title: title.trim() });
      setTitle('');
      setSent(true);
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main>
      <h1>{config.appName ?? en('__NAME__')}</h1>
      {problem === null ? null : <p className="note error">{problem}</p>}

      <form onSubmit={send}>
        <label htmlFor="title">{en('What do you need?')}</label>
        <input id="title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit">{en('Send')}</button>
      </form>
      {sent ? <p className="note">{en('Sent. Thank you.')}</p> : null}

      <ul>
        {rows.map((row) => (
          <li key={String(row['id'])}>
            <span className={row['status'] === 'done' ? 'done' : undefined}>{String(row['title'] ?? '')}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
