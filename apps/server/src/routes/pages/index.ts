// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-document + page-lifecycle routes (08-server-api.md §2.6,
 * 04-widget-registry.md §6.3):
 *
 *   GET    /api/v1/pages                 → the Studio manager list
 *   POST   /api/v1/pages                 → create a page
 *   GET    /api/v1/pages/:pageId         → { data: <page envelope> }
 *   PATCH  /api/v1/pages/:pageId         → title / slug / icon / nav / enabled
 *   PATCH  /api/v1/pages/:pageId/config  → the per-template config body
 *   PATCH  /api/v1/pages/:pageId/layout  → write the SHARED default layout
 *   POST   /api/v1/pages/:pageId/duplicate
 *   DELETE /api/v1/pages/:pageId
 *   PUT    /api/v1/pages/nav-order       → bulk sidebar reorder
 *
 * The dashboard's PageRenderer fetches the stored envelope by the id it got
 * from the bootstrap nav tree and runs client-side config migrations
 * (09-generated-app.md §2.3/§3). On read the server resolves `config.layout`:
 * a per-user override (an `adminium_views` row, `kind: 'layout'`) wins over the
 * shared `adminium_pages` default; otherwise the envelope is returned verbatim.
 *
 * TWO DIFFERENT GATES, deliberately:
 *
 * - Reading and editing ONE page's stored document rides the per-page grants
 *   `page:<id>:view` / `page:<id>:edit` — the same grants the bootstrap nav
 *   filter applies, so the nav never links to a 403, and the same
 *   `page:<id>:edit` the client reads back as `canEditLayout` to route a
 *   builder save to the shared default vs. a personal override.
 * - Changing WHICH pages exist — create, rename, retemplate, duplicate,
 *   delete, reorder the rail — rides the workspace-scoped
 *   `system:pages:manage`. It is not a per-page question: there is no page id
 *   to scope a create against, and a reorder writes every sibling at once.
 *
 * Every mutation is audited and publishes `config-changed` so open dashboards
 * refetch the nav instead of holding a stale sidebar until reload.
 */

import {
  composeRequestedPage,
  isTableBoundTemplate,
  parseDatabaseModel,
} from '@adminium/engine';
import { pageEnvelopeSchema, type PagePaddingConfig } from '@adminium/engine/config';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  newId,
  pagesRepo,
  permissionsRepo,
  snapshotsRepo,
  viewsRepo,
  type MetaDb,
  type Page,
} from '@adminium/meta';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../errors.js';
import { buildUserPageEnvelope, defaultIconFor, reidentifyEnvelope } from './envelope.js';
import { pageLayoutSchema } from './layout-schema.js';
import {
  okReply,
  pageConfigPatchBody,
  pageCreateBody,
  pageDuplicateBody,
  pageLayoutPatchBody,
  pageLayoutReply,
  pageListReply,
  pageMutationReply,
  pageNavOrderBody,
  pageNavOrderReply,
  pageParams,
  pagePatchBody,
  pageReply,
} from './schema.js';

export interface PagesRoutesDeps {
  meta: MetaDb;
}

/** The acting session user id, or null for keyless/API-key principals. */
function sessionUserId(request: FastifyRequest): string | null {
  if (request.apiKeyPrincipal !== null && request.apiKeyPrincipal !== undefined) return null;
  return (request as unknown as { user?: { id?: string } }).user?.id ?? null;
}

/** The `GET /pages` row shape, from a full page row. */
function toSummary(page: Page): {
  id: string;
  connectionId: string | null;
  slug: string;
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  origin: string;
  manifestId: string | null;
  isEnabled: boolean;
  revision: number;
  updatedAt: number;
} {
  return {
    id: page.id,
    connectionId: page.connectionId,
    slug: page.slug,
    type: page.type,
    title: page.title,
    icon: page.icon,
    navGroup: page.navGroup,
    navOrder: page.navOrder,
    origin: page.origin,
    manifestId: page.manifestId,
    isEnabled: page.isEnabled,
    revision: page.revision,
    updatedAt: page.updatedAt,
  };
}

