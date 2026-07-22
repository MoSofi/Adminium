/**
 * `/api-keys` — API keys & tokens (M10-T06; ports `API Keys.dc.html`).
 *
 * THE ONE-TIME SECRET is the page's whole reason for existing. The server hands
 * back a plaintext key exactly once, at creation, and stores only a SHA-256 hash
 * plus a display `prefix`; nothing can ever retrieve it again. So this page
 * shows the secret in a banner that lives in COMPONENT STATE, never in the query
 * cache, and the list below renders `prefix` + metadata only.
 *
 * PORT NOTES (16-milestones §5 checklist).
 *
 * §5.1 keepers kept: the one-time banner and its exact microcopy ("Copy it now
 * — you won't be able to see it again."), the key table with a masked value +
 * scope chips + last-used stamp, per-row revoke, and the quick-start auth
 * snippet.
 *
 * §5.5 known defects NOT copied:
 *   - **The fake-reveal** (`ia-mapping.md` §4 names it outright: "One-time
 *     secret banner; fake-reveal"). The comp's eye toggle swaps bullets for
 *     UNDERSCORES — it performs a reveal that cannot happen, because the
 *     plaintext is hashed at rest. We pass `kind: 'publishable'` so the widget
 *     renders no eye and no mask: the stored prefix is genuinely public, there
 *     is nothing to hide and nothing to reveal. The affordance is removed
 *     rather than faked.
 *   - **The invented metrics.** The comp's "Requests · 24h — 128k" and "Rate
 *     limit — 5k/min" stat cards have no counterpart in the product; rendering
 *     them would be decoration claiming to be telemetry. The honest stat — how
 *     many keys are live — stays, in the list header, exactly where the comp
 *     also puts it.
 *   - **`sk_live_…`/`sk_test_…` and the live/test env axis.** Adminium keys are
 *     `adm_sk_…` and carry no environment; they carry a ROLE, which is the
 *     thing the comp's env badge was really signalling (blast radius). The
 *     badge shows the role, and the highest-privilege role is danger-toned.
 *
 * Composed from the registered `api-keys-panel` + `code-snippet-block` views
 * (annex §14 `page-api`) over @adminium/ui — no comp markup, no inline styles.
 */
import { useMutation, useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Terminal } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmModal,
  EmptyState,
  FormField,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
} from '@adminium/ui';
import { ApiKeysPanelView, CodeSnippetBlockView, type ApiKeyRecord } from '@adminium/widgets';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import {
  apiKeysQuery,
  createApiKey,
  isActive,
  revokeApiKey,
  roleGrantsQuery,
  rolesQuery,
  sortKeys,
  statusOf,
  type ApiKeyCreateBody,
  type ApiKeyCreateReply,
  type ApiKeyDto,
  type RoleListItem,
} from './apiKeysApi.js';

/** The role whose keys are danger-toned — unlimited authority (07 §3.7). */
const SUPER_ADMIN_SLUG = 'super-admin';

/** Scope chips beyond this are noise; the Roles page owns the full matrix. */
const MAX_SCOPE_CHIPS = 4;

function capScopes(grants: readonly string[]): string[] {
  if (grants.length <= MAX_SCOPE_CHIPS) return [...grants];
  return [
    ...grants.slice(0, MAX_SCOPE_CHIPS),
    t('apiKeys.scopesOverflow', '+{count} more', { count: grants.length - MAX_SCOPE_CHIPS }),
  ];
}

/**
 * `ApiKeyDto` → the widget's `ApiKeyRecord`.
 *
 * `tail: ''` is not an oversight — it is the storage model showing through. The
 * comp's Stripe-style "prefix••••tail" needs the last 4 characters, and we do
 * not have them: only the prefix and a hash were ever stored. Inventing a tail
 * would be inventing secret material.
 */
