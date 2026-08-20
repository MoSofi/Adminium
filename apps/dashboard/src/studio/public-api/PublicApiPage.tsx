// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/public-api` — the Studio surface for the scoped public API
 * (28-public-surface.md §3, 28-T13).
 *
 * Three things an operator does here, in the order the page presents them
 * because it is the order they matter:
 *
 *  1. **See whether the surface is reachable at all**, and why not when it is
 *     not. There are TWO switches and they fail differently: level 1 is an env
 *     var plus a restart, level 2 is one click. Collapsing them into a single
 *     "on/off" is what would produce a toggle that appears broken on an
 *     instance that never opted in, so `registered` renders as a stated fact
 *     with the remedy, never as a control.
 *  2. **Author a scope** — what an anonymous browser may read. Written as JSON
 *     and compiled server-side BEFORE it is stored, so a mistake is caught here
 *     by the person who made it rather than by a visitor who cannot read it.
 *     Compile issues are shown in full; the anonymous surface still says
 *     nothing at all (§3.2), and that asymmetry is the point.
 *  3. **Mint keys.** Unlike `adm_sk_`, a publishable secret is RE-READABLE
 *     (§3.3): it lives in a public bundle and has to survive a rebuild months
 *     later. Every reveal is audited server-side.
 *
 * ── WHAT THIS PAGE DELIBERATELY DOES NOT DO ────────────────────────────────
 * It does not offer a scope BUILDER. A scope is an authorization document, and
 * a form that assembles one from checkboxes reads as safer than it is — the
 * operator would stop seeing the predicate they are relying on. JSON in a
 * textarea, compiled and refused loudly, keeps the document the thing they are
 * looking at. A builder is a later decision, not a shortcut.
 */
import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Globe2, KeyRound, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmModal,
  EmptyState,
  FormField,
  IconTile,
  Input,
  Select,
  Switch,
  Textarea,
} from '@adminium/ui';

import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { t } from '../../i18n/t.js';
import {
  PUBLIC_API_QUERY_KEY,
  PUBLIC_KEYS_QUERY_KEY,
  PUBLIC_SCOPES_QUERY_KEY,
  createPublicKey,
  createPublicScope,
  deletePublicScope,
  keyStatusOf,
  keysByScope,
  publicApiStateQuery,
  publicKeysQuery,
  publicScopesQuery,
  revealPublicKey,
  revokePublicKey,
  rotatePublicKey,
  scopeIssuesFrom,
  setPublicApiEnabled,
  sortKeys,
  surfaceStateOf,
  type PublicKeyDto,
  type PublicScopeDto,
  type ScopeIssue,
} from './publicSurfaceApi.js';

/** A starting document, so the first scope is an edit rather than a blank page. */
const SCOPE_TEMPLATE = JSON.stringify(
  {
    version: 1,
    side: 'customer',
    timezone: 'Europe/London',
    resources: [
      {
        ref: 'menu',
        table: 'public.menu_items',
        actions: ['read'],
        expose: ['id', 'name', 'price'],
        where: [{ column: 'available', op: 'eq', value: true }],
        limit: 50,
      },
    ],
  },
  null,
  2,
);

