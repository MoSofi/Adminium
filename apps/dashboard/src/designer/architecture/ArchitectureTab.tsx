// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Architecture tab: how the app fits together, read only, drawn from
 * what the engine applied. Changes in the folder that are not applied yet are
 * named in a banner and marked on their nodes. The diagram has a list form
 * for anyone who would rather read it; selecting a node (in either) names its
 * lines and opens it in the dashboard. Below, seven lists: tables, pages,
 * roles, customer access, emails, add-ons and the sides' screens — tabs on a
 * wide screen, one under the other on a phone.
 *
 * Loaded on its own: the diagram library is not part of the page until this
 * tab opens.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleDot, Lock, Minus, SquareArrowOutUpRight, X } from 'lucide-react';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { architectureQuery, type ArchitectureDoc, type DesignerSession } from '../api.js';
import { Diagram } from './Diagram.js';
import { builtInLabel, builtInPath, kindLabel, nodeLabel, useLabel } from './words.js';

type ListKey = 'tables' | 'pages' | 'roles' | 'access' | 'emails' | 'addOns' | 'screens';

function number(value: number): string {
  return new Intl.NumberFormat(getI18nInstance()?.language ?? 'en-US').format(value);
}

/** Every node's name, by id. */
function namesOf(doc: ArchitectureDoc): Map<string, string> {
  const names = new Map<string, string>();
  for (const person of doc.people) names.set(person.id, nodeLabel(person));
  for (const use of doc.uses) names.set(use.id, useLabel(use.id));
  for (const table of doc.tables) names.set(table.id, table.ref);
  for (const addOn of doc.addOns) names.set(addOn.id, addOn.name);
  for (const email of doc.emails) names.set(email.id, email.name);
  for (const tile of doc.builtIn) names.set(`b_${tile}`, builtInLabel(tile));
  return names;
}

/** Where a node opens in the dashboard, when it has a page there. */
function openPath(doc: ArchitectureDoc, id: string): string | null {
  if (id === 'dashboard') return '/';
  if (id.startsWith('b_')) return builtInPath(id.slice(2) as ArchitectureDoc['builtIn'][number]);
  if (id.startsWith('a_')) return '/studio/add-ons';
  if (id.startsWith('r_')) return '/settings/roles';
  if (id.startsWith('e_')) return '/automations';
  if (id.startsWith('t_')) {
    const page = doc.lists.pages.find((entry) => entry.shows.split(', ').includes(id.slice(2)));
    return page === undefined ? null : `/p/${page.ref}`;
  }
  return null;
}

function OpenLink({ path, label }: { path: string; label: string }): ReactNode {
  return (
    <a href={path} target="_blank" rel="noopener" aria-label={label} title={label} className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
      <SquareArrowOutUpRight aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
    </a>
  );
}

