// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/documents` — the document MAPPINGS (34-invoices-add-on.md §3.7,
 * §7.8 as amended; 34-T14).
 *
 * ─── WHAT THIS PAGE IS, AFTER THE REDESIGN ─────────────────────────────────
 *
 * NOT the authoring surface. §7.8's own amendment moved that to `/invoices`,
 * which is where somebody writes a document; this page binds a KIND to a
 * TABLE — which columns fill which slots, what fires it, where it goes. That
 * split is also the right grant split: authoring is everyday operator work,
 * and a mapping decides what an add-on may read, which is
 * `system:manifests:manage`.
 *
 * ─── IT IS ABSENT WHEN NO PROVIDER IS INSTALLED (24 D6) ────────────────────
 *
 * Not empty — absent. A Studio page listing a feature the deployment does not
 * have is a page that exists to advertise, and 24 D6 is explicit that with the
 * add-on off there is no affordance at all.
 *
 * ─── EVERY LABEL BELONGS TO THE PROVIDER ───────────────────────────────────
 *
 * `kind.label`, `slot.label`, `slot.help` are eight-locale records the add-on
 * carries (D14). This page picks the viewer's locale out of them. There is no
 * invoice vocabulary anywhere in this file — a folio or certificate provider
 * drives the same page unchanged, which is the claim §7.5 makes about the
 * pipeline and this page has to keep true on screen.
 */

import { Alert, Button, Card, Input, Select, Spinner } from '@adminium/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { automationsApi } from '../../automations/api.js';
import { emailSendGate, useCapabilities } from '../../app/capabilities.js';
import { RenderForRow } from './RenderForRow.js';
import { getI18nInstance, t as studioT } from '../../i18n/t.js';
import {
  createProfile,
  deleteProfile,
  updateProfile,
  fetchKinds,
  fetchProfiles,
  pick,
  type DocumentKindOption,
  type DocumentProfile,
  type OutlineSlot,
} from './api.js';
import {
  columnsForSlot,
  fromMapping,
  mayTypeValue,
  rankChildTables,
  rankTables,
  tablesRead,
  toLiterals,
  toMapping,
  unboundRequiredSlots,
  unreadableTables,
  type Bindings,
  type ColumnFacts,
  type SlotBinding,
  type TableFacts,
} from './mapping.js';

const documentsKey = ['studio', 'documents'] as const;

/*
 * Option-value prefixes for the slot select. A column's name goes on the wire
 * as `column:<name>`, so no column can impersonate the "type a value" choice
 * however it is spelled.
 */
const COLUMN_OPTION = 'column:';
const TYPED_OPTION = 'typed';

/**
 * The viewer's language, for picking out of a provider's eight-locale records.
 *
 * From the i18n INSTANCE rather than from `t`: these labels are not keys in
 * any bundle — they belong to the add-on — so what is needed here is the tag,
 * not a lookup.
 */
function currentLocale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

