/*
 * The staff side of __NAME__.
 *
 * It runs inside Adminium, as the person who is signed in: `useStaff()` gives
 * a session that reads and writes the app's tables with that person's own
 * permissions. There is no key and no second sign-in.
 *
 * Open it with `?demo` in the address (or straight from the file) to see it
 * on the sample rows in seeds/sample.json, held in memory, with no Adminium.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { en, sampleRows, useStaff, type Row, type StaffSession } from '@adminiumjs/adminium/side';

import sample from '../../seeds/sample.json';

/** The table's short name: the `ref` of manifest/tables/items.json. */
const ITEMS = 'items';

export function App() {
  const loaded = useStaff({ demo: sampleRows(sample) });
  if (loaded.state === 'loading') return <p className="note">{en('Loading…')}</p>;
  if (loaded.state === 'error') return <p className="note error">{loaded.message}</p>;
  return <Items staff={loaded.value} />;
}

function Items({ staff }: { staff: StaffSession }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await staff.list(ITEMS, { order: 'id.desc' })).rows);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [staff]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    try {
      await staff.create(ITEMS, { title: title.trim() });
      setTitle('');
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  async function setStatus(row: Row, status: string) {
    try {
      await staff.update(ITEMS, row['id'] as number, { status });
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main>
      <header>
        <h1>{staff.appName ?? en('__NAME__')}</h1>
        {staff.mode === 'demo' ? <p className="note">{en('Sample data. Nothing here is saved.')}</p> : null}
        {staff.timezoneIsFallback && staff.mode === 'hosted' ? (
          <p className="note">{en('This database has no time zone set, so times are shown in UTC.')}</p>
        ) : null}
      </header>

      {problem === null ? null : <p className="note error">{problem}</p>}

      {staff.can(ITEMS, 'create') ? (
        <form onSubmit={add}>
          <label htmlFor="title">{en('New item')}</label>
          <input id="title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          <button type="submit">{en('Add')}</button>
        </form>
      ) : null}

      <ul>
        {rows.map((row) => (
          <li key={String(row['id'])}>
            <span className={row['status'] === 'done' ? 'done' : undefined}>{String(row['title'] ?? '')}</span>
            {staff.can(ITEMS, 'update') ? (
              <button type="button" onClick={() => void setStatus(row, row['status'] === 'done' ? 'open' : 'done')}>
                {row['status'] === 'done' ? en('Reopen') : en('Done')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="note">{en('Nothing here yet.')}</p> : null}
    </main>
  );
}