export function pagesRoutes(deps: PagesRoutesDeps): FastifyPluginAsyncZod {
  const pages = pagesRepo(deps.meta);
  const views = viewsRepo(deps.meta);
  const permissions = permissionsRepo(deps.meta);

  return async (app) => {
    /**
     * Tell every open client the nav changed. `configVersion` is `max(updatedAt)`
     * over all pages, which the client uses to drop stale page caches (09 §2.1).
     * Guarded because the minimal read-only harness mounts these routes without
     * the realtime plugin.
     */
    async function publishConfigChanged(connectionId: string | null): Promise<void> {
      if (!app.hasDecorator('realtime')) return;
      app.realtime.publish('config-changed', 'config-changed', {
        connectionId,
        configVersion: await pages.configVersion(),
      });
    }

    /**
     * Reject a slug any other page already holds — GLOBALLY, not per
     * connection.
     *
     * The database index is `uq_adminium_pages_conn_slug`, i.e. per-connection,
     * and that is deliberately NOT the rule enforced here. Routing is global:
     * `/p/$slug` is resolved client-side by `findNavItemBySlug`, a
     * first-match-wins scan over the whole flattened nav tree. So two pages
     * sharing a slug across connections — or a connection-less page colliding
     * with a generated one — are not a storage problem, they are a page that
     * silently becomes unreachable because its sibling is found first.
     *
     * The index cannot express this anyway: NULLs are distinct in a unique
     * index on all three dialects, so connection-less pages have no
     * database-level uniqueness at all. Checking here also turns what would be
     * a raw driver error into a typed 409 the UI can attach to the field.
     */
    async function assertSlugFree(slug: string, exceptPageId?: string): Promise<void> {
      const clash = (await pages.listAll()).find(
        (row) => row.slug === slug && row.id !== exceptPageId,
      );
      if (clash === undefined) return;
      throw new ConflictError(
        `The address "${slug}" is already used by another page.`,
        'UNIQUE_VIOLATION',
        { slug, pageId: clash.id },
      );
    }

    /**
     * Compose a page body from a real table, via the Engine's own pipeline.
     *
     * Shared by create and patch so a page bound at birth and a page rebound
     * later are byte-identical documents. Throws a 422 with the Engine's own
     * reason when the table cannot back this template — the picker offers every
     * table, but not every table has, say, the date columns a calendar needs.
     */
    async function composeForTable(input: {
      pageId: string;
      connectionId: string;
      table: string;
      template: string;
      slug: string;
      title: string;
      navGroup: string;
      navIcon: string;
      navOrder: number;
    }): Promise<Record<string, unknown>> {
      // Existence is checked on the row rather than through `connectionsRepo`,
      // which needs the DSN crypto this route has no business holding — nothing
      // here reads or decrypts a connection string.
      const connection = await deps.meta.db
        .selectFrom('adminium_connections')
        .select(['id'])
        .where('id', '=', input.connectionId)
        .executeTakeFirst();
      if (connection === undefined) {
        throw new ValidationFailedError('That data source no longer exists.', {
          connectionId: input.connectionId,
        });
      }
      const snapshot = await snapshotsRepo(deps.meta).latest(input.connectionId);
      if (snapshot === null) {
        throw new ValidationFailedError(
          'This connection has not been analysed yet. Run introspection from Studio → Data connections first.',
          { connectionId: input.connectionId },
        );
      }

      const built = composeRequestedPage(
        parseDatabaseModel(snapshot.schema),
        input.table,
        input.template,
        {
          connectionId: input.connectionId,
          id: input.pageId,
          slug: input.slug,
          navGroup: input.navGroup as 'workspace' | 'library' | 'planning' | 'people' | 'account',
          navIcon: input.navIcon,
          navOrder: input.navOrder,
        },
      );
      if (built.envelope === null) {
        throw new ValidationFailedError(
          built.reason === ''
            ? 'This page cannot be built from that table.'
            : `This page cannot be built from that table: ${built.reason}`,
          { template: input.template, table: input.table },
        );
      }

      const composed = { ...built.envelope };

      // The Engine titles a composed page after its TABLE. The admin typed a
      // title, and on create there is no later mirror pass to restore it.
      const title = composed['title'];
      composed['title'] =
        typeof title === 'object' && title !== null
          ? { ...(title as Record<string, unknown>), fallback: input.title }
          : { key: `nav.${input.slug}`, fallback: input.title };

      // The composed document carries a fresh `generatedHash`, which would tell
      // the next generation run this page is byte-identically regenerable and
      // therefore safe to overwrite or prune. It is not — an admin chose this
      // template and table by hand. Dropping the hash restores the "edited"
      // reading (`isEditedEnvelope` treats a hashless document as untouched),
      // so the choice survives regeneration.
      const body = composed['config'];
      if (typeof body === 'object' && body !== null) {
        const hashless = { ...(body as Record<string, unknown>) };
        delete hashless['generatedHash'];
        composed['config'] = hashless;
      }
      return composed;
    }

    /**
     * Rebuild a page's body when the admin changed its template or its bound
     * table — the "this page shows nothing useful" fix.
     *
     * Retemplating cannot be a column write. The per-template bodies are
     * different documents: `page-crud` stores `{columns, detail, form}` derived
     * from a table's classified schema, the nine archetypes store
     * `{layout, toolbar, overlays}` of composed widget instances. Flipping
     * `type` alone leaves the old body in place, so the new renderer finds
     * nothing it understands and the page renders empty — which is exactly the
     * state a hand-created `page-crud` is stuck in today, since nothing has
     * ever bound it to a table.
     *
     * So a template/table change re-runs the Engine's own composition against
     * the connection's active snapshot, the same machinery `generatePages` uses,
     * and returns a full replacement envelope. Returns `{}` when nothing that
     * affects the body changed, so an ordinary rename stays a cheap column write
     * and never touches the document.
     */
    /** The page's stored envelope, or an empty document if the row has none. */
    function currentEnvelope(page: Page): Record<string, unknown> {
      return typeof page.config === 'object' && page.config !== null
        ? (page.config as Record<string, unknown>)
        : {};
    }

    /**
     * Sets or clears the envelope's page-gutter override. Null deletes the key
     * rather than storing a null, so a cleared page is byte-identical to one
     * that never had an override and reads as the template default everywhere.
     */
    function applyPadding(
      envelope: Record<string, unknown>,
      padding: PagePaddingConfig | null,
    ): Record<string, unknown> {
      if (padding === null) {
        const rest = { ...envelope };
        delete rest['padding'];
        return rest;
      }
      return { ...envelope, padding };
    }

    async function recomposeIfRequested(
      page: Page,
      next: {
        template?: string;
        table?: string | null;
        connectionId?: string | null;
        slug?: string;
        title?: string;
        navGroup?: string | null;
        icon?: string | null;
      },
    ): Promise<{ type?: string; connectionId?: string | null; envelope?: Record<string, unknown> }> {
      const envelope =
        typeof page.config === 'object' && page.config !== null
          ? (page.config as Record<string, unknown>)
          : {};
      const source =
        typeof envelope['source'] === 'object' && envelope['source'] !== null
          ? (envelope['source'] as Record<string, unknown>)
          : {};

      const template = next.template ?? page.type;
      const connectionId =
        next.connectionId === undefined ? page.connectionId : next.connectionId;
      const currentTable = typeof source['table'] === 'string' ? source['table'] : null;
      const table = next.table === undefined ? currentTable : next.table;

      const unchanged =
        template === page.type && connectionId === page.connectionId && table === currentTable;
      if (unchanged) return {};

      // Unbinding, or a template whose body is not composed from one table
      // (`page-dashboard` composes from a domain and is edited in the builder;
      // the tool surfaces ignore their body entirely). Record the new type and
      // source but leave the body alone — blanking a dashboard's widgets
      // because its `type` was re-picked would destroy real work.
      if (table === null || connectionId === null || !isTableBoundTemplate(template)) {
        return {
          type: template,
          connectionId,
          envelope: { ...envelope, template, source: { ...source, connectionId, table } },
        };
      }

      return {
        type: template,
        connectionId,
        envelope: await composeForTable({
          pageId: page.id,
          connectionId,
          table,
          template,
          slug: next.slug ?? page.slug,
          title: next.title ?? page.title,
          navGroup: next.navGroup ?? page.navGroup ?? 'library',
          navIcon: next.icon ?? page.icon ?? 'table',
          navOrder: page.navOrder,
        }),
      };
    }

    /**
     * Next free slot at the end of a nav group.
     *
     * Producers use three different strides today (10,11,12… for dashboards,
     * 20,30,40… per-group for crud, 25,35,45… for archetypes), so "append"
     * cannot assume a step — it takes max+1. A reorder renumbers the group
     * densely from 0 afterwards, which is what eventually normalizes the mix.
     */
    async function nextNavOrder(navGroup: string): Promise<number> {
      const rows = await pages.listAll();
      const orders = rows.filter((row) => row.navGroup === navGroup).map((row) => row.navOrder);
      return orders.length === 0 ? 0 : Math.max(...orders) + 1;
    }

    /**
     * Give a new page the access list its siblings already have.
     *
     * Nothing in this product has ever written a `page:` grant — not the
     * generator, not the LLM apply path — so on most installs there are no
     * sibling grants and this is a no-op, exactly matching how a *generated*
     * page behaves. Where an admin HAS hand-built a matrix via
     * `PUT /roles/:id/permissions`, a page created next to those pages
     * inherits their audience instead of silently vanishing from every
     * non-super-admin's sidebar.
     *
     * Union rather than intersection, and view-only: a role that can see any
     * page in this connection can see the new one; edit rights on the stored
     * document stay something an admin grants deliberately.
     */
    async function seedPageGrants(page: Page): Promise<void> {
      const siblings = (await pages.listAll()).filter(
        (row) => row.id !== page.id && row.connectionId === page.connectionId,
      );
      if (siblings.length === 0) return;
      const roleIds = new Set<string>();
      for (const sibling of siblings) {
        for (const grant of await permissions.listForResource('page', sibling.id)) {
          if ((grant.actions as { view?: boolean }).view === true) roleIds.add(grant.roleId);
        }
      }
      for (const roleId of roleIds) {
        await permissions.grant(roleId, 'page', page.id, { view: true, edit: false });
      }
    }

    app.get(
      '/pages/:pageId',
      {
        preHandler: app.requireAuth,
        schema: {
          params: pageParams,
          response: { 200: pageReply },
        },
      },
      async (request) => {
        const page = await pages.findById(request.params.pageId);
        if (page === null || !page.isEnabled) {
          throw new NotFoundError(`page ${request.params.pageId} does not exist`);
        }

        // View gate (09 §2.1): the same `page:<id>:view` grant the bootstrap
        // nav filter applies (super-admins bypass inside `request.can`). The
        // `typeof` guard covers the rbac-less minimal read-only harness.
        //
        // `system:pages:manage` also opens the door, and has to: the Studio
        // page manager edits a page's stored config through this document, and
        // page-view grants are per-page and hand-assigned. Without this an
        // admin who may DELETE a page could not read it — the manager's item
        // editor would 403 on exactly the pages it exists to fix. Strictly
        // narrower than the mutation it enables.
        if (
          typeof request.can === 'function' &&
          !(await request.can(`page:${page.id}:view`)) &&
          !(await request.can('system:pages:manage'))
        ) {
          throw new ForbiddenError(
            'You do not have permission to view this page.',
            'PAGE_FORBIDDEN',
            { pageId: page.id },
          );
        }

        // Per-page edit capability (§6.3): the SAME `page:<id>:edit` grant the
        // PATCH is gated on (super-admins bypass). The dashboard builder uses
        // this — never role slugs — to route edits to the shared default vs. a
        // personal override, so it matches the server exactly. Guarded for the
        // minimal read-only harness that mounts this route without rbacPlugin.
        const canEditLayout =
          typeof request.can === 'function' ? await request.can(`page:${page.id}:edit`) : false;

        // Layout resolution (§6.3): a per-user override wins over the shared
        // default baked into the envelope's `config.layout`. Only applies when
        // the caller is a session user and their override parses as a valid
        // layout document; anything else falls back to the stored default.
        const userId = sessionUserId(request);
        if (userId !== null && typeof page.config === 'object' && page.config !== null) {
          const override = await views.findLayoutOverride(page.id, userId);
          if (override !== null) {
            const parsed = pageLayoutSchema.safeParse(override.config);
            if (parsed.success) {
              const envelope = page.config as Record<string, unknown>;
              const templateConfig =
                typeof envelope['config'] === 'object' && envelope['config'] !== null
                  ? (envelope['config'] as Record<string, unknown>)
                  : {};
              // Staleness signal: the PUT stamped the shared document's
              // revision into the override; the default moving past it —
              // regeneration or a shared PATCH — means this caller keeps a
              // pre-change layout (after a schema-driven regeneration that is
              // per-widget WIDGET_DATA errors with no hint). Flag it so the
              // client can offer "Reset layout". Pre-stamp rows read as fresh.
              const authoredAt = (override.config as Record<string, unknown>)['pageRevision'];
              const layoutStale = typeof authoredAt === 'number' && authoredAt < page.revision;
              return {
                data: { ...envelope, config: { ...templateConfig, layout: parsed.data } },
                canEditLayout,
                ...(layoutStale ? { layoutStale: true } : {}),
              };
            }
          }
        }
        return { data: page.config, canEditLayout };
      },
    );

    app.patch(
      '/pages/:pageId/layout',
      {
        preHandler: app.requireAuth,
        schema: {
          params: pageParams,
          body: pageLayoutPatchBody,
          response: { 200: pageLayoutReply },
        },
      },
      async (request) => {
        const { pageId } = request.params;
        const page = await pages.findById(pageId);
        if (page === null || !page.isEnabled) {
          throw new NotFoundError(`page ${pageId} does not exist`);
        }

        // Shared-default writes need page-EDIT (Admin+); super-admins bypass.
        if (!(await request.can(`page:${pageId}:edit`))) {
          throw new ForbiddenError(
            'You do not have permission to edit this page.',
            'PAGE_FORBIDDEN',
            { pageId },
          );
        }

        const updated = await pages.setLayout(pageId, request.body, app.rbac.now());
        if (updated === null) {
          throw new NotFoundError(`page ${pageId} does not exist`);
        }

        await app.rbac.audit(request, {
          category: 'data',
          action: 'page.layout.update',
          changes: { after: { pageId, items: request.body.items.length } },
        });

        // The shared default is what every viewer sees, so an open tab holding
        // the previous layout is stale. Historically this route published
        // nothing and other tabs simply kept the old grid until reload.
        await publishConfigChanged(page.connectionId);

        return { data: { layout: request.body } };
      },
    );

    // --- lifecycle surface ---------------------------------------------------
    //
    // Everything above mounts in the minimal read-only harness, which registers
    // this module WITHOUT `rbacPlugin` — hence the `typeof request.can ===
    // 'function'` guards in the GET. The lifecycle routes cannot degrade the
    // same way: `app.rbac.require` resolves at REGISTRATION time (it validates
    // the permission string and throws on an unknown one), so calling it
    // unconditionally would make the whole module fail to load without the
    // plugin.
    //
    // The guard is on the PREHANDLER, not on registration. An earlier version
    // returned early instead, which un-registered all nine routes — and a
    // missing route is the worst possible failure here, because `404 Route
    // GET:/api/v1/pages not found` is exactly what a stale deployment looks
    // like too. There is no way to tell "your server predates this feature"
    // from "your server has it but declined to mount it". Always registering
    // and refusing with a 403 keeps those two cases distinguishable, and is
    // still fail-closed: no RBAC, no page management.
    const requireManage: preHandlerHookHandler = app.hasDecorator('rbac')
      ? app.rbac.require('system:pages:manage')
      : async () => {
          throw new ForbiddenError(
            'Page management is unavailable because this server has no permission system loaded.',
            'FORBIDDEN',
          );
        };

    app.get(
      '/pages',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: { response: { 200: pageListReply } },
      },
      async () => ({ data: await pages.listAll() }),
    );

    app.post(
      '/pages',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: { body: pageCreateBody, response: { 200: pageMutationReply } },
      },
      async (request) => {
        const body = request.body;
        const connectionId = body.connectionId ?? null;
        await assertSlugFree(body.slug);

        // Mint the id first: the envelope embeds its own id (01 §6.1), so the
        // document cannot be built until the row id is known. `newId` gives a
        // `page_<ULID>` rather than the generator's deterministic
        // `page_<hash>_<slug>` on purpose — a user page squatting on a
        // generator id would land in `upsertGenerated`'s `preserved` list
        // forever, silently blocking that generated page from materializing.
        const id = newId('page');
        const navOrder = await nextNavOrder(body.navGroup);

        // Bound at creation when a table was chosen, so a new `page-crud` opens
        // with real columns instead of the empty grid it would otherwise be
        // stuck in until someone found the editor. Unbound pages still get the
        // valid-but-empty frame — a blank dashboard is a legitimate thing to
        // want, and the non-table-bound templates only have that.
        const bindable =
          connectionId !== null &&
          body.table !== null &&
          body.table !== undefined &&
          isTableBoundTemplate(body.template);

        const composedEnvelope = bindable
          ? await composeForTable({
              pageId: id,
              connectionId,
              table: body.table as string,
              template: body.template,
              slug: body.slug,
              title: body.title,
              navGroup: body.navGroup,
              navIcon: body.icon ?? defaultIconFor(body.template),
              navOrder,
            })
          : buildUserPageEnvelope({
              id,
              slug: body.slug,
              title: body.title,
              template: body.template,
              navGroup: body.navGroup,
              navOrder,
              icon: body.icon ?? null,
              connectionId,
              table: body.table ?? null,
            });

        // A gutter chosen on the New page screen. `null` and absent both mean
        // "template default", so neither writes a key.
        const envelope =
          body.padding === undefined || body.padding === null
            ? composedEnvelope
            : applyPadding(composedEnvelope, body.padding);

        const page = await pages.create(
          {
            id,
            connectionId,
            slug: body.slug,
            type: body.template,
            title: body.title,
            icon: (envelope['nav'] as { icon: string }).icon,
            navGroup: body.navGroup,
            navOrder,
            config: envelope,
            origin: 'user',
            createdBy: sessionUserId(request),
          },
          app.rbac.now(),
        );

        await seedPageGrants(page);

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.create',
          ...(connectionId === null ? {} : { connectionId }),
          changes: {
            after: { pageId: page.id, slug: page.slug, template: page.type, navGroup: page.navGroup },
          },
        });
        await publishConfigChanged(connectionId);
        return { data: toSummary(page) };
      },
    );

    /**
     * `PUT /pages/nav-order` — bulk sidebar reorder.
     *
     * Registered BEFORE `/pages/:pageId`-shaped mutations would be a concern
     * only if it shared their method; it does not. It takes the whole rail
     * because one drag renumbers every sibling, and a partial write is a
     * visibly scrambled sidebar.
     */
    app.put(
      '/pages/nav-order',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: { body: pageNavOrderBody, response: { 200: pageNavOrderReply } },
      },
      async (request) => {
        const moved = await pages.reorderNav(
          request.body.items.map((item) => ({ id: item.pageId, navGroup: item.navGroup })),
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.nav.reorder',
          changes: { after: { pages: request.body.items.length, moved } },
        });
        await publishConfigChanged(null);
        return { data: { moved } };
      },
    );

    app.patch(
      '/pages/:pageId',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: {
          params: pageParams,
          body: pagePatchBody,
          response: { 200: pageMutationReply },
        },
      },
      async (request) => {
        const { pageId } = request.params;
        const { expectedRevision, ...patch } = request.body;
        // Unlike the render path this deliberately does NOT require
        // `isEnabled`: a disabled page is exactly the one an admin needs to
        // reach in order to re-enable it.
        const page = await pages.findById(pageId);
        if (page === null) throw new NotFoundError(`page ${pageId} does not exist`);

        if (patch.slug !== undefined && patch.slug !== page.slug) {
          await assertSlugFree(patch.slug, pageId);
        }

        const { template, table, connectionId, padding, ...meta } = patch;
        const recomposed = await recomposeIfRequested(page, {
          ...(template === undefined ? {} : { template }),
          ...(table === undefined ? {} : { table }),
          ...(connectionId === undefined ? {} : { connectionId }),
          ...(meta.slug === undefined ? {} : { slug: meta.slug }),
          ...(meta.title === undefined ? {} : { title: meta.title }),
          ...(meta.navGroup === undefined ? {} : { navGroup: meta.navGroup }),
          ...(meta.icon === undefined ? {} : { icon: meta.icon }),
        });

        // `padding` is a TOP-LEVEL envelope field (page chrome, not the
        // per-template body), so it rides the same replacement-envelope channel
        // a recompose uses — layered on top of the recomposed document when
        // both change in one patch, so neither write drops the other. An
        // explicit null deletes the key, restoring the template's default.
        const withPadding =
          padding === undefined
            ? recomposed
            : { ...recomposed, envelope: applyPadding(recomposed.envelope ?? currentEnvelope(page), padding) };

        const result = await pages.updateMeta(pageId, { ...meta, ...withPadding }, {
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          at: app.rbac.now(),
        });
        if (result === 'not-found') throw new NotFoundError(`page ${pageId} does not exist`);
        if (result === 'conflict') {
          throw new ConflictError(
            'This page changed since you loaded it. Reload and try again.',
            'CONFLICT',
            { pageId, revision: page.revision },
          );
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.update',
          ...(page.connectionId === null ? {} : { connectionId: page.connectionId }),
          changes: {
            before: {
              slug: page.slug,
              title: page.title,
              navGroup: page.navGroup,
              navOrder: page.navOrder,
              isEnabled: page.isEnabled,
            },
            after: {
              slug: result.slug,
              title: result.title,
              navGroup: result.navGroup,
              navOrder: result.navOrder,
              isEnabled: result.isEnabled,
            },
          },
        });
        await publishConfigChanged(page.connectionId);
        return { data: toSummary(result) };
      },
    );

    /**
     * `PATCH /pages/:pageId/config` — replace the per-template config body.
     *
     * This is the "edit the items on this page" write: a `page-crud` page's
     * `columns[]`, an archetype's `layout`. It rides `system:pages:manage`
     * rather than `page:<id>:edit` because the body can change what the page
     * fundamentally is, and because the surface that sends it is the Studio
     * page manager. Editing a dashboard's grid from the page itself keeps
     * using the narrower `/layout` route and its per-page grant.
     *
     * Validation is best-effort by design: only `page-dashboard` (via the
     * envelope's superRefine) and the archetypes have a layout schema, and
     * `page-crud`'s columns have a per-item schema and no body schema. So the
     * route validates the ASSEMBLED envelope, which catches everything the
     * renderer's own parse would reject, and lets template-specific keys it
     * has no schema for pass through — the documented forward-compat rule
     * (01 §6.2, unknown fields are preserved on round-trip).
     */
    app.patch(
      '/pages/:pageId/config',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: {
          params: pageParams,
          body: pageConfigPatchBody,
          response: { 200: pageMutationReply },
        },
      },
      async (request) => {
        const { pageId } = request.params;
        const page = await pages.findById(pageId);
        if (page === null) throw new NotFoundError(`page ${pageId} does not exist`);

        const envelope =
          typeof page.config === 'object' && page.config !== null
            ? (page.config as Record<string, unknown>)
            : {};
        const candidate = { ...envelope, config: request.body.config };
        const parsed = pageEnvelopeSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new ValidationFailedError(
            'The page configuration is not valid for this template.',
            { issues: parsed.error.issues.slice(0, 10) },
          );
        }

        const result = await pages.setTemplateConfig(pageId, request.body.config, {
          ...(request.body.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.body.expectedRevision }),
          at: app.rbac.now(),
        });
        if (result === 'not-found') throw new NotFoundError(`page ${pageId} does not exist`);
        if (result === 'conflict') {
          throw new ConflictError(
            'This page changed since you loaded it. Reload and try again.',
            'CONFLICT',
            { pageId, revision: page.revision },
          );
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.config.update',
          ...(page.connectionId === null ? {} : { connectionId: page.connectionId }),
          changes: { after: { pageId, template: page.type } },
        });
        await publishConfigChanged(page.connectionId);
        return { data: toSummary(result) };
      },
    );

    app.post(
      '/pages/:pageId/duplicate',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: {
          params: pageParams,
          body: pageDuplicateBody,
          response: { 200: pageMutationReply },
        },
      },
      async (request) => {
        const { pageId } = request.params;
        const source = await pages.findById(pageId);
        if (source === null) throw new NotFoundError(`page ${pageId} does not exist`);
        await assertSlugFree(request.body.slug);

        const id = newId('page');
        const navOrder = await nextNavOrder(source.navGroup ?? 'workspace');
        // The copy is always `origin: 'user'`, whatever the source was. A copy
        // of a generated page is not something the generator can reproduce, so
        // claiming `generated` would make regeneration try to own — and prune —
        // a document it never emitted.
        const copy = await pages.create(
          {
            id,
            connectionId: source.connectionId,
            slug: request.body.slug,
            type: source.type,
            title: request.body.title,
            icon: source.icon,
            navGroup: source.navGroup,
            navOrder,
            config: reidentifyEnvelope(source.config, {
              id,
              slug: request.body.slug,
              title: request.body.title,
              navOrder,
            }),
            origin: 'user',
            createdBy: sessionUserId(request),
          },
          app.rbac.now(),
        );

        // The copy inherits the ORIGINAL's audience, not its siblings' — a
        // duplicate is meant to be visible to whoever could see the source.
        for (const grant of await permissions.listForResource('page', source.id)) {
          await permissions.grant(grant.roleId, 'page', copy.id, grant.actions);
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.duplicate',
          ...(source.connectionId === null ? {} : { connectionId: source.connectionId }),
          changes: { after: { from: source.id, to: copy.id, slug: copy.slug } },
        });
        await publishConfigChanged(source.connectionId);
        return { data: toSummary(copy) };
      },
    );

    app.delete(
      '/pages/:pageId',
      {
        preHandler: [app.requireAuth, requireManage],
        schema: { params: pageParams, response: { 200: okReply } },
      },
      async (request) => {
        const { pageId } = request.params;
        const page = await pages.findById(pageId);
        if (page === null) throw new NotFoundError(`page ${pageId} does not exist`);

        // A manifest-installed page belongs to its add-on's lifecycle: the
        // installer created it and an uninstall is what removes it. Deleting
        // it here would leave the manifest believing it is still installed.
        if (page.manifestId !== null) {
          throw new ConflictError(
            'This page was installed by an add-on. Uninstall the add-on to remove it.',
            'CONFLICT',
            { pageId, manifestId: page.manifestId },
          );
        }

        // Order matters: drop the grants first. `adminium_views` (saved filters
        // AND every user's personal layout override) and
        // `adminium_scheduled_reports` cascade off the page row's FKs, but
        // `adminium_role_permissions.resource_ref` is a polymorphic varchar no
        // FK can reach. Page ids are deterministic for generated pages, so a
        // leaked grant would be silently re-inherited by a page regenerated at
        // the same id later.
        const revoked = await permissions.revokeAllForResource('page', pageId);
        await pages.delete(pageId);

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'page.delete',
          ...(page.connectionId === null ? {} : { connectionId: page.connectionId }),
          changes: {
            before: {
              pageId,
              slug: page.slug,
              title: page.title,
              origin: page.origin,
              grantsRevoked: revoked,
            },
          },
        });
        await publishConfigChanged(page.connectionId);
        return { data: { ok: true as const } };
      },
    );
  };
}