function toRecord(
  key: ApiKeyDto,
  roleName: string,
  grants: readonly string[] | undefined,
  now: number,
): ApiKeyRecord {
  const status = statusOf(key, now);
  return {
    id: key.id,
    // A dead key must SAY it is dead: the panel has no status column, and a
    // revoked key that looks identical to a live one is a false reassurance.
    name: status === 'active' ? key.name : `${key.name} · ${statusLabel(status)}`,
    env: roleName,
    prefix: key.prefix,
    tail: '',
    scopes: grants === undefined ? [] : capScopes(grants),
    // Nothing to mask: `prefix` IS the public fragment (see the header note).
    kind: 'publishable',
    // A revoked or expired key cannot be revoked again, so the panel must not
    // offer the control. It used to render a Revoke button on every row while
    // the page's handler quietly ignored the dead ones — a click with no confirm
    // modal, no toast and no disabled state, which reads as a broken app.
    revocable: status === 'active',
    // Already epoch ms on both sides — the widget's `formatSince` takes an instant.
    ...(key.lastUsedAt === null ? {} : { lastUsed: key.lastUsedAt }),
  };
}

function statusLabel(status: 'active' | 'revoked' | 'expired'): string {
  switch (status) {
    case 'revoked':
      return t('apiKeys.status.revoked', 'Revoked');
    case 'expired':
      return t('apiKeys.status.expired', 'Expired');
    case 'active':
      return t('apiKeys.status.active', 'Active');
  }
}

// --- create form -------------------------------------------------------------

