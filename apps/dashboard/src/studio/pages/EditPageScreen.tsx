// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/pages/$pageId` — edit a page, with the template's shape beside the
 * form.
 *
 * Was a drawer. The drawer had outgrown itself: identity, nav placement, data
 * source and the whole column manager in one scrolling column, with the save
 * button pinned below a screenful of content it could not see. Same split as
 * the create screen, for the same reason — the template choice is the one that
 * needs a picture — plus the page's contents editor under the form.
 */

import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CRUD_LABEL_MAX_LENGTH,
  isTableBoundTemplate,
  parseCrudAttachmentsConfig,
  parseCrudDerived,
  parseCrudFilters,
  parseCrudForm,
  parseCrudLabels,
  type CrudFilterField,
  type CrudFormConfig,
  type CrudAttachmentsConfig,
  type CrudDerivedConfig,
  type PagePaddingConfig,
  type PageWidthConfig,
} from '@adminium/engine/config';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChoiceChips,
  FormField,
  Input,
  InputGroup,
  Select,
  Spinner,
  Switch,
} from '@adminium/ui';
import { ExternalLink } from 'lucide-react';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { pageQuery } from '../../api/pages.js';
import { FormDesignerCard } from './form-designer/FormDesignerCard.js';
import { FiltersCard } from './FiltersCard.js';
import { destinationsQuery } from '../storage/storageApi.js';
import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { AttachmentsColumnSetup } from './AttachmentsColumnSetup.js';
import { schemaAuthoringRefusal } from './schemaAuthoringReason.js';
import { templateFitQuery } from './fitApi.js';
import { TableRemedies, type RelatedChoice } from './TableRemedies.js';
import { remapSchemaQuery } from '../remap/api.js';
import { titleCase } from '../remap/model.js';
import { ColumnManager, parseStoredColumns, type StoredColumn } from './ColumnManager.js';
import { DerivedNumbersCard } from './DerivedNumbersCard.js';
import { IconPicker } from './IconPicker.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { PageEditorLayout, templateTitle } from './PageEditorLayout.js';
import { PaddingField } from './PaddingField.js';
import { WidthField } from './WidthField.js';
import {
  NAV_GROUPS,
  PAGE_URL_PREFIX,
  invalidatePages,
  isNavGroup,
  savePageConfig,
  slugify,
  slugifyInput,
  studioPagesQuery,
  updatePage,
  type NavGroup,
  type PageSummaryDto,
} from './pagesApi.js';

const GROUP_LABEL_KEY: Record<NavGroup, string> = {
  workspace: 'nav.group.workspace',
  library: 'nav.group.library',
  planning: 'nav.group.planning',
  people: 'nav.group.people',
  account: 'nav.group.account',
};

const GROUP_FALLBACK: Record<NavGroup, string> = {
  workspace: 'Workspace',
  library: 'Library',
  planning: 'Planning',
  people: 'People',
  account: 'Account',
};

// --- attachments --------------------------------

/**
 * The sentinel the upload route reads as "this server's own disk" rather than
 * any configured destination (`LOCAL_DESTINATION_ID`, `routes/files/index.ts`).
 * It is a real answer and not the same as leaving the field on the default:
 * once an operator points the workspace default at a bucket, this is how one
 * table's files are kept on the box.
 */
const LOCAL_DESTINATION = 'local';

/** The unit the size field is typed in. Stored bytes, shown megabytes. */
const MEGABYTE = 1024 * 1024;

/**
 * The upload allowlist's stable keys, mirrored from the server's
 * `SNIFF_TYPE_KEYS` (`apps/server/src/files/sniff.ts`).
 *
 * WHY A MIRROR AND NOT A FETCH. No route hands the dashboard the workspace's
 * own `files.allowedTypes`, and the chips do not need it: a page's list can
 * only ever NARROW the workspace's, because the server intersects the two on
 * every upload rather than unioning them. So offering the whole closed
 * vocabulary here cannot widen the security boundary by a single type — the
 * worst an operator can do is name one the workspace already refuses, which
 * changes nothing.
 */
const ATTACHMENT_TYPE_KEYS = [
  'pdf',
  'png',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'svg',
  'zip',
  'office',
  'mp4',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'csv',
  'text',
  'markdown',
  'json',
] as const;

/**
 * File-format names are PROPER NAMES — "PDF" and "WebP" read the same in every
 * locale, the same reason a storage provider's name is data on this screen and
 * not a translation key — so they are spelled here rather than translated.
 */
const ATTACHMENT_TYPE_NAMES: Record<string, string> = {
  pdf: 'PDF',
  png: 'PNG',
  jpeg: 'JPEG',
  gif: 'GIF',
  webp: 'WebP',
  heic: 'HEIC',
  svg: 'SVG',
  zip: 'ZIP',
  mp4: 'MP4',
  mp3: 'MP3',
  wav: 'WAV',
  webm: 'WebM',
  ogg: 'Ogg',
  csv: 'CSV',
  markdown: 'Markdown',
  json: 'JSON',
};

/** The two keys that are English words rather than format names. */
function attachmentTypeLabel(key: string): string {
  if (key === 'office') return t('studio:pages.attachments.type.office', 'Office documents');
  if (key === 'text') return t('studio:pages.attachments.type.text', 'Plain text');
  return ATTACHMENT_TYPE_NAMES[key] ?? key;
}

/**
 * Drop a column's `file` block, keeping the column.
 *
 * `{...column, file: undefined}` would leave the key present, which is not the
 * same document — `ColumnManager` has the same helper for the same reason.
 */
function withoutFileBlock(column: StoredColumn): StoredColumn {
  const next: StoredColumn = { ...column };
  delete next.file;
  return next;
}

/** One field of the attachments block: a value, or `null` to clear it. */
interface AttachmentsPatch {
  enabled?: boolean;
  destinationId?: string | null;
  accept?: string[] | null;
  maxBytes?: number | null;
  maxCount?: number | null;
  /** The bound column; `null` unbinds without touching the column. */
  column?: string | null;
}