function Lists({ doc, phone, selected, onSelect }: { doc: ArchitectureDoc; phone: boolean; selected: string | null; onSelect: (id: string) => void }): ReactNode {
  const [tab, setTab] = useState<ListKey>('tables');
  const th = 'border-b border-border px-3 py-2 text-start text-[11.5px] font-bold uppercase tracking-wide text-fg-subtle';
  const td = 'border-b border-border px-3 py-2 align-top text-[13px] text-fg';
  const open = t('designer:arch.open', 'Open in the dashboard');
  const panels: { key: ListKey; title: string; count: number; body: ReactNode }[] = [
    {
      key: 'tables',
      title: t('designer:arch.tables', 'Tables'),
      count: doc.tables.length,
      body: (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('designer:arch.name', 'Name')}</th>
              <th className={th}>{t('designer:arch.rowsHead', 'Rows')}</th>
              <th className={th}>{t('designer:arch.columns', 'Columns')}</th>
              <th className={th}>{t('designer:arch.relatesTo', 'Relates to')}</th>
            </tr>
          </thead>
          <tbody>
            {doc.tables.map((table) => (
              <tr key={table.id} aria-selected={selected === table.id} className="aria-selected:bg-accent-soft">
                <td className={td}>
                  <button type="button" onClick={() => onSelect(table.id)} className="font-mono font-semibold text-accent hover:underline">
                    {table.ref}
                  </button>
                </td>
                <td className={`${td} font-mono`}>{table.rows === null ? '—' : number(table.rows)}</td>
                <td className={`${td} font-mono text-[12px] text-fg-muted`}>{table.columns.map((column) => column.name).join(', ')}</td>
                <td className={`${td} font-mono text-[12px]`}>{table.relations.map((relation) => relation.to).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      key: 'pages',
      title: t('designer:arch.pagesHead', 'Pages'),
      count: doc.lists.pages.length,
      body: (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('designer:arch.name', 'Name')}</th>
              <th className={th}>{t('designer:arch.kind', 'Kind')}</th>
              <th className={th}>{t('designer:arch.shows', 'Shows')}</th>
              <th className={th}>
                <span className="sr-only">{t('designer:arch.actions', 'Actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.lists.pages.map((page) => (
              <tr key={page.ref}>
                <td className={td}>{page.name}</td>
                <td className={`${td} font-mono text-[12px] text-fg-muted`}>{page.kind}</td>
                <td className={`${td} font-mono text-[12px]`}>{page.shows || '—'}</td>
                <td className={`${td} text-end`}>
                  <OpenLink path={`/p/${page.ref}`} label={open} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      key: 'roles',
      title: t('designer:arch.roles', 'Roles'),
      count: doc.lists.roles.rows.length,
      body: (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('designer:arch.role', 'Role')}</th>
              {doc.lists.roles.tables.map((table) => (
                <th key={table} className={`${th} font-mono normal-case`}>
                  {table}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.lists.roles.rows.map((row) => (
              <tr key={row.id}>
                <td className={`${td} font-semibold`}>{row.role}</td>
                {row.cells.map((cell, index) => (
                  <td key={doc.lists.roles.tables[index]} className={td}>
                    <span className="inline-flex items-center gap-1.5">
                      {cell === 'none' ? <Minus aria-hidden="true" className="size-3.5 text-fg-subtle" /> : <Check aria-hidden="true" className="size-3.5 text-pos" />}
                      {cell === 'write' ? t('designer:arch.readWrite', 'Read and write') : cell === 'read' ? t('designer:arch.read', 'Read') : <span className="sr-only">{t('designer:arch.noAccess', 'No access')}</span>}
                    </span>
                    {row.notes[index] === null || row.notes[index] === undefined ? null : <span className="ms-1 text-[12px] text-fg-muted">({row.notes[index]})</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      key: 'access',
      title: t('designer:arch.access', 'Customer access'),
      count: doc.lists.access.length,
      body:
        doc.lists.access.length === 0 ? (
          <p className="m-0 px-3 py-3 text-[13px] text-fg-muted">{t('designer:arch.noCustomerSide', 'This app has no customer side.')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-3">
            {doc.lists.access.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[13px] text-fg">
                <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                <span dir="auto">{line}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'emails',
      title: t('designer:arch.emails', 'Emails'),
      count: doc.emails.length,
      body: (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('designer:arch.name', 'Name')}</th>
              <th className={th}>{t('designer:arch.sentWhen', 'Sent when')}</th>
            </tr>
          </thead>
          <tbody>
            {doc.emails.map((email) => (
              <tr key={email.id}>
                <td className={td}>{email.name}</td>
                <td className={`${td} text-fg-muted`} dir="auto">
                  {email.when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      key: 'addOns',
      title: t('designer:arch.addOns', 'Add-ons'),
      count: doc.addOns.length,
      body: (
        <ul className="m-0 flex list-none flex-col p-0">
          {doc.addOns.map((addOn) => (
            <li key={addOn.id} className="flex flex-wrap items-center gap-2.5 border-b border-border px-3 py-2.5">
              <span className="text-[13px] font-bold text-fg">{addOn.name}</span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-bold text-fg-muted">{addOn.need === 'required' ? t('designer:arch.required', 'Required') : t('designer:arch.suggested', 'Suggested')}</span>
              <span className="text-[12px] text-fg-muted">
                {addOn.state === 'installed' ? t('designer:arch.installed', 'Installed {version}', { version: addOn.version ?? '' }) : t('designer:arch.notInstalled', 'Not installed')}
              </span>
              {addOn.reason === '' ? null : (
                <span className="basis-full text-[12.5px] text-fg-muted" dir="auto">
                  {addOn.reason}
                </span>
              )}
              {addOn.state === 'installed' ? null : (
                <a href="/studio/add-ons" target="_blank" rel="noopener" className="ms-auto text-[12.5px] font-bold text-accent hover:underline">
                  {t('designer:arch.install', 'Install')}
                </a>
              )}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'screens',
      title: t('designer:arch.screensHead', 'Screens'),
      count: doc.lists.screens.length,
      body: (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('designer:arch.name', 'Name')}</th>
              <th className={th}>{t('designer:arch.side', 'Side')}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lists.screens.map((screen) => (
              <tr key={screen.id}>
                <td className={td}>
                  <button type="button" onClick={() => onSelect(screen.side)} className="text-start font-semibold text-accent hover:underline">
                    {screen.name}
                  </button>
                </td>
                <td className={`${td} text-fg-muted`}>{useLabel(screen.side)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
  ];

  if (phone) {
    return (
      <div className="flex flex-col gap-5">
        {panels.map((panel) => (
          <section key={panel.key} aria-labelledby={`designer-arch-${panel.key}`}>
            <h3 id={`designer-arch-${panel.key}`} className="m-0 mb-2 text-[13px] font-extrabold">
              {panel.title} <span className="font-mono text-fg-subtle">{panel.count}</span>
            </h3>
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">{panel.body}</div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ListKey)}>
      <TabsList className="nb-scroll overflow-x-auto">
        {panels.map((panel) => (
          <TabsTrigger key={panel.key} value={panel.key} count={panel.count} className="whitespace-nowrap">
            {panel.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {panels.map((panel) => (
        <TabsContent key={panel.key} value={panel.key} className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
          {panel.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The diagram as text: the same nodes, each with its lines, and the same selection. */
function Outline({ doc, selected, onSelect }: { doc: ArchitectureDoc; selected: string | null; onSelect: (id: string) => void }): ReactNode {
  const names = namesOf(doc);
  const groups: { title: string; ids: string[] }[] = [
    { title: t('designer:arch.people', 'People'), ids: doc.people.map((person) => person.id) },
    { title: t('designer:arch.uses', 'What they use'), ids: doc.uses.map((use) => use.id) },
    { title: t('designer:arch.appTables', '{name}’s tables', { name: doc.name }), ids: doc.tables.map((table) => table.id) },
    { title: t('designer:arch.emails', 'Emails'), ids: doc.emails.map((email) => email.id) },
    { title: t('designer:arch.addOns', 'Add-ons'), ids: doc.addOns.map((addOn) => addOn.id) },
    { title: t('designer:arch.comesWith', 'Comes with Adminium'), ids: doc.builtIn.map((tile) => `b_${tile}`) },
  ].filter((group) => group.ids.length > 0);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="m-0 mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-fg-subtle">{group.title}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {group.ids.map((id) => {
              const lines = doc.edges
                .filter((edge) => edge.from === id)
                .map((edge) => `${edge.does === 'posts' ? t('designer:arch.posts', 'Posts into') : edge.does === 'prices' ? t('designer:arch.prices', 'Priced by') : kindLabel(edge.kind)} ${names.get(edge.to) ?? edge.to}`);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={selected === id}
                    onClick={() => onSelect(id)}
                    className="flex w-full flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-start hover:bg-surface-2 aria-pressed:bg-accent-soft"
                  >
                    <span className="text-[13px] font-bold text-fg">{names.get(id) ?? id}</span>
                    {lines.length === 0 ? null : <span className="text-[12px] text-fg-muted">{lines.join(' · ')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function useNarrow(): boolean {
  const [narrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);
  return narrow;
}

export default function ArchitectureTab({ session }: { session: DesignerSession }): ReactNode {
  const architecture = useQuery(architectureQuery(session.id));
  const [selected, setSelected] = useState<string | null>(null);
  const [asList, setAsList] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const phone = useNarrow();
  const doc = architecture.data;
  const names = useMemo(() => (doc === undefined ? new Map<string, string>() : namesOf(doc)), [doc]);

  if (architecture.isPending) return <div aria-busy="true" className="m-auto size-5 animate-spin rounded-full border-2 border-border border-t-accent" />;
  if (doc === undefined) {
    return (
      <p role="alert" className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
        {t('designer:arch.failed', 'The architecture could not be read.')}
      </p>
    );
  }
  if (!doc.applied) {
    return <p className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">{t('designer:arch.notApplied', 'Nothing is applied yet. Once the Designer applies the app, it is drawn here.')}</p>;
  }

  const select = (id: string | null): void => setSelected((current) => (id === null || current === id ? null : id));
  const lines = selected === null ? [] : doc.edges.filter((edge) => edge.from === selected || edge.to === selected).map((edge) => (edge.from === selected ? edge.to : edge.from));
  const path = selected === null ? null : openPath(doc, selected);
  const hasCustomers = doc.people.some((person) => person.kind === 'customers');

  return (
    <div className="nb-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 max-sm:p-3">
      {doc.pending.length === 0 ? null : (
        <div className="rounded-xl border border-warn/40 bg-warn-soft">
          <div className="flex items-center gap-2.5 px-3.5 py-2">
            <CircleDot aria-hidden="true" className="size-4 shrink-0 text-warn" />
            <span className="flex-1 text-[13px] font-semibold text-fg">{t('designer:arch.pending', '{count, plural, one {# change is waiting to be applied} other {# changes are waiting to be applied}}', { count: doc.pending.length })}</span>
            <button type="button" aria-expanded={showPending} aria-controls="designer-arch-pending" onClick={() => setShowPending((value) => !value)} className="rounded-md px-2 py-1 text-[12.5px] font-bold text-fg hover:bg-surface">
              {showPending ? t('designer:arch.hide', 'Hide') : t('designer:arch.show', 'Show')}
            </button>
          </div>
          {showPending ? (
            <ul id="designer-arch-pending" className="m-0 flex list-none flex-wrap gap-2 border-t border-warn/30 px-3.5 py-2.5">
              {doc.pending.map((entry) => (
                <li key={entry.part}>
                  <button
                    type="button"
                    disabled={entry.node === null}
                    onClick={() => entry.node !== null && select(entry.node)}
                    className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-fg hover:border-accent disabled:cursor-default"
                  >
                    {entry.part}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <section aria-labelledby="designer-arch-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 id="designer-arch-title" className="m-0 me-auto text-[15px] font-extrabold tracking-tight">
            {t('designer:arch.title', 'How {name} fits together', { name: doc.name })}
          </h2>
          <ul aria-label={t('designer:arch.legend', 'Legend')} className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11.5px] text-fg-muted">
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0 w-5 border-t-2 border-fg-subtle" />
              {t('designer:arch.kindUses', 'Uses')}
            </li>
            {hasCustomers ? (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed border-fg-subtle" />
                {t('designer:arch.kindKey', 'Through a customer key')}
              </li>
            ) : null}
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="text-fg-subtle">→</span>
              {t('designer:arch.kindRelation', 'One to many')}
            </li>
            {doc.pending.length === 0 ? null : (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
                {t('designer:arch.notAppliedYet', 'Not applied yet')}
              </li>
            )}
          </ul>
          <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-fg-muted">
            {t('designer:arch.asList', 'Show as a list')}
            <Switch checked={asList} onCheckedChange={setAsList} />
          </label>
        </div>
        {asList ? <Outline doc={doc} selected={selected} onSelect={select} /> : <Diagram doc={doc} selected={selected} onSelect={select} />}
      </section>

      {selected === null ? null : (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5">
          <span className="text-[13.5px] font-extrabold">{names.get(selected) ?? selected}</span>
          {lines.length === 0 ? null : (
            <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
              {t('designer:arch.linesTo', 'Lines to')}
              {[...new Set(lines)].map((id) => (
                <button key={id} type="button" onClick={() => select(id)} className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold text-fg hover:border-accent">
                  {names.get(id) ?? id}
                </button>
              ))}
            </span>
          )}
          <span className="ms-auto flex items-center gap-1.5">
            {path === null ? null : (
              <a href={path} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12.5px] font-bold text-fg hover:bg-surface-2">
                <SquareArrowOutUpRight aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                {t('designer:arch.open', 'Open in the dashboard')}
              </a>
            )}
            <button type="button" onClick={() => setSelected(null)} aria-label={t('designer:arch.clear', 'Clear the selection')} className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2">
              <X aria-hidden="true" className="size-4" />
            </button>
          </span>
        </div>
      )}

      <Lists doc={doc} phone={phone} selected={selected} onSelect={(id) => select(id)} />
    </div>
  );
}
