// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/settings` — the Studio settings hub (M5-T05, 09 §8.1), ported from
 * `Settings.dc.html` + `Workspace Settings.dc.html` per the
 * §5 checklist: workspace identity (what `adminium_settings` supports and the
 * app actually reads today — registry key `branding.appName`), the
 * review-then-confirm save modal (09 §7.10: changed fields as key/value
 * rows), one card of cross-links out of the hub (Pages, AI enrichment, Global
 * defaults, translations — one row each), and the danger zone with the
 * type-to-confirm connection delete (the comp's keeper interaction).
 *
 * Identity is a super-admin surface (`system:settings:manage` server-side);
 * admins still get the danger zone (`connections:manage`). The Global-defaults
 * cross-link is likewise super-admin-only — `/settings/defaults` returns the
 * forbidden state for everyone else — so it is hidden from plain admins.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Building2,
  Files,
  Globe2,
  Languages,
  Sparkles,
  TriangleAlert,
  UploadCloud,
} from 'lucide-react';
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
  Switch,
  type KeyValueItem,
} from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import {
  BRANDING_QUERY_KEY,
  deleteBrandingLogo,
  uploadBrandingLogo,
  type BrandingData,
} from '../../app/branding.js';
import { t } from '../../i18n/t.js';
import { OnboardingEntry } from '../../onboarding/OnboardingEntry.js';
import { useAppToasts } from '../../pages/toasts.js';
import type { ConnectionDto } from '../api.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { connectionsQuery, DeleteConnectionModal } from '../hub/ConnectionsHub.js';
import {
  WORKSPACE_SETTINGS_QUERY_KEY,
  putWorkspaceBranding,
  workspaceSettingsQuery,
  type WorkspaceSettingsData,
} from './workspaceApi.js';

const SUPER_ADMIN_ROLE = 'super-admin';

// --- identity form (super admin) ------------------------------------------------

/**
 * A logo edit is STAGED, like every other field on this card: picking a file
 * shows a local preview, and nothing reaches the server until Save. The
 * alternative — uploading on pick — makes one control on a form-shaped card
 * behave unlike the rest of it, so a half-finished edit is already live on
 * every screen of the app while the name beside it is still a draft.
 */
type StagedLogo =
  | { kind: 'keep' }
  /** `previewUrl` is an object URL owned by the form; revoked when it changes. */
  | { kind: 'replace'; file: File; previewUrl: string }
  | { kind: 'remove' };

const KEEP: StagedLogo = { kind: 'keep' };

interface FormValues {
  appName: string;
  showVersion: boolean;
  logo: StagedLogo;
}

function toValues(data: WorkspaceSettingsData): FormValues {
  return {
    appName: data.branding.appName,
    showVersion: data.branding.showVersion,
    logo: KEEP,
  };
}

/** Client-side mirror of the route's cap — a 1 MiB refusal after a 4 MB upload is rude. */
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const LOGO_ACCEPT = LOGO_MIMES.join(',');

/**
 * The logo row: a drop target that doubles as the preview and the file picker,
 * with replace/remove beside it. Purely a controlled input — it stages, the
 * form saves.
 *
 * The tile is the drop zone rather than a separate dashed panel because it is
 * already the shape of the result: the same square the rail reserves, showing
 * what the rail will show.
 */
