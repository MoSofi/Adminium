/**
 * `page-builder` binding (09-generated-app.md §4.1, §7.11, M7-T06): projects
 * the page envelope onto the `PageBuilder` template renderer and wires
 * persistence through the EXISTING pages APIs — no new server surface:
 *
 *  - SAVE (autosave, 900 ms choreography per §7.10): the authored doc rides in
 *    the canvas layout item's `config.doc` (docState.ts), so a save is the
 *    layout write path the dashboard builder already uses —
 *    `useSaveSharedLayout` (PATCH /pages/:id/layout) when the caller holds
 *    `page:<id>:edit`, else `useSavePersonalLayout` (PUT /me/views/:id/layout)
 *    for a personal draft. Same capability routing as PageDashboardBinding.
 *  - SAVE-AS-VERSION / LIST / RESTORE: saved-views rows carrying a
 *    `{ v: 1, builderDoc }` marker (`POST/GET /pages/:id/views`) — grid-state
 *    views coexist untouched (builderVersionsOf filters).
 *  - Survey/automation commits arrive as forwarded mutate intents; intents
 *    addressed to the builder's own draft (isDraftMutation) fold into the doc
 *    and are NOT routed to the CRUD adapter; real table intents pass through
 *    to `adapters.onEvent` (undo toasts included) AND persist the doc.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Save } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  type AutosaveStatus,
} from '@adminium/ui';

import {
  PageBuilder,
  isDraftMutation,
  type DocRecord,
} from '@adminium/widgets';
import { t } from '../../i18n/t.js';
import { useSavePersonalLayout, useSaveSharedLayout } from '../layout/useLayoutPersistence.js';
import { viewsApi } from '../views/viewsApi.js';
import type { ViewConfig } from '../views/viewsApi.js';
import {
  builderPageStateOf,
  builderVersionConfigOf,
  builderVersionsOf,
  layoutWithDoc,
} from './docState.js';
import type { PageTemplateProps } from '../template-types.js';

/** §7.10 autosave choreography: dirty → (900 ms) → saving → saved pill. */
export const BUILDER_AUTOSAVE_DEBOUNCE_MS = 900;

export function PageBuilderBinding({ page, adapters, canEditLayout }: PageTemplateProps) {
  const pageId = page.id;
  const queryClient = useQueryClient();
  const state = useMemo(() => builderPageStateOf(page), [page]);

  const shared = useSaveSharedLayout(pageId);
  const personal = useSavePersonalLayout(pageId);
  const target = canEditLayout === true ? shared : personal;

  const [doc, setDoc] = useState<DocRecord | null>(state.doc);
  const [autosave, setAutosave] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const dirtyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistDoc = useCallback(
    (next: DocRecord): void => {
      setDoc(next);
      setAutosave('dirty');
      if (dirtyTimer.current !== null) clearTimeout(dirtyTimer.current);
      dirtyTimer.current = setTimeout(() => {
        setAutosave('saving');
        target.save(layoutWithDoc(state, next));
        void target
          .flush()
          .then(() => {
            setAutosave('saved');
            setSavedAt(Date.now());
          })
          .catch(() => setAutosave('error'));
      }, BUILDER_AUTOSAVE_DEBOUNCE_MS);
    },
    [state, target],
  );

  // ── versions (saved-views rows with the builderDoc marker) ────────────────
  const versionsQuery = useQuery({
    queryKey: ['builder-versions', pageId] as const,
    queryFn: () => viewsApi.list(pageId),
  });
  const versions = useMemo(
    () => builderVersionsOf(versionsQuery.data ?? []),
    [versionsQuery.data],
  );

  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [restoreKey, setRestoreKey] = useState(0);

  const saveVersion = useMutation({
    mutationFn: (name: string) =>
      viewsApi.create(pageId, {
        name,
        config: builderVersionConfigOf(
          state.docType,
          doc ?? ({ docType: 'invoice' } as DocRecord),
          Date.now(),
        ) as unknown as ViewConfig,
      }),
    onSuccess: () => {
      setSaveAsOpen(false);
      setVersionName('');
      void queryClient.invalidateQueries({ queryKey: ['builder-versions', pageId] });
    },
  });

  const restoreVersion = useCallback(
    (versionDoc: DocRecord): void => {
      setRestoreKey((current) => current + 1);
      persistDoc(versionDoc);
    },
    [persistDoc],
  );

  return (
    // Gutter + `max-w-page` column come from PageRenderer's `PageSurface`.
    <div className="flex h-full min-h-0 flex-col" data-testid="page-builder-binding">
      <PageBuilder
        key={restoreKey}
        config={page.config}
        {...(doc === null ? {} : { data: { row: doc } })}
        autosave={autosave}
        {...(savedAt === undefined ? {} : { savedAt })}
        onDocChange={persistDoc}
        onEvent={(instanceId, event) => {
          void instanceId;
          // Draft-addressed intents (canvas block order, unbound survey/flow
          // commits) are persistence-only — never real CRUD traffic.
          if (event.type === 'mutate' && isDraftMutation(event)) return;
          return adapters.onEvent(event);
        }}
        toolbarActions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Clock3 className="size-4" aria-hidden="true" />}
                  data-testid="builder-versions-menu"
                >
                  {t('builder.versions', 'Versions')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {versions.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t('builder.versionsEmpty', 'No saved versions yet')}
                  </DropdownMenuItem>
                ) : (
                  versions.map((version) => (
                    <DropdownMenuItem
                      key={version.viewId}
                      data-testid={`builder-version-${version.viewId}`}
                      onSelect={() => restoreVersion(version.doc)}
                    >
                      {version.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Save className="size-4" aria-hidden="true" />}
              data-testid="builder-save-as-version"
              onClick={() => setSaveAsOpen(true)}
            >
              {t('builder.saveAsVersion', 'Save as version')}
            </Button>
          </>
        }
      />

      <Modal open={saveAsOpen} onOpenChange={setSaveAsOpen} size="sm">
        <ModalHeader
          title={t('builder.saveVersionTitle', 'Save a version')}
          subtitle={t('builder.saveVersionBody', 'Snapshots the current document. Restore it any time from Versions.')}
          closeLabel={t('common.close', 'Close')}
        />
        <ModalBody>
          <Input
            aria-label={t('builder.versionName', 'Version name')}
            placeholder={t('builder.versionNamePlaceholder', 'e.g. Before Q3 rates change')}
            value={versionName}
            onChange={(event) => setVersionName(event.currentTarget.value)}
            data-testid="builder-version-name"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setSaveAsOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            loading={saveVersion.isPending}
            disabled={versionName.trim() === ''}
            data-testid="builder-version-save"
            onClick={() => saveVersion.mutate(versionName.trim())}
          >
            {t('common.save', 'Save')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