export function PublicApiPage() {
  const queryClient = useQueryClient();
  const [{ data: state }, { data: scopes }, { data: keys }] = useSuspenseQueries({
    queries: [publicApiStateQuery(), publicScopesQuery(), publicKeysQuery()],
  });

  const surface = surfaceStateOf(state);
  const byScope = keysByScope(keys);
  const now = Date.now();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ScopeIssue[]>([]);
  /** The one revealed token, held in state and never cached — see the api module. */
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicScopeDto | null>(null);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PUBLIC_API_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PUBLIC_SCOPES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PUBLIC_KEYS_QUERY_KEY }),
    ]);
  };

  /** One place that turns a thrown request into page state. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await fn();
      await refresh();
    } catch (caught) {
      const found = scopeIssuesFrom(caught);
      if (found.length > 0) setIssues(found);
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
     * PageSurface is the page gutter — `<main>` in AppShell is padding-free, so
     * nothing else can set it. And the title goes in PageActions, NOT an <h1>
     * here: the shell renders one for every route regardless, and a second said
     * the name twice on other pages before they were fixed.
     */
    <PageSurface className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <PageActions
        title={t('studio.publicApi.title', 'Public API')}
        subtitle={t(
          'studio.publicApi.subtitle',
          'Let your own customer- or staff-facing pages read this database, through a scope you define.',
        )}
      />
      <SurfaceCard
        surface={surface}
        origins={state.origins}
        busy={busy}
        onToggle={(enabled) => {
          void run(() => setPublicApiEnabled(enabled));
        }}
      />

      {error !== null && (
        <Alert tone="danger" title={t('studio.publicApi.error', 'Something went wrong')}>
          {error}
        </Alert>
      )}

      {issues.length > 0 && <ScopeIssues issues={issues} />}

      <ScopesCard
        scopes={scopes}
        byScope={byScope}
        busy={busy}
        onCreate={(body) => {
          void run(() => createPublicScope(body));
        }}
        onDelete={setPendingDelete}
      />

      <KeysCard
        keys={sortKeys(keys, now)}
        scopes={scopes}
        now={now}
        busy={busy}
        revealed={revealed}
        onCreate={(body) => {
          void run(async () => {
            const made = await createPublicKey(body);
            setRevealed({ id: made.key.id, token: made.token });
          });
        }}
        onReveal={(id) => {
          void run(async () => {
            const { token } = await revealPublicKey(id);
            setRevealed({ id, token });
          });
        }}
        onRotate={(id) => {
          void run(async () => {
            const made = await rotatePublicKey(id);
            setRevealed({ id, token: made.token });
          });
        }}
        onRevoke={(id) => {
          void run(() => revokePublicKey(id));
        }}
      />

      {pendingDelete !== null && (
        <ConfirmModal
          open
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          title={t('studio.publicApi.scopes.deleteTitle', 'Delete this scope')}
          body={t(
            'studio.publicApi.scopes.deleteBody',
            'Any page using a key bound to this scope stops loading data. Keys are not deleted — revoke them first if that is what you meant.',
          )}
          confirmWord={pendingDelete.name}
          promptLabel={t('studio.publicApi.scopes.deletePrompt', 'Type the scope name to confirm')}
          confirmLabel={t('studio.publicApi.scopes.deleteConfirm', 'Delete scope')}
          cancelLabel={t('studio.publicApi.cancel', 'Cancel')}
          closeLabel={t('studio.publicApi.close', 'Close')}
          onConfirm={async () => {
            const target = pendingDelete;
            setPendingDelete(null);
            await run(() => deletePublicScope(target.id));
          }}
        />
      )}
    </PageSurface>
  );
}

/* ------------------------------------------------------------ the switch */

