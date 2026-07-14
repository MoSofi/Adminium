/**
 * `/studio/settings` — the Studio settings hub (M5-T05, 09 §8.1), ported from
 * `designs/Settings.dc.html` + `designs/Workspace Settings.dc.html` per the
 * §5 checklist: workspace identity (what `adminium_settings` supports and the
 * app actually reads today — registry key `branding.appName`), the
 * review-then-confirm save modal (09 §7.10: changed fields as key/value
 * rows), a cross-link card to Global defaults, and the danger zone with the
 * type-to-confirm connection delete (the comp's keeper interaction).
 *
 * Identity is a super-admin surface (`system:settings:manage` server-side);
 * admins still get the danger zone (`connections:manage`). The Global-defaults
 * cross-link is likewise super-admin-only — `/settings/defaults` returns the
 * forbidden state for everyone else — so it is hidden from plain admins.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Building2, Globe2, Sparkles, TriangleAlert } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  IconTile,
  Input,
  KeyValueList,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  type KeyValueItem,
} from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import type { ConnectionDto } from '../api.js';
import { connectionsQuery, DeleteConnectionModal } from '../hub/ConnectionsHub.js';
import {
  WORKSPACE_SETTINGS_QUERY_KEY,
  putWorkspaceBranding,
  workspaceSettingsQuery,
  type WorkspaceSettingsData,
} from './workspaceApi.js';

const SUPER_ADMIN_ROLE = 'super-admin';

// --- identity form (super admin) ------------------------------------------------

interface FormValues {
  appName: string;
}

function toValues(data: WorkspaceSettingsData): FormValues {
  return { appName: data.branding.appName };
}

function WorkspaceForm({ initial }: { initial: WorkspaceSettingsData }): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [values, setValues] = useState<FormValues>(() => toValues(initial));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const before = toValues(initial);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const dirty = values.appName.trim() !== before.appName;

  const appNameInvalid = values.appName.trim().length === 0 || values.appName.trim().length > 60;
  const invalid = appNameInvalid;

  // Review-then-confirm (09 §7.10): the modal lists exactly what changes.
  const change = (beforeValue: string, afterValue: string): string =>
    t('studio.settingsHub.review.change', '{before} → {after}', {
      before: beforeValue,
      after: afterValue,
    });
  const changes: KeyValueItem[] = [];
  if (dirty) {
    changes.push({
      label: t('studio.settingsHub.identity.appName.label', 'Application name'),
      value: change(before.appName, values.appName.trim()),
    });
  }

  function save(): void {
    setSaving(true);
    void (async () => {
      try {
        const data = await putWorkspaceBranding({ appName: values.appName.trim() });
        queryClient.setQueryData(WORKSPACE_SETTINGS_QUERY_KEY, data);
        toasts.push({
          variant: 'success',
          title: t('studio.settingsHub.saved', 'Workspace settings updated'),
        });
        setReviewOpen(false);
      } catch {
        toasts.push({
          variant: 'error',
          title: t('studio.settingsHub.saveFailed', 'Could not save workspace settings. Try again.'),
        });
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<Building2 />} />
          <h3 className="text-section text-fg">
            {t('studio.settingsHub.identity.heading', 'Workspace identity')}
          </h3>
        </CardHeader>
        <CardBody>
          <FormField
            label={t('studio.settingsHub.identity.appName.label', 'Application name')}
            helper={t(
              'studio.settingsHub.identity.appName.helper',
              'Shown in the sidebar, browser title, and emails.',
            )}
            {...(appNameInvalid
              ? { error: t('studio.settingsHub.identity.appName.error', 'Enter a name of at most 60 characters.') }
              : {})}
          >
            <Input value={values.appName} onChange={(event) => set('appName', event.target.value)} />
          </FormField>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button disabled={!dirty || invalid} onClick={() => setReviewOpen(true)}>
          {t('studio.settingsHub.save', 'Save changes')}
        </Button>
      </div>

      <Modal
        size="sm"
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!saving) setReviewOpen(open);
        }}
      >
        <ModalHeader
          title={t('studio.settingsHub.review.title', 'Save workspace settings')}
          subtitle={t('studio.settingsHub.review.subtitle', 'Review your changes before saving.')}
          closeLabel={t('studio.settingsHub.review.close', 'Close')}
        />
        <ModalBody>
          <KeyValueList items={changes} />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={saving} onClick={() => setReviewOpen(false)}>
            {t('studio.settingsHub.review.cancel', 'Cancel')}
          </Button>
          <Button loading={saving} onClick={save}>
            {t('studio.settingsHub.review.confirm', 'Save changes')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function WorkspaceFormLoader(): ReactNode {
  const { data } = useSuspenseQuery(workspaceSettingsQuery());
  // Remount on server change so a realtime refetch resets the draft.
  return <WorkspaceForm key={data.branding.appName} initial={data} />;
}

// --- danger zone (admin+) -------------------------------------------------------

function DangerZone(): ReactNode {
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const [deleting, setDeleting] = useState<ConnectionDto | null>(null);

  return (
    <Card className="border-danger/30">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="danger" size="md" icon={<TriangleAlert />} />
        <div>
          <h3 className="text-section text-fg">
            {t('studio.settingsHub.danger.heading', 'Danger zone')}
          </h3>
          <p className="text-caption text-fg-subtle">
            {t('studio.settingsHub.danger.subtitle', 'Irreversible actions.')}
          </p>
        </div>
      </CardHeader>
      <CardBody className="divide-y divide-border">
        {connections.length === 0 ? (
          <p className="py-2 text-body-sm text-fg-muted">
            {t('studio.settingsHub.danger.empty', 'Nothing to delete — no connections yet.')}
          </p>
        ) : (
          connections.map((connection) => (
            <div key={connection.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-bold text-fg">{connection.name}</div>
                <div className="mt-0.5 text-caption text-fg-subtle">
                  {t(
                    'studio.settingsHub.danger.deleteDesc',
                    'Deletes the connection and its generated pages. Your database is not touched. Cannot be undone.',
                  )}
                </div>
              </div>
              <Button variant="destructiveSoft" size="sm" onClick={() => setDeleting(connection)}>
                {t('studio.settingsHub.danger.deleteCta', 'Delete connection')}
              </Button>
            </div>
          ))
        )}
      </CardBody>
      <DeleteConnectionModal
        connection={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={() => setDeleting(null)}
      />
    </Card>
  );
}

// --- page -----------------------------------------------------------------------

export interface StudioSettingsPageProps {
  /** Router-injected: opens `/settings/defaults` (10 §7.3 surface). */
  onOpenGlobalDefaults: () => void;
  /** Router-injected: opens `/studio/settings/ai` (06 §10.1, Admin+). */
  onOpenAiSettings: () => void;
}