interface CreateDialogProps {
  roles: readonly RoleListItem[];
  busy: boolean;
  error: string | null;
  onSubmit: (body: { name: string; roleId: string; expiresAt?: number | undefined }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function CreateKeyDialog({ roles, busy, error, onSubmit, open, onOpenChange }: CreateDialogProps): ReactNode {
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const resolvedRoleId = roleId === '' ? (roles[0]?.id ?? '') : roleId;
  const canSubmit = name.trim() !== '' && resolvedRoleId !== '' && !busy;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          setRoleId('');
          setExpiresAt('');
        }
        onOpenChange(next);
      }}
      size="md"
    >
      <ModalHeader
        icon={<KeyRound />}
        title={t('apiKeys.create.title', 'Create API key')}
        subtitle={t('apiKeys.create.description', 'The key acts with the permissions of the role you pick.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form
          id="create-api-key"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            const parsed = expiresAt === '' ? undefined : Date.parse(`${expiresAt}T23:59:59Z`);
            onSubmit({
              name: name.trim(),
              roleId: resolvedRoleId,
              ...(parsed === undefined || Number.isNaN(parsed) ? {} : { expiresAt: parsed }),
            });
          }}
        >
          <FormField label={t('apiKeys.create.name', 'Name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('apiKeys.create.namePlaceholder', 'e.g. Analytics pipeline')}
              maxLength={80}
              autoFocus
            />
          </FormField>

          <FormField
            label={t('apiKeys.create.role', 'Role')}
            required
            helper={t('apiKeys.create.roleHelper', 'Pick the least-privileged role that can do the job.')}
          >
            <Select value={resolvedRoleId} onChange={(event) => setRoleId(event.target.value)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('apiKeys.create.expires', 'Expires')}
            helper={t('apiKeys.create.expiresHelper', 'Leave empty for a key that never expires.')}
          >
            <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </FormField>

          {error === null ? null : (
            <Alert
              tone="danger"
              title={t('apiKeys.create.failed', 'Could not create the key')}
              body={error}
              data-testid="api-keys-create-error"
            />
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form="create-api-key" disabled={!canSubmit} loading={busy}>
          {t('apiKeys.create.submit', 'Create key')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- page --------------------------------------------------------------------

export function ApiKeysPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const { data: keys } = useSuspenseQuery(apiKeysQuery());
  // Tolerant by design (see apiKeysApi.ts): a principal with api-keys:manage but
  // not roles:manage still gets a readable page.
  const roles = useQuery(rolesQuery());

  const [created, setCreated] = useState<ApiKeyCreateReply | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);

  // The panel formats its relative last-used stamps through the Intl layer from
  // this BCP-47 tag (`en_US` → `en-US`; the raw underscore id is not a valid
  // tag and would silently coalesce every locale to en-US).
  const localeTag = tagForLocale(bootstrap.prefs.locale as LocaleId);
  // Captured once per mount: a per-render Date.now() makes every re-render a
  // new "now" and the relative stamps impossible to snapshot.
  const [now] = useState(() => Date.now());

  const roleList = roles.data ?? [];
  const rolesById = useMemo(() => new Map(roleList.map((role) => [role.id, role])), [roleList]);

  // Grants for the roles actually in use — one query per distinct role, not per
  // key. Failure-tolerant: no chips beats a broken page.
  const distinctRoles = useMemo(() => {
    const seen = new Map<string, RoleListItem>();
    for (const key of keys) {
      const role = rolesById.get(key.roleId);
      if (role !== undefined && !seen.has(role.id)) seen.set(role.id, role);
    }
    return [...seen.values()];
  }, [keys, rolesById]);

  const grantQueries = useQueries({
    queries: distinctRoles.map((role) => roleGrantsQuery(role)),
  });
  const grantsByRole = useMemo(() => {
    const map = new Map<string, string[]>();
    distinctRoles.forEach((role, index) => {
      const data = grantQueries[index]?.data;
      if (data !== undefined) map.set(role.id, data);
    });
    return map;
  }, [distinctRoles, grantQueries]);

  const sorted = useMemo(() => sortKeys(keys, now), [keys, now]);
  const activeCount = useMemo(() => keys.filter((key) => isActive(key, now)).length, [keys, now]);

  const records = useMemo(
    () =>
      sorted.map((key) =>
        toRecord(
          key,
          rolesById.get(key.roleId)?.name ?? key.roleId,
          grantsByRole.get(key.roleId),
          now,
        ),
      ),
    [sorted, rolesById, grantsByRole, now],
  );

  const superAdminName = roleList.find((role) => role.slug === SUPER_ADMIN_SLUG)?.name;

  const create = useMutation({
    // THE PLAINTEXT NEVER BECOMES MUTATION DATA.
    //
    // `apiKeysApi.ts` promises the secret "is deliberately NOT written into the
    // react-query cache, because a cached secret is a secret that outlives its
    // one render and rides along with every devtools dump". The QUERY cache was
    // clean; the MUTATION cache was not — `useMutation` stores whatever the
    // mutationFn resolves to, so the key sat in the Devtools "Mutations" tab and
    // in any error reporter that serialises the QueryClient, for the page
    // lifetime plus gcTime.
    //
    // Calling `create.reset()` in `onSuccess` does not fix it: the success state
    // (including `data`) is dispatched AFTER the callbacks run, so the reset is
    // immediately undone. The only durable fix is not to hand the secret over in
    // the first place — it is lifted into component state here and the resolved
    // value carries the id alone. Structural, not a cleanup someone must
    // remember: there is no longer a secret in the mutation result to leak.
    mutationFn: async (body: ApiKeyCreateBody): Promise<{ id: string }> => {
      const reply = await createApiKey(body);
      setCreated(reply);
      return { id: reply.apiKey.id };
    },
    onSuccess: async () => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: apiKeysQuery().queryKey });
    },
  });

  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: async () => {
      setRevoking(null);
      await queryClient.invalidateQueries({ queryKey: apiKeysQuery().queryKey });
    },
  });

  const rolesUnavailable = roles.isError;

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-title text-fg">
            {t('apiKeys.title', 'API keys & tokens')}
          </h1>
          <p className="text-body-sm text-fg-muted">
            {t('apiKeys.subtitle', 'Manage programmatic access to your workspace.')}
          </p>
        </div>
        <div className="ms-auto">
          <Button
            iconLeft={<Plus className="size-4" />}
            onClick={() => setCreateOpen(true)}
            disabled={rolesUnavailable || roleList.length === 0}
            data-testid="api-keys-create"
          >
            {t('apiKeys.createButton', 'Create key')}
          </Button>
        </div>
      </div>

      {rolesUnavailable ? (
        <Alert
          tone="warn"
          data-testid="api-keys-roles-unavailable"
          title={t('apiKeys.rolesUnavailable.title', 'Roles are not visible to you')}
          body={t(
            'apiKeys.rolesUnavailable.body',
            'Creating a key means choosing the role it acts as, and your account cannot read the role list. Ask an administrator for the “Manage roles” permission.',
          )}
        />
      ) : null}

      <Card padded={false}>
        <CardHeader className="flex items-center gap-3">
          <h2 className="text-section flex-1 text-fg">{t('apiKeys.list.title', 'Keys')}</h2>
          <span className="text-body-sm text-fg-subtle" data-testid="api-keys-count">
            {t('apiKeys.list.activeCount', '{count, plural, one {# active key} other {# active keys}}', {
              count: activeCount,
            })}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {/* `created === null` is part of the condition, not decoration: the
              one-time secret banner lives INSIDE ApiKeysPanelView, so an
              empty-list branch here would unmount the only copy of a key the
              user can never retrieve again. On an instance with zero keys, POST
              /api-keys returns 201 with the plaintext while `keys` is still []
              until the refetch resolves — and if that GET fails (500, a network
              blip) or lags behind a replica, records.length stays 0 forever.
              The old ternary rendered the EmptyState, the banner never mounted,
              and a live credential existed that nobody held, with no error to
              explain it. Once a key has been created this render keeps the
              panel (which shows the banner above however many rows it has,
              including none). */}
          {records.length === 0 && created === null ? (
            <EmptyState
              compact
              preset="no-data"
              icon={<KeyRound />}
              title={t('apiKeys.empty.title', 'No API keys yet')}
              body={t('apiKeys.empty.body', 'Create one to call the Adminium API from your own code.')}
              data-testid="api-keys-empty"
            />
          ) : (
            <ApiKeysPanelView
              testId="api-keys-panel"
              keys={records}
              now={now}
              locale={localeTag}
              {...(superAdminName === undefined ? {} : { liveEnv: superAdminName })}
              {...(created === null ? {} : { revealedSecret: created.key })}
              revealedTitle={t('apiKeys.revealed.title', 'New key created')}
              revealedBody={t(
                'apiKeys.revealed.body',
                "Copy it now — you won't be able to see it again.",
              )}
              copyLabel={t('apiKeys.copy', 'Copy')}
              copiedLabel={t('apiKeys.copied', 'Copied')}
              revokeLabel={t('apiKeys.revoke', 'Revoke key')}
              neverUsedLabel={t('apiKeys.neverUsed', 'Never used')}
              lastUsedLabel={t('apiKeys.lastUsed', 'Last used {since}')}
              onRevoke={(record) => {
                const match = keys.find((key) => key.id === record.id);
                if (match !== undefined && isActive(match, now)) setRevoking(match);
              }}
            />
          )}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader className="flex items-start gap-3">
          <IconTile tone="accent" size="md" icon={<Terminal />} />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-section text-fg">{t('apiKeys.quickStart.title', 'Quick start')}</h2>
            <p className="text-body-sm text-fg-muted">
              {t(
                'apiKeys.quickStart.body',
                'Authenticate requests with your key in the Authorization header.',
              )}
            </p>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <CodeSnippet />
        </CardBody>
      </Card>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) create.reset();
        }}
        roles={roleList}
        busy={create.isPending}
        error={create.error === null ? null : create.error.message}
        onSubmit={(body) => create.mutate(body)}
      />

      {revoking === null ? null : (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          data-testid="api-keys-revoke-confirm"
          title={t('apiKeys.revokeConfirm.title', 'Revoke API key')}
          body={t(
            'apiKeys.revokeConfirm.body',
            'Any code still calling the API with “{name}” starts failing immediately. This cannot be undone.',
            { name: revoking.name },
          )}
          confirmWord={revoking.name}
          promptLabel={t('apiKeys.revokeConfirm.prompt', 'Type “{name}” to confirm', {
            name: revoking.name,
          })}
          confirmLabel={t('apiKeys.revokeConfirm.confirm', 'Revoke key')}
          cancelLabel={t('common.cancel', 'Cancel')}
          closeLabel={t('common.close', 'Close')}
          busy={revoke.isPending}
          onConfirm={async () => {
            await revoke.mutateAsync(revoking.id);
          }}
        />
      )}

    </div>
  );
}

/**
 * The quick-start snippet. Deliberately shows `adm_sk_…` truncated rather than a
 * real key: a copy-paste-ready snippet containing someone's live secret is how
 * secrets end up in shell history and screenshots.
 */
function CodeSnippet(): ReactNode {
  const code = [
    'curl https://your-instance.example/api/v1/tables \\',
    '  -H "Authorization: Bearer adm_sk_••••••••"',
  ].join('\n');
  return (
    <CodeSnippetBlockView
      code={code}
      language="bash"
      copyLabel={t('apiKeys.copy', 'Copy')}
      copiedLabel={t('apiKeys.copied', 'Copied')}
      testId="api-keys-snippet"
    />
  );
}