function SurfaceCard({
  surface,
  origins,
  busy,
  onToggle,
}: {
  surface: ReturnType<typeof surfaceStateOf>;
  origins: string[];
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<Globe2 />} />
        <h2 className="text-section text-fg">
          {t('studio.publicApi.status.heading', 'Status')}
        </h2>
      </CardHeader>
      <CardBody>
        {surface === 'not-registered' ? (
          /*
           * A STATED FACT, not a disabled toggle. The remedy is an env var and
           * a restart, so a control here could only ever look broken.
           */
          <Alert
            tone="info"
            title={t('studio.publicApi.notRegistered.title', 'Not enabled on this server')}
          >
            {t(
              'studio.publicApi.notRegistered.body',
              'Set ADMINIUM_PUBLIC_API_ORIGINS to the exact origins allowed to call it, then restart. Until then these routes are not served at all.',
            )}
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <FormField
              label={t('studio.publicApi.toggle.label', 'Serve the public API')}
              helper={t(
                'studio.publicApi.toggle.hint',
                'Turning this off stops every public request immediately. Nothing is deleted — keys, scopes and data all survive.',
              )}
            >
              <Switch
                checked={surface === 'live'}
                disabled={busy}
                onCheckedChange={onToggle}
                aria-label={t('studio.publicApi.toggle.label', 'Serve the public API')}
              />
            </FormField>
            <div>
              <p className="text-sm text-fg-muted">
                {t('studio.publicApi.origins.label', 'Origins allowed to call it')}
              </p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {origins.map((origin) => (
                  <li key={origin}>
                    <Badge>{origin}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------ compile issues */

function ScopeIssues({ issues }: { issues: ScopeIssue[] }) {
  return (
    <Alert
      tone="danger"
      title={t('studio.publicApi.scopes.issuesTitle', 'This scope did not compile')}
    >
      <ul className="flex flex-col gap-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${String(i)}`}>
            <code>{issue.code}</code>
            {issue.ref !== undefined && <> · {issue.ref}</>}
            {issue.column !== undefined && <> · {issue.column}</>} — {issue.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/* ------------------------------------------------------------------ scopes */

function ScopesCard({
  scopes,
  byScope,
  busy,
  onCreate,
  onDelete,
}: {
  scopes: PublicScopeDto[];
  byScope: Map<string, PublicKeyDto[]>;
  busy: boolean;
  onCreate: (body: {
    connectionId: string;
    side: 'staff' | 'customer';
    name: string;
    document: string;
  }) => void;
  onDelete: (scope: PublicScopeDto) => void;
}) {
  const [name, setName] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [document, setDocument] = useState(SCOPE_TEMPLATE);

  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<ShieldAlert />} />
        <div>
          <h2 className="text-section text-fg">{t('studio.publicApi.scopes.title', 'Scopes')}</h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio.publicApi.scopes.subtitle',
              'A scope is the whole of what a key may reach — the tables, the exact columns, and a filter the caller can narrow but never remove.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {scopes.length === 0 ? (
          <EmptyState
            compact
            title={t('studio.publicApi.scopes.emptyTitle', 'No scopes yet')}
            body={t(
              'studio.publicApi.scopes.emptyBody',
              'Create one below. It is checked against your live schema before it is saved.',
            )}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {scopes.map((scope) => (
              <li key={scope.id} className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{scope.name}</p>
                  <p className="text-sm text-fg-muted">
                    {scope.side} · {scope.timezone} ·{' '}
                    {t('studio.publicApi.scopes.keyCount', '{count, plural, =0 {no keys} one {# key} other {# keys}}', {
                      count: byScope.get(scope.id)?.length ?? 0,
                    })}
                  </p>
                </div>
                <Button
                  variant="destructiveSoft"
                  disabled={busy}
                  onClick={() => {
                    onDelete(scope);
                  }}
                >
                  {t('studio.publicApi.scopes.delete', 'Delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          aria-label={t('studio.publicApi.scopes.formLabel', 'Create a scope')}
          className="mt-6 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate({ connectionId, side: 'customer', name, document });
          }}
        >
          <FormField label={t('studio.publicApi.scopes.nameLabel', 'Name')}>
            <Input
              value={name}
              required
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField label={t('studio.publicApi.scopes.connectionLabel', 'Connection ID')}>
            <Input
              value={connectionId}
              required
              onChange={(event) => {
                setConnectionId(event.target.value);
              }}
            />
          </FormField>
          <FormField
            label={t('studio.publicApi.scopes.documentLabel', 'Scope document')}
            helper={t(
              'studio.publicApi.scopes.documentHint',
              'Compiled against your schema when you save. Every column a caller can reach is listed here and nowhere else.',
            )}
          >
            <Textarea
              mono
              rows={16}
              value={document}
              spellCheck={false}
              onChange={(event) => {
                setDocument(event.target.value);
              }}
            />
          </FormField>
          <div>
            <Button type="submit" disabled={busy}>
              {t('studio.publicApi.scopes.create', 'Create scope')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------- keys */

function KeysCard({
  keys,
  scopes,
  now,
  busy,
  revealed,
  onCreate,
  onReveal,
  onRotate,
  onRevoke,
}: {
  keys: PublicKeyDto[];
  scopes: PublicScopeDto[];
  now: number;
  busy: boolean;
  revealed: { id: string; token: string } | null;
  onCreate: (body: { name: string; scopeId: string }) => void;
  onReveal: (id: string) => void;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [scopeId, setScopeId] = useState('');

  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<KeyRound />} />
        <div>
          <h2 className="text-section text-fg">{t('studio.publicApi.keys.title', 'Keys')}</h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio.publicApi.keys.subtitle',
              'These go in your page’s JavaScript, so anyone can read them. That is expected — a key can only ever do what its scope allows.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {keys.length === 0 ? (
          <EmptyState
            compact
            title={t('studio.publicApi.keys.emptyTitle', 'No keys yet')}
            body={t('studio.publicApi.keys.emptyBody', 'Create a scope first, then mint a key for it.')}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {keys.map((key) => {
              const status = keyStatusOf(key, now);
              return (
                <li key={key.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="text-sm text-fg-muted">
                      <code>{key.prefix}…</code> · {status}
                    </p>
                    {revealed?.id === key.id && (
                      <p className="mt-1 break-all font-mono text-sm" data-testid="revealed-token">
                        {revealed.token}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy || status === 'revoked'}
                      onClick={() => {
                        onReveal(key.id);
                      }}
                    >
                      {t('studio.publicApi.keys.reveal', 'Show key')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy || status === 'revoked'}
                      onClick={() => {
                        onRotate(key.id);
                      }}
                    >
                      {t('studio.publicApi.keys.rotate', 'Rotate')}
                    </Button>
                    <Button
                      variant="destructiveSoft"
                      disabled={busy || status === 'revoked'}
                      onClick={() => {
                        onRevoke(key.id);
                      }}
                    >
                      {t('studio.publicApi.keys.revoke', 'Revoke')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form
          aria-label={t('studio.publicApi.keys.formLabel', 'Create a key')}
          className="mt-6 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate({ name, scopeId });
          }}
        >
          <FormField label={t('studio.publicApi.keys.nameLabel', 'Name')}>
            <Input
              value={name}
              required
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField label={t('studio.publicApi.keys.scopeLabel', 'Scope')}>
            <Select
              value={scopeId}
              required
              onChange={(event) => {
                setScopeId(event.target.value);
              }}
            >
              <option value="">
                {t('studio.publicApi.keys.scopePlaceholder', 'Choose a scope')}
              </option>
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.name}
                </option>
              ))}
            </Select>
          </FormField>
          <div>
            <Button type="submit" disabled={busy || scopes.length === 0}>
              {t('studio.publicApi.keys.create', 'Create key')}
            </Button>
          </div>
        </form>

        {/*
          * REMOVED: a banner telling the operator to grant table permissions
          * under Team → Roles.
          *
          * It was wrong. A publishable key is never an RbacPrincipal (28 D3), so
          * the public routes never consult RBAC at all — the SCOPE is the
          * authorization, and it is the only thing that is. Verified by reading
          * the route (its single mention of `request.can()` is a comment) and
          * empirically: the acceptance run read four tables through a
          * publishable key while no role held a grant for any of them.
          *
          * Sending operators to hand out table permissions they do not need is
          * worse than saying nothing — it widens roles for no reason.
          */}
        <Alert
          className="mt-6"
          tone="info"
          title={t('studio.publicApi.keys.scopeIsAuthTitle', 'The scope is the only permission')}
          icon={<TriangleAlert aria-hidden />}
        >
          {t(
            'studio.publicApi.keys.scopeIsAuthBody',
            'A key can reach exactly what its scope lists and nothing else. It does not use roles or table permissions, and it cannot read anything through the rest of the API.',
          )}
        </Alert>
      </CardBody>
    </Card>
  );
}