function LogoField({
  current,
  staged,
  onStage,
  disabled,
}: {
  /** The saved logo URL, or null for the built-in mark. */
  current: string | null;
  staged: StagedLogo;
  onStage: (next: StagedLogo) => void;
  disabled: boolean;
}): ReactNode {
  const toasts = useAppToasts();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // What the tile shows: the staged file, or the saved logo, or nothing.
  const preview =
    staged.kind === 'replace' ? staged.previewUrl : staged.kind === 'remove' ? null : current;

  function pick(file: File | undefined): void {
    if (file === undefined) return;
    // Both checks mirror the route's, so a bad file is refused where it was
    // chosen rather than at the end of a save that also carried other edits.
    if (!LOGO_MIMES.includes(file.type)) {
      toasts.push({
        variant: 'error',
        title: t(
          'studio.settingsHub.identity.logo.badType',
          'Choose a PNG, JPEG, WebP, GIF or SVG image.',
        ),
      });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toasts.push({
        variant: 'error',
        title: t('studio.settingsHub.identity.logo.tooLarge', 'That image is larger than 1 MB.'),
      });
      return;
    }
    onStage({ kind: 'replace', file, previewUrl: URL.createObjectURL(file) });
  }

  return (
    <FormField label={t('studio.settingsHub.identity.logo.label', 'Logo')}>
      {/* The WHOLE row is the target — a 44px tile is a small thing to aim a
          dragged file at, and a drop that lands 10px outside it navigates the
          browser to the image instead. Not a `<button>`: it contains two, and
          nesting them is invalid; the buttons inside are the keyboard path,
          and the click handler skips clicks that came from one of them. */}
      <div
        data-part="branding-logo-dropzone"
        data-dragging={dragging ? '' : undefined}
        onClick={(event) => {
          if (disabled) return;
          if ((event.target as HTMLElement).closest('button') === null) inputRef.current?.click();
        }}
        onDragOver={(event) => {
          // Without preventDefault the browser navigates to the dropped file.
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Only when the pointer leaves the ROW: dragging across the tile or a
          // button fires dragleave on the child and would flicker the state off.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) pick(event.dataTransfer.files[0]);
        }}
        className={
          'flex cursor-pointer items-center gap-3.5 rounded-lg border border-dashed ' +
          'border-border-strong bg-surface-2 p-3.5 transition-colors duration-150 ' +
          'hover:border-fg-subtle data-[dragging]:border-accent data-[dragging]:bg-accent-soft'
        }
      >
        {/* The same square the rail reserves, so the preview is the result. */}
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-surface">
          {preview === null ? (
            <UploadCloud className="size-5 text-fg-subtle" aria-hidden="true" />
          ) : (
            /* Decorative: the field's own "Logo" label names it, and the
               controls beside it say what can be done with it. */
            <img src={preview} alt="" className="size-9 object-contain" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-body-sm font-semibold text-fg">
            {t('studio.settingsHub.identity.logo.drop', 'Drop an image here')}
          </div>
          <p className="mt-0.5 truncate text-caption text-fg-subtle">
            {staged.kind === 'replace'
              ? staged.file.name
              : t(
                  'studio.settingsHub.identity.logo.helper',
                  'PNG, JPEG, WebP, GIF or SVG, up to 1 MB. Replaces the built-in mark everywhere.',
                )}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          data-testid="branding-logo-input"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            // Reset so re-picking the SAME file after a failure still fires.
            event.target.value = '';
          }}
        />

        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {preview === null
            ? t('studio.settingsHub.identity.logo.upload', 'Upload logo')
            : t('studio.settingsHub.identity.logo.replace', 'Replace logo')}
        </Button>

        {staged.kind === 'keep' ? (
          current === null ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onStage({ kind: 'remove' })}
            >
              {t('studio.settingsHub.identity.logo.remove', 'Remove')}
            </Button>
          )
        ) : (
          /* A staged logo cannot be typed back the way a name can, so the one
             way out of it is explicit. */
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onStage(KEEP)}>
            {t('studio.settingsHub.identity.logo.undo', 'Undo')}
          </Button>
        )}
      </div>
    </FormField>
  );
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

  /** Staging owns the object URL: every transition out of `replace` frees it. */
  function stageLogo(next: StagedLogo): void {
    setValues((prev) => {
      if (prev.logo.kind === 'replace') URL.revokeObjectURL(prev.logo.previewUrl);
      return { ...prev, logo: next };
    });
  }
  // Leaving the page mid-edit frees it too — the form is remounted by key on
  // every server change, so this runs more often than an unmount suggests.
  useEffect(() => {
    return () => {
      if (values.logo.kind === 'replace') URL.revokeObjectURL(values.logo.previewUrl);
    };
  }, [values.logo]);

  const nameDirty = values.appName.trim() !== before.appName;
  const versionDirty = values.showVersion !== before.showVersion;
  const logoDirty = values.logo.kind !== 'keep';
  const dirty = nameDirty || versionDirty || logoDirty;

  const appNameInvalid = values.appName.trim().length === 0 || values.appName.trim().length > 60;
  const invalid = appNameInvalid;

  // Review-then-confirm (09 §7.10): the modal lists exactly what changes.
  const change = (beforeValue: string, afterValue: string): string =>
    t('studio.settingsHub.review.change', '{before} → {after}', {
      before: beforeValue,
      after: afterValue,
    });
  const onOff = (on: boolean): string =>
    on ? t('studio.settingsHub.review.shown', 'Shown') : t('studio.settingsHub.review.hidden', 'Hidden');
  const changes: KeyValueItem[] = [];
  if (nameDirty) {
    changes.push({
      label: t('studio.settingsHub.identity.appName.label', 'Application name'),
      value: change(before.appName, values.appName.trim()),
    });
  }
  if (versionDirty) {
    changes.push({
      label: t('studio.settingsHub.identity.showVersion.label', 'Version in the sidebar'),
      value: change(onOff(before.showVersion), onOff(values.showVersion)),
    });
  }
  if (values.logo.kind === 'replace') {
    changes.push({
      label: t('studio.settingsHub.identity.logo.label', 'Logo'),
      // The file's own name is the only honest "after" for bytes.
      value: values.logo.file.name,
    });
  } else if (values.logo.kind === 'remove') {
    changes.push({
      label: t('studio.settingsHub.identity.logo.label', 'Logo'),
      value: t('studio.settingsHub.identity.logo.remove', 'Remove'),
    });
  }

  function save(): void {
    setSaving(true);
    void (async () => {
      try {
        // Bytes first: the branding PUT re-reads the logo for its reply, so
        // this order makes the reply the one true post-save state. When only
        // the logo changed there is no PUT to make, and the logo route's own
        // reply carries the same three fields.
        const staged = values.logo;
        const afterLogo =
          staged.kind === 'replace'
            ? await uploadBrandingLogo(staged.file)
            : staged.kind === 'remove'
              ? await deleteBrandingLogo()
              : null;
        const data =
          nameDirty || versionDirty
            ? await putWorkspaceBranding({
                appName: values.appName.trim(),
                showVersion: values.showVersion,
              })
            : { branding: afterLogo ?? initial.branding };

        queryClient.setQueryData(WORKSPACE_SETTINGS_QUERY_KEY, data);
        // The rail reads the branding query, not this one — without this the
        // wordmark keeps the old name until the next reload.
        queryClient.setQueryData<BrandingData>(BRANDING_QUERY_KEY, (prev) =>
          prev === undefined ? prev : { ...prev, ...data.branding },
        );
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
        {/* `justify-start`: CardHeader's own `justify-between` is for a header
            with a trailing control, and this one has none — left to itself it
            throws the heading to the far edge, away from its icon. */}
        <CardHeader className="flex items-center justify-start gap-3">
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

          <div className="mt-4">
            <LogoField
              current={initial.branding.logoUrl}
              staged={values.logo}
              onStage={stageLogo}
              disabled={saving}
            />
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
            <div className="min-w-0 flex-1">
              <div className="text-body-sm font-bold text-fg">
                {t('studio.settingsHub.identity.showVersion.label', 'Version in the sidebar')}
              </div>
              <p className="mt-0.5 text-caption text-fg-subtle">
                {t(
                  'studio.settingsHub.identity.showVersion.helper',
                  'The build number under the logo. Turn it off to hide which version you run.',
                )}
              </p>
            </div>
            <Switch
              checked={values.showVersion}
              onCheckedChange={(checked) => set('showVersion', checked)}
              aria-label={t('studio.settingsHub.identity.showVersion.label', 'Version in the sidebar')}
            />
          </div>
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
  // Remount on server change so a realtime refetch resets the draft — every
  // field the form owns is in the key, or an edit made elsewhere would leave
  // this one showing a stale value it would then save back.
  return (
    <WorkspaceForm
      key={`${data.branding.appName}|${String(data.branding.showVersion)}`}
      initial={data}
    />
  );
}

// --- danger zone (admin+) -------------------------------------------------------

function DangerZone(): ReactNode {
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const [deleting, setDeleting] = useState<ConnectionDto | null>(null);

  return (
    <Card className="border-danger/30">
      {/* Same `justify-start` as the identity header, same reason. */}
      <CardHeader className="flex items-center justify-start gap-3">
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

// --- cross-links ----------------------------------------------------------------

/**
 * One row of the cross-link card: icon, name + one line of what lives there,
 * and the button that opens it. Rows are siblings under a `divide-y` parent, so
 * the separator is drawn as a top border on every row but the first — which is
 * what keeps the last row from carrying a trailing hairline above the card's
 * own edge, whichever rows the role gates leave out.
 */
function LinkRow({
  icon,
  heading,
  body,
  cta,
  onOpen,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  cta: string;
  onOpen: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-3 px-[var(--card-pad)] py-[calc(var(--card-pad)*0.7)]">
      <IconTile tone="accent" size="md" icon={icon} />
      <div className="min-w-0 flex-1">
        <h3 className="text-section text-fg">{heading}</h3>
        <p className="text-caption text-fg-subtle">{body}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onOpen}>
        {cta}
      </Button>
    </div>
  );
}

// --- page -----------------------------------------------------------------------

export interface StudioSettingsPageProps {
  /** Router-injected: opens `/settings/defaults` (10 §7.3 surface). */
  onOpenGlobalDefaults: () => void;
  onOpenTranslations: () => void;
  /** Router-injected: opens `/studio/settings/ai` (06 §10.1, Admin+). */
  onOpenAiSettings: () => void;
  /** Router-injected: opens `/studio/pages` (08 §2.6 lifecycle surface, Admin+). */
  onOpenPages: () => void;
}

export function StudioSettingsPage({
  onOpenGlobalDefaults,
  onOpenTranslations,
  onOpenAiSettings,
  onOpenPages,
}: StudioSettingsPageProps): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const isSuperAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);

  return (
    <PageSurface width="content" className="flex flex-col gap-4">
      {/* Inside the surface, not a sibling of it: as a fragment peer this
          banner was the first child of <main>, so it ran edge-to-edge above a
          page that starts 28px in — the one screen where the gutter visibly
          did not hold. */}
      <OnboardingEntry bootstrap={bootstrap} />
      {/* The heading lives in the topbar, not the page body: the shell would
          otherwise say "Home" above a page that names itself, and the h1 would
          scroll away from the surface it labels. */}
      <PageActions
        title={t('studio.settingsHub.title', 'Workspace settings')}
        subtitle={t(
          'studio.settingsHub.subtitle',
          'Identity, security and destructive actions for this workspace.',
        )}
      />

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

      {/* One card, one row per destination: four separate cards read as four
          unrelated settings groups when they are all the same thing — a link
          out of this hub. `padded={false}` because the rows carry the
          `--card-pad` themselves, `divide-y` for the hairlines between them. */}
      <Card padded={false} className="divide-y divide-border">
        {/* Pages (/studio/pages) is Admin+ like this hub, so no extra gate here.
            The server's `system:pages:manage` is the real boundary and the page
            itself explains a 403 — better than hiding the entry point from an
            admin who could be granted the permission. It is also the only way
            in now that the avatar menu no longer lists Pages. */}
        <LinkRow
          icon={<Files />}
          heading={t('studio.settingsHub.pagesCard.heading', 'Pages')}
          body={t(
            'studio.settingsHub.pagesCard.body',
            'Add, edit and delete pages, change what each one shows, and reorder the sidebar.',
          )}
          cta={t('studio.settingsHub.pagesCard.cta', 'Manage pages')}
          onOpen={onOpenPages}
        />

        {/* AI enrichment is an Admin+ surface (/studio/settings/ai) — every user who
            can see this page can open it, so it is not gated further here. */}
        <LinkRow
          icon={<Sparkles />}
          heading={t('studio.settingsHub.aiCard.heading', 'AI enrichment')}
          body={t(
            'studio.settingsHub.aiCard.body',
            'Configure an AI provider (or the copy-paste round-trip) to enrich labels, groups and relations.',
          )}
          cta={t('studio.settingsHub.aiCard.cta', 'Open AI settings')}
          onOpen={onOpenAiSettings}
        />

        {/* Global defaults is a super-admin-only surface (/settings/defaults) — hide
            the cross-link from plain admins rather than sending them to a forbidden
            dead-end. */}
        {isSuperAdmin ? (
          <LinkRow
            icon={<Globe2 />}
            heading={t('studio.settingsHub.defaultsCard.heading', 'Appearance & language defaults')}
            body={t(
              'studio.settingsHub.defaultsCard.body',
              'Workspace-wide theme, accent, density and language live under Global defaults.',
            )}
            cta={t('studio.settingsHub.defaultsCard.cta', 'Open global defaults')}
            onOpen={onOpenGlobalDefaults}
          />
        ) : null}

        {/* 23-runtime-translations.md §7. Same super-admin gate and the same
            reason: the page renders the 403 state for anyone else, so hiding
            the cross-link keeps plain admins out of a dead end. */}
        {isSuperAdmin ? (
          <LinkRow
            icon={<Languages />}
            heading={t('studio.settingsHub.translationsCard.heading', 'Languages & translations')}
            body={t(
              'studio.settingsHub.translationsCard.body',
              'Reword anything in Adminium, choose which languages people can pick, and add your own.',
            )}
            cta={t('studio.settingsHub.translationsCard.cta', 'Open translations')}
            onOpen={onOpenTranslations}
          />
        ) : null}
      </Card>

      <DangerZone />
    </PageSurface>
  );
}