/**
 * Rebuild the block with one field changed.
 *
 * Every optional key is written by CONDITIONAL SPREAD rather than by assigning
 * `undefined`: `exactOptionalPropertyTypes` forbids the latter, and it is also
 * the difference that matters on the wire — a key present with `undefined`
 * survives neither the JSON round-trip nor the schema, while an absent key is
 * exactly what "follow the workspace" means.
 *
 * The fixed key order is load-bearing too: the dirty check compares two of
 * these with `JSON.stringify`, the same by-value comparison the padding pair
 * needs, so both sides have to be built by this function.
 */
function applyAttachments(
  base: CrudAttachmentsConfig,
  patch: AttachmentsPatch,
): CrudAttachmentsConfig {
  const destinationId =
    patch.destinationId === undefined ? base.destinationId : (patch.destinationId ?? undefined);
  const accept = patch.accept === undefined ? base.accept : (patch.accept ?? undefined);
  const maxBytes = patch.maxBytes === undefined ? base.maxBytes : (patch.maxBytes ?? undefined);
  const maxCount = patch.maxCount === undefined ? base.maxCount : (patch.maxCount ?? undefined);
  const column = patch.column === undefined ? base.column : (patch.column ?? undefined);
  return {
    enabled: patch.enabled ?? base.enabled,
    // Ahead of the caps so the fixed key order the dirty check depends on
    // stays fixed — see the note above on why that matters.
    ...(column === undefined ? {} : { column }),
    ...(destinationId === undefined ? {} : { destinationId }),
    // An empty selection is not "accept nothing" — it is "no narrowing", which
    // is spelled by having no key at all.
    ...(accept === undefined || accept.length === 0 ? {} : { accept }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(maxCount === undefined ? {} : { maxCount }),
  };
}

export function EditPageScreen({ pageId }: { pageId: string }) {
  const list = useQuery(studioPagesQuery());
  const page = (list.data ?? []).find((row) => row.id === pageId);

  if (list.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );
  }
  if (page === undefined) {
    return (
      <PageSurface width="narrow">
        <Alert
          tone="warn"
          data-testid="studio-pages-missing"
          title={t('studio:pages.editor.missing', 'That page no longer exists')}
          body={t(
            'studio:pages.editor.missingBody',
            'It may have been deleted, or removed by a regeneration run.',
          )}
        />
      </PageSurface>
    );
  }

  // Keyed on the row so every field's initial state is re-derived if the page
  // changes underneath (a regeneration, another admin) instead of showing the
  // previous page's values in a form that would then save them.
  return <EditPageForm key={`${page.id}:${page.revision}`} page={page} />;
}