export function DocumentProfilesPage() {
  const kinds = useQuery({ queryKey: [...documentsKey, 'kinds'], queryFn: fetchKinds });
  const profiles = useQuery({ queryKey: [...documentsKey, 'profiles'], queryFn: fetchProfiles });
  /*
   * `profile` present = revising a saved mapping, absent = making one. The
   * editor is the same form either way: §3.7 describes one shape, and a second
   * "edit" screen would be the place the two drift apart.
   */
  const [editing, setEditing] = useState<{
    kind: DocumentKindOption;
    profile?: DocumentProfile;
  } | null>(null);

  if (kinds.isPending) return <Spinner />;

  const available = kinds.data ?? [];
  if (available.length === 0) {
    /*
     * ABSENT, not empty (24 D6). This page has nothing to say on a deployment
     * with no provider installed, and saying it anyway would be advertising.
     */
    return (
      <Alert tone="info" title={studioT('studio:documents.title', 'Document mappings')}>
        {studioT(
          'studio:documents.noProvider',
          'No installed add-on can draw documents yet. Install one from Add-ons, and the mappings you can make will appear here.',
        )}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">
            {studioT('studio:documents.title', 'Document mappings')}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            {studioT(
              'studio:documents.intro',
              'A mapping says which columns of which table make one kind of document, what draws it, and where it goes.',
            )}
          </p>
        </div>
      </header>

      {editing === null ? (
        <>
          <ProfileList
            profiles={profiles.data ?? []}
            kinds={available}
            onEdit={(profile, kind) => setEditing({ kind, profile })}
          />
          <Card className="flex flex-wrap items-center gap-2 p-4">
            <span className="text-sm text-fg-muted">
              {studioT('studio:documents.newFrom', 'New mapping for:')}
            </span>
            {available.map((kind) => (
              <Button
                key={`${kind.addOnKey}:${kind.kind}`}
                size="sm"
                variant="secondary"
                onClick={() => setEditing({ kind })}
              >
                {pick(kind.label, currentLocale(), kind.kind)}
              </Button>
            ))}
          </Card>
        </>
      ) : (
        <ProfileEditor
          kind={editing.kind}
          {...(editing.profile === undefined ? {} : { profile: editing.profile })}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProfileList({
  profiles,
  kinds,
  onEdit,
}: {
  profiles: readonly DocumentProfile[];
  kinds: readonly DocumentKindOption[];
  onEdit: (profile: DocumentProfile, kind: DocumentKindOption) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: documentsKey }),
  });

  if (profiles.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {studioT('studio:documents.empty', 'No mappings yet.')}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {profiles.map((profile) => {
        const kind = kinds.find(
          (option) => option.addOnKey === profile.addOnKey && option.kind === profile.kind,
        );
        return (
          <li key={profile.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {pick(kind?.label, currentLocale(), profile.kind)} · {profile.table}
                {profile.trigger === null
                  ? ` · ${studioT('studio:documents.trigger.manualShort', 'on request')}`
                  : ` · ${profile.trigger.event}`}
                {profile.enabled
                  ? ''
                  : ` · ${studioT('studio:documents.disabled', 'switched off')}`}
              </p>
            </div>
            {/*
              * Delete was the only thing this list offered, which made every
              * mapping write-once: a column chosen wrongly six months ago
              * could only be fixed by deleting the mapping — and with it the
              * rule that fires it and the link every document in the register
              * holds back to it.
              */}
            {kind !== undefined && (
              <Button size="sm" variant="ghost" onClick={() => onEdit(profile, kind)}>
                {studioT('studio:documents.edit', 'Edit')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(profile.id)}
            >
              {studioT('studio:documents.delete', 'Delete')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The editor.
 *
 * ONE SCROLL, not a wizard. §3.7 numbers eight steps and they are eight
 * SECTIONS here: a mapping is a form somebody revisits — changing which column
 * feeds one slot six months later — and a wizard makes that a five-click
 * journey to reach the field they want. The numbering is kept in the headings
 * so the plan and the screen can be read against each other.
 */
function ProfileEditor({
  kind,
  profile,
  onDone,
}: {
  kind: DocumentKindOption;
  profile?: DocumentProfile;
  onDone: () => void;
}) {
  const locale = currentLocale();
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ['automations', 'sources'], queryFn: automationsApi.sources });

  const stored = profile?.options as { prefix?: string; literals?: Record<string, string> } | undefined;
  const [name, setName] = useState(profile?.name ?? pick(kind.label, locale, kind.kind));
  const [connectionId, setConnectionId] = useState(profile?.connectionId ?? '');
  const [table, setTable] = useState(profile?.table ?? '');
  const [bindings, setBindings] = useState<Bindings>(() =>
    profile === undefined ? {} : fromMapping(profile.mapping, stored?.literals ?? {}),
  );
  const [trigger, setTrigger] = useState<'manual' | 'created' | 'updated'>(
    profile?.trigger?.event === 'record.created'
      ? 'created'
      : profile?.trigger?.event === 'record.updated'
        ? 'updated'
        : 'manual',
  );
  const [prefix, setPrefix] = useState(stored?.prefix ?? '');
  const [emailSlot, setEmailSlot] = useState(
    (profile?.deliver as { emailSlot?: string | null } | undefined)?.emailSlot ?? '',
  );

  // The kind's own address fields (§3.7 step 6 needs an `email` slot), and
  // whether this deployment could send anything at all.
  const emailSlots = kind.outline.slots.filter((slot) => slot.type === 'email');
  const mailGate = emailSendGate(useCapabilities().flags);

  const connections = sources.data?.connections ?? [];
  const connection = connections.find((row) => row.id === connectionId) ?? connections[0];

  const tables: TableFacts[] = useMemo(
    () =>
      (connection?.tables ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        canRead: row.canRead,
        // §3.7 step 3's picker seed. Until this was carried through, the field
        // existed on `TableFacts`, `rankTables` scored on it, and nothing ever
        // set it — so the "has a child table" half of the ranking had never
        // once fired.
        children: row.children ?? [],
        columns: row.columns.map(
          (column): ColumnFacts => ({
            name: column.name,
            label: column.label,
            logicalType: column.logicalType,
            nullable: true,
            primaryKey: column.isPk,
            pii: column.pii,
            ...(column.emailLike ? { semantic: 'email' } : {}),
          }),
        ),
      })),
    [connection],
  );

  const ranked = useMemo(() => rankTables(tables), [tables]);
  const header = tables.find((row) => row.id === table);
  const reads = tablesRead(bindings, table);
  const refused = unreadableTables(tables, reads);
  const unbound = unboundRequiredSlots(kind.outline.slots, bindings);

  const save = useMutation({
    mutationFn: async () => {
      const draft = {
        addOnKey: kind.addOnKey,
        kind: kind.kind,
        name,
        connectionId: connection?.id ?? '',
        table,
        mapping: toMapping(bindings),
        options: {
          ...(prefix === '' ? {} : { prefix }),
          literals: toLiterals(bindings),
          formats: kind.formats,
          paper: kind.paper[0] ?? 'a4',
        },
        trigger:
          trigger === 'manual'
            ? null
            : { event: trigger === 'created' ? 'record.created' : 'record.updated' },
        deliver: {
          store: true,
          // Absent rather than '' — `emailDocument` reads "no slot named" as
          // "this mapping never wanted an email", and stamps nothing.
          ...(emailSlot === '' ? {} : { emailSlot }),
        },
      };
      return profile === undefined
        ? await createProfile(draft)
        : await updateProfile(profile.id, draft);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey });
      onDone();
    },
  });

  if (sources.isPending) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4">
        <Step n={1} title={studioT('studio:documents.step.kind', 'Kind')}>
          <p className="text-sm">{pick(kind.label, locale, kind.kind)}</p>
          <p className="text-xs text-fg-muted">{kind.addOnKey}</p>
        </Step>
        <label className="flex flex-col gap-1">
          <span className="text-sm">{studioT('studio:documents.name', 'Name this mapping')}</span>
          <Input value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <Step n={2} title={studioT('studio:documents.step.table', 'Connection and table')}>
          <div className="flex flex-wrap gap-3">
            <Select
              value={connection?.id ?? ''}
              // Both selects in this step were unlabelled: sighted operators
              // read the heading above them, and a screen reader announced two
              // anonymous combo boxes.
              aria-label={studioT('studio:documents.connectionLabel', 'Connection')}
              onChange={(event) => {
                setConnectionId(event.currentTarget.value);
                setTable('');
                setBindings({});
              }}
            >
              {connections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
            <Select
              value={table}
              aria-label={studioT('studio:documents.tableLabel', 'Table')}
              onChange={(event) => {
                setTable(event.currentTarget.value);
                setBindings({});
              }}
            >
              <option value="">
                {studioT('studio:documents.pickTable', 'Choose a table…')}
              </option>
              {/* Ranked, never filtered — see `rankTables`. */}
              {ranked.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>
        </Step>
      </Card>

      {header !== undefined && (
        <Card className="flex flex-col gap-4 p-4">
          <Step n={3} title={studioT('studio:documents.step.mapping', 'What fills each field')}>
            {/*
              * Step 4 is not a section of its own: "left alone, a column, or a
              * value typed here" is a choice ABOUT one field, and putting it
              * anywhere but on that field's own row would mean naming every
              * slot twice on one page.
              */}
            <p className="text-xs text-fg-muted">
              {studioT(
                'studio:documents.step.mappingHelp',
                'Each field reads a column, or takes a value you type here.',
              )}
            </p>
            <div className="flex flex-col gap-3">
              {kind.outline.slots.map((slot) => (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  locale={locale}
                  header={header}
                  tables={tables}
                  binding={bindings[slot.id] ?? { kind: 'unmapped' }}
                  onChange={(next) =>
                    setBindings((current) => ({ ...current, [slot.id]: next }))
                  }
                />
              ))}
            </div>
          </Step>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <Step n={5} title={studioT('studio:documents.step.trigger', 'What draws it')}>
          <Select
            value={trigger}
            onChange={(event) => setTrigger(event.currentTarget.value as typeof trigger)}
          >
            <option value="manual">
              {studioT('studio:documents.trigger.manual', 'Only when somebody asks')}
            </option>
            <option value="created">
              {studioT('studio:documents.trigger.created', 'When a row is added')}
            </option>
            <option value="updated">
              {studioT('studio:documents.trigger.updated', 'When a row changes')}
            </option>
          </Select>
          {trigger !== 'manual' && (
            <Alert
              tone="info"
              title={studioT('studio:documents.trigger.noteTitle', 'What counts as a change')}
            >
              {studioT(
                'studio:documents.trigger.note',
                'Rows added by an import or written straight into the database do not draw anything — only writes through Adminium do.',
              )}
            </Alert>
          )}
        </Step>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <Step n={6} title={studioT('studio:documents.step.delivery', 'Where it goes')}>
          <p className="text-sm text-fg-muted">
            {studioT(
              'studio:documents.delivery.stored',
              'Kept on the record, always.',
            )}
          </p>
          {/*
            * §3.7 step 6's email half. The choice is a SLOT, not a column: the
            * address may arrive through a lookup across a foreign key, and by
            * the time a document exists the slot is the only name that still
            * means anything — the subject is frozen and the source row may be
            * gone.
            */}
          {emailSlots.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {studioT(
                'studio:documents.delivery.noEmailSlot',
                'This kind of document has no address field, so it cannot be emailed.',
              )}
            </p>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-sm">
                {studioT('studio:documents.delivery.email', 'Email it to')}
              </span>
              <Select
                value={emailSlot}
                aria-label={studioT('studio:documents.delivery.email', 'Email it to')}
                // Never HIDDEN when SMTP is unconfigured — disabled, with the
                // reason said out loud. "Never hide, always explain" is the
                // rule the capability module exists to enforce.
                disabled={!mailGate.enabled}
                onChange={(event) => setEmailSlot(event.currentTarget.value)}
              >
                <option value="">
                  {studioT('studio:documents.delivery.noEmail', 'Nobody — keep it on the record')}
                </option>
                {emailSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {pick(slot.label, locale, slot.id)}
                  </option>
                ))}
              </Select>
              {!mailGate.enabled && (
                <span className="text-xs text-fg-muted">
                  {studioT(
                    'studio:documents.delivery.noSmtp',
                    'This Adminium has no email server set up yet, so nothing can be sent. Set one up in Studio → Settings → Email.',
                  )}
                </span>
              )}
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-sm">
              {studioT('studio:documents.prefix', 'Number prefix')}
            </span>
            <Input
              value={prefix}
              placeholder="INV-"
              onChange={(event) => setPrefix(event.currentTarget.value)}
            />
          </label>
        </Step>
      </Card>

      {header !== undefined && (
        <Card className="flex flex-col gap-3 p-4">
          <Step n={8} title={studioT('studio:documents.step.render', 'Try it on a row')}>
            <RenderForRow
              profileId={profile?.id ?? null}
              connectionId={connection?.id ?? ''}
              table={table}
              columns={header.columns}
            />
          </Step>
        </Card>
      )}

      {refused.length > 0 && (
        <Alert
          tone="warn"
          title={studioT('studio:documents.grants.title', 'You cannot read all of this')}
        >
          {/*
            * Step 7, shown BEFORE saving rather than discovered at render. A
            * mapping made by somebody who cannot read one of its tables draws
            * documents that fail for them and work for an administrator, which
            * is the most confusing possible outcome.
            */}
          {studioT(
            'studio:documents.grants.refused',
            'This mapping reads {tables}, which you may not read. Documents from it will fail for you.',
            { tables: refused.join(', ') },
          )}
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button
          disabled={table === '' || unbound.length > 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          {studioT('studio:documents.save', 'Save mapping')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {studioT('studio:documents.cancel', 'Cancel')}
        </Button>
        {unbound.length > 0 && (
          <span className="text-xs text-fg-muted">
            {studioT('studio:documents.unbound', 'Still to fill: {slots}', {
              slots: unbound.join(', '),
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        <span className="me-2 text-fg-muted">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}


/**
 * A collection slot: which child table, and which of its columns fill the
 * slot's own columns (§3.7 step 3).
 *
 * ─── TWO DECISIONS, AND THE SECOND DEPENDS ON THE FIRST ────────────────────
 *
 * The child table is chosen first because the column pickers below it are the
 * CHILD's columns, not the header's — a line's description lives on
 * `order_lines`, and offering the order's own columns there would be offering
 * one value repeated down every line.
 *
 * ─── WHAT IS NOT OFFERED, AND WHY THAT IS NOT THIS FILE'S CALL ─────────────
 *
 * The list comes from the server already filtered to foreign keys a stored
 * mapping can express — see `apps/server/src/connections/child-tables.ts`. An
 * editor that filtered here would have to restate the pipeline's join rule,
 * and the two would drift.
 */
function CollectionRow({
  slot,
  locale,
  header,
  tables,
  binding,
  onChange,
}: {
  slot: OutlineSlot;
  locale: string;
  header: TableFacts;
  tables: readonly TableFacts[];
  binding: SlotBinding;
  onChange: (next: SlotBinding) => void;
}) {
  const children = rankChildTables(header.children ?? []);
  const chosen = binding.kind === 'collection' ? binding : null;
  const child = chosen === null ? undefined : tables.find((row) => row.id === chosen.table);

  if (children.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        {/*
          * Not a picker with nothing in it. Nothing points at this table, so
          * there is no child to draw lines from — and the fix is in the source
          * database, not on this page.
          */}
        {studioT(
          'studio:documents.slot.noChildren',
          'Nothing in your database points at this table, so there are no lines to draw. A document needs a child table with a foreign key back to this one.',
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={chosen === null ? '' : `${chosen.table}|${chosen.fkColumn}`}
        aria-label={pick(slot.label, locale, slot.id)}
        onChange={(event) => {
          const choice = event.currentTarget.value;
          if (choice === '') {
            onChange({ kind: 'unmapped' });
            return;
          }
          const [table, fkColumn] = choice.split('|');
          /*
           * The column map starts EMPTY on every change of table. Carrying it
           * over would leave a mapping naming columns of the table somebody
           * just moved away from, which passes every check here and fails at
           * render — or worse, matches a same-named column and draws the wrong
           * field.
           */
          onChange({ kind: 'collection', table: table!, fkColumn: fkColumn!, columns: {} });
        }}
      >
        <option value="">
          {studioT('studio:documents.slot.noLines', 'No lines')}
        </option>
        {children.map((edge) => (
          <option key={`${edge.table}|${edge.column}`} value={`${edge.table}|${edge.column}`}>
            {tables.find((row) => row.id === edge.table)?.label ?? edge.table}
            {' · '}
            {edge.column}
            {edge.lineItems === true
              ? ` · ${studioT('studio:documents.slot.looksLikeLines', 'looks like lines')}`
              : ''}
          </option>
        ))}
      </Select>

      {chosen !== null && child !== undefined && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-fg-muted">
            {studioT('studio:documents.slot.lineColumns', 'What fills each column of a line')}
          </p>
          {(slot.columns ?? []).map((column) => {
            const label = pick(column.label, locale, column.id);
            const { preferred, rest } = columnsForSlot(column, child.columns);
            return (
              <label key={column.id} className="grid gap-1 md:grid-cols-[10rem_1fr] md:items-center">
                <span className="text-sm">{label}</span>
                <Select
                  value={chosen.columns[column.id] ?? ''}
                  aria-label={studioT('studio:documents.slot.lineColumnOf', '{column} of each line', {
                    column: label,
                  })}
                  onChange={(event) => {
                    const picked = event.currentTarget.value;
                    const next = { ...chosen.columns };
                    /*
                     * DELETED rather than set to '': `toMapping` writes this map
                     * straight through, and `buildSubject` skips a slot column
                     * whose source is `undefined`. An empty string would name a
                     * column called "", which reads as null on every row.
                     */
                    if (picked === '') delete next[column.id];
                    else next[column.id] = picked;
                    onChange({ ...chosen, columns: next });
                  }}
                >
                  <option value="">
                    {studioT('studio:documents.slot.unmapped', 'Not filled')}
                  </option>
                  {[...preferred, ...rest].map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.label}
                      {option.pii === true
                        ? ` · ${studioT('studio:documents.slot.pii', 'hidden data')}`
                        : ''}
                    </option>
                  ))}
                </Select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One slot's row.
 *
 * A slot with a `default` says so and offers an override — the engine fills it
 * otherwise, and an editor that demanded a column for a document number would
 * be demanding one for a value that does not exist yet.
 */
function SlotRow({
  slot,
  locale,
  header,
  tables,
  binding,
  onChange,
}: {
  slot: OutlineSlot;
  locale: string;
  header: TableFacts;
  /** Every table in the connection — a collection's child is one of them. */
  tables: readonly TableFacts[];
  binding: SlotBinding;
  onChange: (next: SlotBinding) => void;
}) {
  const columns = header.columns;
  const { preferred, rest } = columnsForSlot(slot, columns);
  const label = pick(slot.label, locale, slot.id);
  const help = slot.help === undefined ? null : pick(slot.help, locale, '');

  return (
    <div className="grid gap-2 md:grid-cols-[14rem_1fr] md:items-start">
      <div>
        <p className="text-sm">
          {label}
          {slot.required && slot.default === undefined && (
            <span className="ms-1 text-danger" aria-hidden>
              *
            </span>
          )}
        </p>
        {help !== null && help !== '' && <p className="text-xs text-fg-muted">{help}</p>}
      </div>
      {slot.type === 'collection' ? (
        <CollectionRow
          slot={slot}
          locale={locale}
          header={header}
          tables={tables}
          binding={binding}
          onChange={onChange}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Select
            /*
             * Every option is PREFIXED, so that `TYPED` can never collide with
             * a column actually called "typed". The three states this select
             * carries are §3.7 step 4's whole subject: left alone, read from a
             * column, or given a value here.
             */
            value={
              binding.kind === 'column'
                ? `${COLUMN_OPTION}${binding.column}`
                : binding.kind === 'literal'
                  ? TYPED_OPTION
                  : ''
            }
            aria-label={label}
            onChange={(event) => {
              const choice = event.currentTarget.value;
              if (choice === '') onChange({ kind: 'unmapped' });
              else if (choice === TYPED_OPTION) onChange({ kind: 'literal', value: '' });
              else onChange({ kind: 'column', column: choice.slice(COLUMN_OPTION.length) });
            }}
          >
            <option value="">
              {slot.default === undefined
                ? studioT('studio:documents.slot.unmapped', 'Not filled')
                : studioT('studio:documents.slot.byDefault', 'Filled by Adminium')}
            </option>
            {[...preferred, ...rest].map((column) => (
              <option key={column.name} value={`${COLUMN_OPTION}${column.name}`}>
                {column.label}
                {column.pii === true
                  ? ` · ${studioT('studio:documents.slot.pii', 'hidden data')}`
                  : ''}
              </option>
            ))}
            {mayTypeValue(slot) && (
              <option value={TYPED_OPTION}>
                {studioT('studio:documents.slot.typed', 'A value I type')}
              </option>
            )}
          </Select>
          {binding.kind === 'literal' && (
            <>
              <Input
                value={binding.value}
                aria-label={studioT('studio:documents.slot.typedValue', 'Value for {slot}', {
                  slot: label,
                })}
                onChange={(event) =>
                  onChange({ kind: 'literal', value: event.currentTarget.value })
                }
              />
              <p className="text-xs text-fg-muted">
                {/*
                  * The plan's own words, and they earn their place: this is
                  * the one field on the page whose value does NOT move when
                  * the row does, and a reader who misses that will wonder for
                  * a while why every document says 20%.
                  */}
                {studioT(
                  'studio:documents.slot.typedHint',
                  'Entered here, not read from your data — every document from this mapping gets the same value.',
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