export function StudioSettingsPage({ onOpenGlobalDefaults, onOpenAiSettings }: StudioSettingsPageProps): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const isSuperAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4 p-6">
      <header>
        <h1 className="text-page-title text-fg">
          {t('studio.settingsHub.title', 'Workspace settings')}
        </h1>
        <p className="mt-0.5 text-body-sm text-fg-muted">
          {t('studio.settingsHub.subtitle', 'Identity, security and destructive actions for this workspace.')}
        </p>
      </header>

      {isSuperAdmin ? (
        <WorkspaceFormLoader />
      ) : (
        <Alert
          tone="info"
          title={t('studio.settingsHub.superAdminOnlyTitle', 'Super admin required')}
          body={t(
            'studio.settingsHub.superAdminOnly',
            'Only a super admin can change workspace identity and security settings.',
          )}
        />
      )}

      {/* AI enrichment is an Admin+ surface (/studio/settings/ai) — every user who
          can see this page can open it, so it is not gated further here. */}
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<Sparkles />} />
          <div className="min-w-0 flex-1">
            <h3 className="text-section text-fg">
              {t('studio.settingsHub.aiCard.heading', 'AI enrichment')}
            </h3>
            <p className="text-caption text-fg-subtle">
              {t(
                'studio.settingsHub.aiCard.body',
                'Configure an AI provider (or the copy-paste round-trip) to enrich labels, groups and relations.',
              )}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenAiSettings}>
            {t('studio.settingsHub.aiCard.cta', 'Open AI settings')}
          </Button>
        </CardHeader>
      </Card>

      {/* Global defaults is a super-admin-only surface (/settings/defaults) — hide
          the cross-link from plain admins rather than sending them to a forbidden
          dead-end. */}
      {isSuperAdmin ? (
        <Card>
          <CardHeader className="flex items-center gap-3">
            <IconTile tone="accent" size="md" icon={<Globe2 />} />
            <div className="min-w-0 flex-1">
              <h3 className="text-section text-fg">
                {t('studio.settingsHub.defaultsCard.heading', 'Appearance & language defaults')}
              </h3>
              <p className="text-caption text-fg-subtle">
                {t(
                  'studio.settingsHub.defaultsCard.body',
                  'Workspace-wide theme, accent, density and language live under Global defaults.',
                )}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onOpenGlobalDefaults}>
              {t('studio.settingsHub.defaultsCard.cta', 'Open global defaults')}
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <DangerZone />
    </div>
  );
}