function EditPageForm({ page }: { page: PageSummaryDto }) {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [navGroup, setNavGroup] = useState<NavGroup>(
    isNavGroup(page.navGroup) ? page.navGroup : 'workspace',
  );
  const [isEnabled, setIsEnabled] = useState(page.isEnabled);
  const [template, setTemplate] = useState(page.type);
  const [connectionId, setConnectionId] = useState<string | null>(page.connectionId);
  // `undefined` = not edited; the displayed value falls back to the document's
  // stored table, which arrives later than the row does.
  const [table, setTable] = useState<string | null | undefined>(undefined);
  // A linked table chosen through a key (remedy 2) — kept beside `table`
  // because the save has to send the key, and cleared by any other choice.
  const [related, setRelated] = useState<RelatedChoice | null>(null);
  const chooseTable = (next: string | null): void => {
    setRelated(null);
    setTable(next);
  };
  // Same "not edited yet" convention: padding lives in the ENVELOPE, not the
  // list row, so it is unknown until `pageQuery` resolves. `null` inside the
  // edited state means a deliberate "back to the template default".
  const [padding, setPadding] = useState<PagePaddingConfig | null | undefined>(undefined);
  const [width, setWidth] = useState<PageWidthConfig | null | undefined>(undefined);
  // Same "not edited yet" convention as padding — the stored override lives in
  // the config BODY, which arrives with `pageQuery`, not on the list row.
  const [newRowLabel, setNewRowLabel] = useState<string | undefined>(undefined);

  const document = useQuery(pageQuery(page.id));
  const connections = useQuery({
    queryKey: ['studio', 'connections'] as const,
    queryFn: studioApi.listConnections,
  });

  const bindable = isTableBoundTemplate(template);
  const schema = useQuery({
    queryKey: ['studio', 'schema', connectionId] as const,
    queryFn: () => studioApi.getSchema(connectionId as string),
    enabled: bindable && connectionId !== null,
    retry: false,
  });

  const storedTable =
    document.data?.status === 'ok' ? (document.data.page.source.table ?? null) : null;
  const effectiveTable = table === undefined ? storedTable : table;
  const storedPadding =
    document.data?.status === 'ok' ? (document.data.page.padding ?? null) : null;
  const effectivePadding = padding === undefined ? storedPadding : padding;
  // Compared by value: the custom pair is a fresh object on every keystroke, so
  // identity would mark the form dirty even after typing the stored number back.
  const paddingChanged =
    padding !== undefined && JSON.stringify(padding) !== JSON.stringify(storedPadding);
  const storedWidth =
    document.data?.status === 'ok' ? (document.data.page.width ?? null) : null;
  const effectiveWidth = width === undefined ? storedWidth : width;
  // A plain `!==` here, unlike padding above: width is a string union, so there
  // is no fresh-object-per-keystroke problem to compare around.
  const widthChanged = width !== undefined && width !== storedWidth;

  const storedConfig =
    document.data?.status === 'ok' ? document.data.page.config : null;
  // '' is the editable spelling of "no override" — the field is empty when the
  // page has none, and emptying it clears one. It is never what gets STORED:
  // the schema rejects a blank label, and a blank one would render a nameless
  // button, so the save deletes the key instead (see `nextConfigBody`).
  const storedNewRowLabel =
    storedConfig === null ? '' : (parseCrudLabels(storedConfig)?.newRow ?? '');
  const effectiveNewRowLabel = newRowLabel === undefined ? storedNewRowLabel : newRowLabel;
  const labelsChanged =
    newRowLabel !== undefined && newRowLabel.trim() !== storedNewRowLabel;
  const finalSlug = slugify(slug);
  const slugChanged = finalSlug !== page.slug;

  const sourceChanged =
    template !== page.type ||
    connectionId !== page.connectionId ||
    (table !== undefined && table !== storedTable) ||
    related !== null;

  // What the chosen template needs from the chosen table — the same query the
  // fit panel reads, so the panel and the Save button are one answer. Not asked
  // while titled through a key: it describes the table ALONE, which is what the
  // operator stepped around.
  const fit = useQuery({
    ...templateFitQuery({
      connectionId: connectionId ?? '',
      table: effectiveTable ?? '',
      template,
    }),
    enabled: bindable && connectionId !== null && effectiveTable !== null && related === null,
  });
  // Blocks the save only when the save would RECOMPOSE onto a table that
  // cannot back the template — the server would refuse it with the same
  // reason. A page left as it is saves its other fields regardless, even if
  // its table has since drifted out of fit.
  const fitBlocksSave = sourceChanged && related === null && fit.data?.satisfied === false;
  const pickableTables = (schema.data?.model.tables ?? []).filter(
    (candidate) => candidate.system !== true,
  );

  // The columns draft the ColumnManager reports (null = clean). ONE "Save
  // changes" persists both halves — the old per-card "Save columns" next to
  // this button silently discarded whichever draft the other one didn't cover.
  const [columnsDraft, setColumnsDraft] = useState<StoredColumn[] | null>(null);
  const storedColumns = useMemo(
    () => parseStoredColumns(storedConfig ?? {}),
    [storedConfig],
  );
  const columns = columnsDraft ?? storedColumns;
  /**
   * The page's `config.derived` block — measures and derived fields. `null`
   * while untouched, so a page that never had one does not gain an empty
   * block on an unrelated save.
   *
   * Held HERE rather than inside a card, because two surfaces edit it: the
   * inbound sub-picker in the Columns card writes measures, and the derived
   * numbers surface writes fields. Two independent drafts of one document have
   * no defined merge — whichever the screen applied second would drop the
   * other's work, which is exactly the bug this screen's single save button
   * was introduced to kill.
   */
  /**
   * The designed create/edit form. Three states, not two: `undefined` is
   * untouched, `null` is "back to the generated form" (which DELETES the stored
   * block), and a document is a design to store. Folding the last two together
   * would make "reset to generated" store a copy of today's default and stop
   * the form following the table.
   */
  const [formDraft, setFormDraft] = useState<CrudFormConfig | null | undefined>(undefined);
  const storedForm = useMemo(
    () => (storedConfig === null ? null : parseCrudForm(storedConfig)),
    [storedConfig],
  );
  /*
   * Changed means "says something different from what is stored". A page with
   * no form whose draft went back to the generated one is NOT dirty, which is
   * what keeps a look around the designer from making the Save button light up.
   */
  const formChanged =
    formDraft !== undefined && JSON.stringify(formDraft) !== JSON.stringify(storedForm);

  /**
   * The toolbar's filters, with the same three states and the same reason:
   * `null` means "back to the suggested ones", which DELETES the block so the
   * toolbar keeps following the table rather than freezing today's suggestion.
   */
  const [filtersDraft, setFiltersDraft] = useState<CrudFilterField[] | null | undefined>(undefined);
  const storedFilters = useMemo(
    () => (storedConfig === null ? null : parseCrudFilters(storedConfig)),
    [storedConfig],
  );
  const filtersChanged =
    filtersDraft !== undefined && JSON.stringify(filtersDraft) !== JSON.stringify(storedFilters);
  /** What the designer needs, or null when this page has no table behind it. */
  const formFacts =
    document.data?.status === 'ok' && document.data.formColumns.length > 0
      ? {
          columns: document.data.formColumns,
          relations: document.data.formRelations,
          children: document.data.formChildren,
          connectionId: document.data.page.source.connectionId,
          entity: document.data.tableLabelSingular,
        }
      : null;
  const [derivedDraft, setDerivedDraft] = useState<CrudDerivedConfig | null>(null);
  const storedDerived = useMemo<CrudDerivedConfig>(() => {
    const parsed = parseCrudDerived(storedConfig?.['derived']);
    return parsed.ok ? parsed.value : { measures: [], fields: [] };
  }, [storedConfig]);
  const derived = derivedDraft ?? storedDerived;

  /**
   * The page's `config.attachments` block — the SIDECAR attachment mode, the
   * one that needs no column in the customer's table.
   *
   * THREE states, and the third is the point. `undefined` is untouched, a
   * block is the edited value, and `null` means "this page carries no
   * attachments key at all" — which is what every page written before 37
   * stores and what an untouched one must still store after a save on an
   * unrelated field. The same absence rule `derived` follows, for the same
   * reason.
   */
  /**
   * The switch is ON but no column is bound yet — column mode only.
   *
   * Local rather than part of the draft, because it is not a fact about the
   * page: nothing is written until a column exists (see `setAttachmentsEnabled`).
   */
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [attachmentsDraft, setAttachmentsDraft] = useState<
    CrudAttachmentsConfig | null | undefined
  >(undefined);
  const storedAttachments = useMemo(
    () => parseCrudAttachmentsConfig(storedConfig ?? {}),
    [storedConfig],
  );
  const attachments = attachmentsDraft === undefined ? storedAttachments : attachmentsDraft;
  /*
   * By value, like padding: every edit rebuilds the block, so identity would
   * call the page dirty for typing the stored number straight back in. Both
   * sides go through `applyAttachments` first so the comparison is over the
   * same key order rather than over whatever order the stored JSON happened to
   * carry.
   */
  const attachmentsChanged =
    attachmentsDraft !== undefined &&
    JSON.stringify(attachmentsDraft) !==
      JSON.stringify(storedAttachments === null ? null : applyAttachments(storedAttachments, {}));

  /**
   * The switch. OFF HAS TWO SPELLINGS and they are not interchangeable.
   *
   * A page that has never carried the block must not GAIN one by having the
   * switch looked at: absence is what it stores today, and writing
   * `{enabled: false}` onto every such page would rewrite bodies nobody asked
   * to change — so off, there, returns to absence. A page that HAS a
   * configured block keeps it and only flips `enabled`, so the destination,
   * the accepted types and the caps survive being switched off and back on.
   * That is what `crudAttachmentsConfigSchema`'s own docblock says the false
   * state exists for.
   */
  function setAttachmentsEnabled(next: boolean): void {
    if (next) {
      /*
       * IN COLUMN MODE THE SWITCH ALONE WRITES NOTHING.
       *
       * It opens the setup panel and no more; the block is written by
       * `bindAttachmentsColumn` once a column actually exists. Writing
       * `{enabled: true}` here would let an operator whose plan was refused —
       * no `schema.ddl`, say — save a page that claims attachments and names
       * no column, which the record page would then read as SIDECAR mode. That
       * is a silent downgrade to the mode D2 reserves for sources whose schema
       * cannot be authored at all.
       */
      if (columnMode) {
        setAttachmentsPending(true);
        return;
      }
      setAttachmentsDraft(applyAttachments(attachments ?? { enabled: true }, { enabled: true }));
      return;
    }
    setAttachmentsPending(false);
    /*
     * OFF UNBINDS; IT NEVER DROPS.
     *
     * Three things happen together, and leaving any one out is a half-off
     * state somebody has to debug later: the block goes `enabled: false`, the
     * `column` pointer is removed, and the column's own `file` block is
     * stripped from the page — because that block is what the server's
     * reconcile hook reads, and a column still carrying one would keep
     * attaching and trashing files for a page that no longer offers them.
     *
     * The COLUMN and its values are untouched. Dropping a column is the one
     * step Adminium cannot take back, so it stays a deliberate act in the
     * schema designer.
     */
    const bound = attachments?.column;
    if (bound !== undefined) {
      setColumnsDraft(columns.map((column) => (column.name === bound ? withoutFileBlock(column) : column)));
    }
    setAttachmentsDraft(
      storedAttachments === null
        ? null
        : applyAttachments(attachments ?? storedAttachments, { enabled: false, column: null }),
    );
  }

  /**
   * The page is now bound to `column` — write both halves into the drafts.
   *
   * The DDL (when there was any) has already run by the time this is called;
   * what is left is page config, and it rides the screen's ordinary Save
   * alongside whatever else is dirty. That is the ordering D6 asks for: a
   * column with no block is unused, while a block naming a column that does
   * not exist would mint references into nothing.
   */
  function bindAttachmentsColumn(column: string): void {
    setAttachmentsPending(false);
    const block = {
      // `id`, not the `url` default: this list is Adminium's own files, and an
      // id survives a destination move and every origin change.
      ref: 'id',
      multiple: true,
      ...(attachments?.destinationId === undefined ? {} : { destinationId: attachments.destinationId }),
      ...(attachments?.accept === undefined ? {} : { accept: [...attachments.accept] }),
      ...(attachments?.maxBytes === undefined ? {} : { maxBytes: attachments.maxBytes }),
      ...(attachments?.maxCount === undefined ? {} : { maxCount: attachments.maxCount }),
    };
    const existing = columns.find((entry) => entry.name === column);
    setColumnsDraft(
      existing === undefined
        ? [
            ...columns,
            /*
             * `label` IS REQUIRED, and its absence is silent.
             *
             * `gridColumnSpecSchema` demands one, `parseStoredColumns` drops
             * any entry that fails to parse, and the page route drops one on
             * READ rather than refusing the write — so a spec without a label
             * saves cleanly and is simply gone the next time the page loads.
             * `logicalType` is spelled out for the same reason it is worth
             * being explicit anywhere: the form renders a text control from it.
             */
            { name: column, label: titleCase(column), logicalType: 'text', file: block },
          ]
        : columns.map((entry) => (entry.name === column ? { ...entry, file: block } : entry)),
    );
    setAttachmentsDraft(applyAttachments(attachments ?? { enabled: true }, { enabled: true, column }));
  }

  /**
   * Storage destinations, for the picker below. Asked for only where the card
   * can actually render, so a page-editing admin who does not hold
   * `storage.manage` is not refused on every screen that has nothing to show.
   *
   * That refusal is NOT a failure worth reporting when it does come: the
   * picker simply does not appear and every attachment follows the workspace
   * default, which is what the overwhelming majority of pages want in any
   * case. `retry: false` so a 403 is asked once, not three times.
   */
  // The SHARED query (`studio/storage/storageApi.ts`). Its own copy used a
  // third cache key for the same endpoint, so the two page surfaces never saw
  // each other's fetch.
  const destinations = useQuery(destinationsQuery());

  /**
   * The connection's schema, for the attachments card.
   *
   * Two things come from it and nowhere else: whether this source's schema can
   * be authored at all, and the `snapshotId` a plan is built against — 35's
   * drift check compares that id, so a plan built against a stale one is
   * refused rather than applied to a shape that has moved.
   *
   * The SHARED key (`studio/remap/api.ts`), so the remap editor and this
   * screen see each other's fetch instead of paying twice. Mounted only where
   * the card can render — an unbound page or a dashboard has nothing to ask
   * about, and a page-editing admin should not spend a request per screen.
   */
  const attachmentsSchema = useQuery({
    ...remapSchemaQuery(connectionId ?? ''),
    enabled: template === 'page-crud' && connectionId !== null && effectiveTable !== null,
  });

  /**
   * The SOURCE table's columns, for the name checks in the setup panel.
   *
   * The snapshot's columns, not the page's `columns[]`: the question is what
   * the DATABASE already has — a name that exists cannot be created, and one
   * that exists as an integer cannot hold a reference. A page's column list is
   * a projection and answers neither.
   */
  const attachmentsTableColumns = useMemo(() => {
    const model = attachmentsSchema.data?.model;
    if (model === undefined || effectiveTable === null) return [];
    const found = model.tables.find((entry) => entry.id === effectiveTable || entry.name === effectiveTable);
    return (found?.columns ?? []).map((column) => ({
      name: column.name,
      logicalType: column.logicalType,
    }));
  }, [attachmentsSchema.data, effectiveTable]);

  /**
   * What the destination picker offers. A destination that has since been
   * disabled — or that this admin cannot see, because the list above was
   * refused — still has to appear when it is the one the page names, or
   * opening this screen would quietly reset a stored destination to the
   * default on the next save.
   */
  const destinationOptions = useMemo(() => {
    const chosen = attachments?.destinationId;
    const options = (destinations.data ?? [])
      .filter((row) => !row.disabled || row.id === chosen)
      .map((row) => ({
        value: row.id,
        label: row.isDefault
          ? t('studio:pages.attachments.destinationIsDefault', '{name} (the default)', {
              name: row.name,
            })
          : row.name,
      }));
    if (
      chosen !== undefined &&
      chosen !== LOCAL_DESTINATION &&
      !options.some((option) => option.value === chosen)
    ) {
      options.push({ value: chosen, label: chosen });
    }
    return options;
  }, [destinations.data, attachments]);

  /** Names the chip group, which is a `role="group"` and not a form control. */
  const acceptLabelId = useId();

  // Revision already advanced by a columns save whose identity half then
  // failed — the retry must If-Match the moved revision, not the stale row's.
  const savedRevision = useRef<number | null>(null);

  const identityDirty =
    title.trim() !== page.title ||
    finalSlug !== page.slug ||
    (icon.trim() === '' ? null : icon.trim()) !== (page.icon ?? null) ||
    navGroup !== (isNavGroup(page.navGroup) ? page.navGroup : 'workspace') ||
    isEnabled !== page.isEnabled ||
    sourceChanged ||
    paddingChanged ||
    widthChanged;

  /**
   * Anything living in the page's config BODY — one document, so one write.
   *
   * Nothing while a retemplate/rebind is pending: saving that RECOMPOSES the
   * body from the connection's schema, so a label written first would be
   * rebuilt away by the identity PATCH that follows it in the same save. The
   * Columns card already answers this by swapping itself for "save the change
   * above first"; the label field is disabled for the same reason, and this is
   * the belt to that braces — a label typed before the template was changed
   * must not ride along either.
   */
  const bodyDirty =
    storedConfig !== null &&
    !sourceChanged &&
    (columnsDraft !== null ||
      labelsChanged ||
      derivedDraft !== null ||
      attachmentsChanged ||
      filtersChanged ||
      formChanged);

  /**
   * The config body to persist: the stored one with each edited block applied
   * over it, so untouched keys (`detail`, anything a newer build wrote) survive
   * the round-trip.
   *
   * An emptied label DELETES `labels.newRow` rather than storing `''`. The
   * template resolves its default with `labels?.newRow ?? t(…)`, which a present
   * blank string satisfies — storing one would render a button with no name and
   * no way back to "New row" short of hand-editing JSON. Emptying the block
   * removes `labels` outright for the same reason a page that never had an
   * override does not carry one.
   */
  function nextConfigBody(): Record<string, unknown> {
    const body = { ...(storedConfig ?? {}) };
    if (columnsDraft !== null) body['columns'] = columnsDraft;
    if (formDraft !== undefined) {
      // `null` DELETES the block: a form that says what the derived one says
      // must not be frozen into the page, or it stops following the table the
      // day a column is added.
      if (formDraft === null) delete body['form'];
      else body['form'] = formDraft;
    }
    if (filtersDraft !== undefined) {
      // Same rule as the form: `null` removes the block and the toolbar goes
      // back to deriving its filters from the live columns.
      if (filtersDraft === null) delete body['filters'];
      else body['filters'] = filtersDraft;
    }
    if (derivedDraft !== null) {
      // An emptied block is REMOVED, not stored as `{measures:[],fields:[]}`:
      // absence is what a page that never defined one carries, and the read
      // path treats absence as an empty vocabulary at no cost.
      if (derivedDraft.measures.length === 0 && derivedDraft.fields.length === 0) {
        delete body['derived'];
      } else {
        body['derived'] = derivedDraft;
      }
    }
    if (labelsChanged) {
      const current = body['labels'];
      const labels: Record<string, unknown> =
        typeof current === 'object' && current !== null && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      const next = effectiveNewRowLabel.trim();
      if (next === '') delete labels['newRow'];
      else labels['newRow'] = next;
      if (Object.keys(labels).length === 0) delete body['labels'];
      else body['labels'] = labels;
    }
    if (attachmentsChanged) {
      // `null` is the switch's off position on a page that never had the block
      // — it DELETES the key rather than storing a disabled one, so a page
      // whose attachments were only ever looked at round-trips byte-identical.
      if (attachments === null) delete body['attachments'];
      else body['attachments'] = attachments;
    }
    return body;
  }

  const save = useMutation({
    mutationFn: async () => {
      let expectedRevision = savedRevision.current ?? page.revision;
      if (bodyDirty) {
        const updated = await savePageConfig(page.id, nextConfigBody(), expectedRevision);
        savedRevision.current = updated.revision;
        expectedRevision = updated.revision;
      }
      if (!identityDirty && bodyDirty) return;
      await updatePage(page.id, {
        title: title.trim(),
        slug: finalSlug,
        icon: icon.trim() === '' ? null : icon.trim(),
        navGroup,
        isEnabled,
        // Only when something about the body actually changed — otherwise every
        // rename would recompose and throw away hand-edited columns.
        ...(sourceChanged
          ? {
              template,
              connectionId,
              table: effectiveTable,
              ...(related === null ? {} : { titleThrough: related.offer.via }),
            }
          : {}),
        // Sent only when touched: an untouched page must keep following its
        // template default rather than having today's default frozen into it.
        ...(paddingChanged ? { padding: effectivePadding } : {}),
        ...(widthChanged ? { width: effectiveWidth } : {}),
        expectedRevision,
      });
    },
    onSuccess: async () => {
      await invalidatePages(client);
      await navigate({ to: '/studio/pages' });
    },
  });

  const isCrud = template === 'page-crud';

  /**
   * The Attachments card renders only where an attachment could exist: a
   * `page-crud` page BOUND to a table. A dashboard page has no records to hang
   * a file off, and an unbound crud page has no rows to hang one off either —
   * in both cases the card would be a control writing config that the record
   * page can never read, which is worse than a card that is not there.
   */
  /**
   * Which mode this page's attachments use.
   *
   * Decided by the CONNECTION, never by the person: `schemaAuthoring` says
   * whether this source's schema can be authored at all, and the four reasons
   * it can't (a schema file, a read-only role, no DDL privilege, a read-only
   * intent) are facts about the connection that hold identically for every
   * operator. Whether THIS operator holds `schema.ddl` is a different question
   * the dashboard is never told the answer to — the plan call asks it, and its
   * 403 names the grant.
   *
   * Absent is treated as authorable, the same tolerance `RemapEditor` applies:
   * a server one release behind does not send the field, and hiding the column
   * flow because of a missing field would break a working install.
   */
  const authoring = attachmentsSchema.data?.schemaAuthoring;
  const columnMode = authoring === undefined || authoring.authorable;
  // One source, two callers: the template-fit panel on the create screen shows
  // the same four sentences, and a second `? :` chain is how one surface ends
  // up describing a refusal the other has stopped giving.
  const sidecarReason = schemaAuthoringRefusal(authoring);

  const showAttachments =
    isCrud &&
    bindable &&
    connectionId !== null &&
    effectiveTable !== null &&
    !sourceChanged &&
    document.isSuccess &&
    document.data.status === 'ok';

  return (
    <PageEditorLayout
      heading={t('studio:pages.editor.title', 'Edit page')}
      subheading={page.title}
      template={template}
      previewTitle={title}
      previewIcon={icon}
      previewTable={bindable ? effectiveTable : null}
      previewAction={
        <Button variant="secondary" size="sm" iconLeft={<ExternalLink className="size-4" />} asChild>
          <Link to="/p/$slug" params={{ slug: page.slug }}>
            {t('studio:pages.editor.openPage', 'Open page')}
          </Link>
        </Button>
      }
      actions={
        <>
          {save.isError ? (
            <Alert
              tone="danger"
              data-testid="studio-pages-save-error"
              title={t('studio:pages.editor.saveFailed', 'Changes could not be saved')}
              body={save.error instanceof Error ? save.error.message : ''}
            />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => void navigate({ to: '/studio/pages' })}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={
                title.trim().length === 0 ||
                finalSlug.length === 0 ||
                (!identityDirty && !bodyDirty) ||
                fitBlocksSave
              }
              data-testid="studio-pages-save"
            >
              {t('studio:pages.editor.save', 'Save changes')}
            </Button>
          </div>
        </>
      }
    >
      {page.origin === 'generated' ? (
        <Alert
          tone="info"
          data-testid="studio-pages-generated-note"
          title={t('studio:pages.editor.generated.title', 'This page was generated from your schema')}
          body={t(
            'studio:pages.editor.generated.body',
            'Your changes survive regeneration. Deleting only lasts until the next run recreates it.',
          )}
        />
      ) : null}

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('studio:pages.editor.data', 'Data')}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <FormField label={t('studio:pages.field.template', 'Template')}>
            <Select
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value);
                setRelated(null);
              }}
              data-testid="studio-pages-template"
            >
              {/* Same filter as NewPageScreen: page-record is a crud page's
                  child route, never a standalone template choice. */}
              {pageTemplateDefinitions
                .filter((definition) => definition.standalone !== false)
                .map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {templateTitle(definition.id)}
                  </option>
                ))}
            </Select>
          </FormField>

          {bindable ? (
            <>
              {(connections.data ?? []).length > 1 ? (
                <FormField label={t('studio:pages.field.connection', 'Data source')}>
                  <Select
                    value={connectionId ?? ''}
                    onChange={(event) => {
                      setConnectionId(event.target.value === '' ? null : event.target.value);
                      chooseTable(null);
                    }}
                  >
                    <option value="">{t('studio:pages.field.connectionNone', 'None')}</option>
                    {(connections.data ?? []).map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              <FormField
                label={t('studio:pages.field.table', 'Table')}
                {...(connectionId === null
                  ? {
                      helper: t(
                        'studio:pages.field.tableNeedsConnection',
                        'Pick a data source first.',
                      ),
                    }
                  : {})}
              >
                <Select
                  value={effectiveTable ?? ''}
                  disabled={connectionId === null || schema.isPending}
                  onChange={(event) =>
                    chooseTable(event.target.value === '' ? null : event.target.value)
                  }
                  data-testid="studio-pages-table"
                >
                  <option value="">{t('studio:pages.field.tableNone', 'Not bound')}</option>
                  {pickableTables.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {`${candidate.schema}.${candidate.name}`}
                      </option>
                    ))}
                </Select>
              </FormField>

              {/* The same offers as the create screen — this is where
                  `EmptyLayoutNotice` sends someone whose page has no table,
                  and where a rebind lands on a table that cannot back it. */}
              {connectionId !== null && schema.data !== undefined ? (
                <TableRemedies
                  connectionId={connectionId}
                  template={template}
                  table={effectiveTable}
                  related={related}
                  noTables={pickableTables.length === 0}
                  onChooseTable={chooseTable}
                  onChooseRelated={(choice) => {
                    setTable(choice.offer.tableId);
                    setRelated(choice);
                  }}
                />
              ) : null}

              {schema.isError ? (
                <Alert
                  tone="warn"
                  title={t('studio:pages.editor.schemaFailed', 'Tables could not be listed')}
                  body={t(
                    'studio:pages.editor.schemaFailedBody',
                    'This connection may not have been analysed yet. Run introspection from Studio → Data connections.',
                  )}
                />
              ) : null}
            </>
          ) : (
            <Alert
              tone="info"
              data-testid="studio-pages-not-bindable"
              title={t('studio:pages.editor.notBindable', 'This template is not bound to one table')}
              body={t(
                'studio:pages.editor.notBindableBody',
                'Its contents are built widget by widget instead. Open the page and use Edit to add them.',
              )}
            />
          )}

          {sourceChanged ? (
            <Alert
              tone="warn"
              data-testid="studio-pages-recompose-warning"
              title={t('studio:pages.editor.recompose', 'This page will be rebuilt')}
              body={t(
                'studio:pages.editor.recomposeBody',
                'Saving rebuilds the contents. Column and widget edits here are lost.',
              )}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('studio:pages.editor.details', 'Details')}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <FormField label={t('studio:pages.field.title', 'Title')}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </FormField>

          {/*
            Renaming the page and renaming its button are the same act — an
            admin who has just called this page "Invoices" is looking at the one
            control still saying "New row" — so the field sits next to the title
            rather than in a card of its own. Crud-only: it is the only template
            whose stored body carries a `labels` block.

            Disabled until the config body is readable, and again while a
            retemplate is pending. The stored override lives in that body, so
            before it loads there is nothing to show and an edit would have no
            base to merge onto — and a pending rebuild would throw the edit away
            on save. The Columns card below gates on both conditions too.
          */}
          {isCrud ? (
            <FormField
              label={t('studio:pages.field.newRowLabel', 'Add button')}
              helper={t(
                'studio:pages.field.newRowLabelHint',
                'What the button that adds a record says. Leave empty to use the default, which is translated.',
              )}
            >
              <Input
                value={effectiveNewRowLabel}
                disabled={storedConfig === null || sourceChanged}
                maxLength={CRUD_LABEL_MAX_LENGTH}
                // The live default, read from the same key the template falls
                // back to, so the two cannot drift apart in any locale.
                placeholder={t('ui:templates.crud.newRow', 'New row')}
                onChange={(event) => setNewRowLabel(event.target.value)}
                data-testid="studio-pages-new-row-label"
              />
            </FormField>
          ) : null}

          <FormField
            label={t('studio:pages.field.slug', 'Page address')}
            {...(slugChanged
              ? {
                  error: t(
                    'studio:pages.field.slugWarning',
                    'Changing the address breaks existing links and bookmarks to this page.',
                  ),
                }
              : {})}
          >
            <InputGroup
              prefix={PAGE_URL_PREFIX}
              mono
              value={slug}
              error={slugChanged}
              onChange={(event) => setSlug(slugifyInput(event.target.value))}
              data-testid="studio-pages-slug"
            />
          </FormField>

          <FormField
            label={t('studio:pages.field.icon', 'Icon')}
            helper={t('studio:pages.field.iconHint', 'Shown beside the page name in the sidebar.')}
          >
            <IconPicker
              value={icon}
              onChange={setIcon}
              label={t('studio:pages.field.iconPick', 'Choose the page icon')}
              testId="studio-pages-icon"
            />
          </FormField>

          <FormField label={t('studio:pages.field.group', 'Sidebar group')}>
            <Select
              value={navGroup}
              onChange={(event) => setNavGroup(event.target.value as NavGroup)}
              data-testid="studio-pages-group"
            >
              {NAV_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(GROUP_LABEL_KEY[group], GROUP_FALLBACK[group])}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('studio:pages.field.visible', 'Show in sidebar')}
            helper={t(
              'studio:pages.field.visibleHint',
              'A hidden page stays reachable at its URL for anyone who has the link.',
            )}
          >
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </FormField>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">
            {t('studio:pages.editor.appearance', 'Appearance')}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <PaddingField
            value={effectivePadding}
            onChange={setPadding}
          />
          <WidthField value={effectiveWidth} onChange={setWidth} />
        </CardBody>
      </Card>

      {/*
        Columns, and only for `page-crud`. This replaced a "Page contents" card
        that existed for every template: on a widget-built page its whole
        content was a sentence saying so plus an "Open page" button, which now
        lives on the preview where it belongs. A card whose body is an apology
        for having no body is worse than no card.
      */}
      {isCrud ? (
        <Card padded={false}>
          <CardHeader>
            <h2 className="text-section text-fg">{t('studio:pages.editor.columns', 'Columns')}</h2>
          </CardHeader>
          <CardBody>
            {document.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner size="sm" />
              </div>
            ) : null}

            {document.isError ? (
              <Alert
                tone="warn"
                title={t('studio:pages.editor.contentUnavailable', 'Page contents could not be loaded')}
                body={t(
                  'studio:pages.editor.contentUnavailableBody',
                  'The details above can still be saved.',
                )}
              />
            ) : null}

            {document.isSuccess && document.data.status !== 'ok' ? (
              <Alert
                tone="warn"
                title={t(
                  'studio:pages.editor.contentInvalid',
                  'This page\u2019s configuration is not readable',
                )}
                body={t(
                  'studio:pages.editor.contentInvalidBody',
                  'It was written by a newer version, or it is malformed. Regenerate the page or delete it.',
                )}
              />
            ) : null}

            {document.isSuccess && document.data.status === 'ok' ? (
              sourceChanged ? (
                // Editing columns that are about to be recomposed away would be
                // work thrown out by the save the admin already has pending.
                <p className="text-body-sm text-fg-muted">
                  {t(
                    'studio:pages.editor.itemsPending',
                    'Save the change above first \u2014 the contents are rebuilt from it.',
                  )}
                </p>
              ) : (
                <ColumnManager
                  columns={columns}
                  onColumnsChange={setColumnsDraft}
                  derived={derived}
                  onDerivedChange={setDerivedDraft}
                  source={{
                    connectionId: document.data.page.source.connectionId,
                    table: document.data.page.source.table ?? null,
                  }}
                />
              )
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/*
        THE CREATE FORM. A `page-crud` page bound to a table: a dashboard has no
        record to create, and an unbound crud page has no columns to offer. The
        card reports its draft here and saves nothing itself — one Save, this
        screen's, for the same reason the Columns card gives up its own.
      */}
      {isCrud && effectiveTable !== null && !sourceChanged && formFacts !== null ? (
        <FormDesignerCard
          stored={storedForm}
          columns={formFacts.columns}
          relations={formFacts.relations}
          {...(formFacts.children === undefined ? {} : { children: formFacts.children })}
          onChange={setFormDraft}
          {...(formFacts.connectionId === null
            ? {}
            : {
                onOpenRules: () => {
                  void navigate({
                    to: '/studio/remap/$connectionId',
                    params: { connectionId: formFacts.connectionId as string },
                  });
                },
              })}
          {...(formFacts.entity === null ? {} : { entity: formFacts.entity })}
        />
      ) : null}

      {/*
        THE FILTERS. Same gate as the designer above — a page bound to a table
        — because the filters are questions about that table's columns.
      */}
      {isCrud && effectiveTable !== null && !sourceChanged && formFacts !== null ? (
        <FiltersCard stored={storedFilters} columns={formFacts.columns} onChange={setFiltersDraft} />
      ) : null}

      {/*
        Derived numbers — arithmetic and rules over the folds the Columns card
        authors. A sibling card rather than a
        section of the one above, because the two answer different questions:
        Columns is "what does this table show", this is "what should be worked
        out from it". Same `isCrud` gate, same single save.
      */}
      {isCrud && document.isSuccess && document.data.status === 'ok' && !sourceChanged ? (
        <Card padded={false}>
          <CardHeader>
            <h2 className="text-section text-fg">
              {t('studio:pages.editor.derived', 'Derived numbers')}
            </h2>
          </CardHeader>
          <CardBody>
            <DerivedNumbersCard
              columns={columns}
              onColumnsChange={setColumnsDraft}
              derived={derived}
              onDerivedChange={setDerivedDraft}
              source={{
                connectionId: document.data.page.source.connectionId,
                table: document.data.page.source.table ?? null,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {/*
        Attachments — the sidecar mode.

        Its reason to exist, and the reason the helper text leads with it, is
        that it needs NO column in the customer's table: the link lives on
        Adminium's side, so it works on a read-only connection and on a table
        the operator would rather not alter. A file column is the other answer
        and is configured per column, in the Columns card above.
      */}
      {showAttachments ? (
        <Card padded={false}>
          <CardHeader>
            <h2 className="text-section text-fg">
              {t('studio:pages.editor.attachments', 'Attachments')}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <FormField
              label={t(
                'studio:pages.attachments.enable',
                'Allow attachments on this table’s records',
              )}
              helper={
                columnMode
                  ? t(
                      'studio:pages.attachments.enableHintColumn',
                      'Files are stored in one column on this table, so they appear in the New and Edit dialogs as well as on each record.',
                    )
                  : `${sidecarReason ?? ''} ${t(
                      'studio:pages.attachments.enableHintSidecar',
                      'Files are linked on Adminium’s side instead. They appear on each record’s page, not in the New dialog.',
                    )}`.trim()
              }
            >
              <Switch
                checked={(attachments !== null && attachments.enabled) || attachmentsPending}
                onCheckedChange={setAttachmentsEnabled}
                data-testid="studio-pages-attachments-enabled"
              />
            </FormField>

            {((attachments !== null && attachments.enabled) || attachmentsPending) &&
            columnMode &&
            connectionId !== null &&
            effectiveTable !== null ? (
              <AttachmentsColumnSetup
                connectionId={connectionId}
                table={effectiveTable}
                baseSnapshotId={attachmentsSchema.data?.snapshotId ?? null}
                existingColumns={attachmentsTableColumns}
                {...(attachments?.column === undefined ? {} : { boundColumn: attachments.column })}
                onBound={bindAttachmentsColumn}
              />
            ) : null}

            {attachments !== null && attachments.enabled ? (
              <>
                {/*
                  Hidden while nothing is configured to point at: with no
                  destination on this instance every file lands on the disk
                  anyway, and a picker whose only entry is "the default" is
                  noise. It reappears the moment a destination exists, or the
                  moment this page already names one.
                */}
                {destinationOptions.length > 0 || attachments.destinationId !== undefined ? (
                  <FormField
                    label={t('studio:pages.attachments.destination', 'Where the files go')}
                    helper={t(
                      'studio:pages.attachments.destinationHint',
                      'Leave this on the default unless this table’s files belong somewhere else.',
                    )}
                  >
                    <Select
                      value={attachments.destinationId ?? ''}
                      onChange={(event) =>
                        setAttachmentsDraft(
                          applyAttachments(attachments, {
                            destinationId: event.target.value === '' ? null : event.target.value,
                          }),
                        )
                      }
                      data-testid="studio-pages-attachments-destination"
                    >
                      <option value="">
                        {t('studio:pages.attachments.destinationDefault', 'The default destination')}
                      </option>
                      <option value={LOCAL_DESTINATION}>
                        {t('studio:pages.attachments.destinationLocal', 'This server’s disk')}
                      </option>
                      {destinationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}

                {/*
                  Not a `FormField`: the chips are a `role="group"`, and a
                  `<label for>` cannot name one. The group is named by
                  `aria-labelledby` against the caption instead.
                */}
                <div className="flex w-full flex-col gap-1.5">
                  <span
                    id={acceptLabelId}
                    className="block text-[12px] font-semibold leading-4 text-fg"
                  >
                    {t('studio:pages.attachments.accept', 'Accepted file types')}
                  </span>
                  <ChoiceChips
                    multiple
                    aria-labelledby={acceptLabelId}
                    options={ATTACHMENT_TYPE_KEYS.map((key) => ({
                      value: key,
                      label: attachmentTypeLabel(key),
                    }))}
                    value={attachments.accept ?? []}
                    onValueChange={(next) =>
                      setAttachmentsDraft(applyAttachments(attachments, { accept: next }))
                    }
                    data-testid="studio-pages-attachments-accept"
                  />
                  <p className="text-[11.5px] leading-4 text-fg-muted">
                    {t(
                      'studio:pages.attachments.acceptHint',
                      'Choosing none accepts everything this workspace allows. A choice here can only narrow that list, never widen it.',
                    )}
                  </p>
                </div>

                <FormField
                  label={t('studio:pages.attachments.maxBytes', 'Largest file (MB)')}
                  helper={t(
                    'studio:pages.attachments.maxBytesHint',
                    'Leave empty to follow the workspace limit. A number here can only lower it.',
                  )}
                >
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    // Shown in whole megabytes because that is the unit an
                    // operator thinks in; a block seeded elsewhere with a
                    // fraction of one keeps its exact byte count until this
                    // field is actually edited.
                    value={
                      attachments.maxBytes === undefined
                        ? ''
                        : String(Math.max(1, Math.round(attachments.maxBytes / MEGABYTE)))
                    }
                    onChange={(event) => {
                      const megabytes = Number.parseInt(event.target.value, 10);
                      setAttachmentsDraft(
                        applyAttachments(attachments, {
                          maxBytes:
                            Number.isFinite(megabytes) && megabytes > 0
                              ? megabytes * MEGABYTE
                              : null,
                        }),
                      );
                    }}
                    data-testid="studio-pages-attachments-max-bytes"
                  />
                </FormField>

                <FormField
                  label={t('studio:pages.attachments.maxCount', 'Most files per record')}
                  helper={t(
                    'studio:pages.attachments.maxCountHint',
                    'Leave empty to accept as many as a record needs.',
                  )}
                >
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    inputMode="numeric"
                    value={attachments.maxCount === undefined ? '' : String(attachments.maxCount)}
                    onChange={(event) => {
                      const count = Number.parseInt(event.target.value, 10);
                      setAttachmentsDraft(
                        applyAttachments(attachments, {
                          // Clamped to what the schema accepts, so a typo
                          // cannot store a block the record page then refuses
                          // to read.
                          maxCount: Number.isFinite(count) && count > 0 ? Math.min(500, count) : null,
                        }),
                      );
                    }}
                    data-testid="studio-pages-attachments-max-count"
                  />
                </FormField>
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </PageEditorLayout>
  );
}
