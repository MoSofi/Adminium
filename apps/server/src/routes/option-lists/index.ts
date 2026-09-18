// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option lists — the answers a column accepts, named once (plan 50 D20).
 *
 * ─── Who may read, and who may write ───────────────────────────────────────
 *
 * READS need a session and nothing more: a create dialog renders the list, and
 * a viewer who can add a row has to be able to see the countries it offers.
 * Nothing here is sensitive — a list of departments is the shape of the
 * workspace, not its contents.
 *
 * WRITES need `system:schema:remap`, the same grant that writes the rule that
 * names the list. Two permissions for one decision would mean an admin who can
 * point a column at a list cannot fix the list.
 *
 * ─── Why DELETE answers 409 and names the columns ──────────────────────────
 *
 * A list a rule points at is in use, and deleting it would leave the rule
 * naming nothing — a column whose writes are refused for a reason nobody can
 * see. The refusal carries `usedBy`, so the operator is told where to go rather
 * than left to search. 409, not 422: the request is well-formed and the caller
 * is authorized; what is wrong is the state of the resource.
 *
 * ─── The built-ins are not rows ────────────────────────────────────────────
 *
 * `builtin:countries`, `builtin:us-states` and `builtin:gender` live in code
 * (`@adminium/engine/config`). They are served by the read routes like any
 * other list, with their labels resolved in the CALLER's locale, and they
 * cannot be edited or deleted — editing one makes a copy, which is an ordinary
 * row (D20).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MetaValidationError,
  optionListsRepo,
  overridesRepo,
  type MetaDb,
} from '@adminium/meta';
import {
  BUILTIN_OPTION_LIST_KEYS,
  builtinOptionItems,
  isBuiltinOptionList,
  type BuiltinOptionListKey,
  type OptionListItem,
} from '@adminium/engine/config';

import { audited } from '../../audit/coverage.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { translatorFor } from '../../i18n/server-i18n.js';
import { SCHEMA_REMAP } from '../schema/index.js';

export interface OptionListsRoutesDeps {
  meta: MetaDb;
}

const itemSchema = z.object({
  value: z.string().min(1).max(256),
  label: z.string().max(256).optional(),
  tone: z.string().max(40).optional(),
  description: z.string().max(512).optional(),
});

const listReply = z.object({
  key: z.string(),
  name: z.string(),
  items: z.array(itemSchema),
  origin: z.string(),
  /** False for a built-in: the editor offers "make a copy" instead of a save. */
  editable: z.boolean(),
});

const listsReply = z.object({ lists: z.array(listReply) });

const createBody = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/, { message: 'must be a lowercase slug' }),
  name: z.string().min(1).max(200),
  items: z.array(itemSchema).min(1).max(500),
  /**
   * `copy:<builtin key>` when this list was made by editing a built-in, so the
   * editor can say where it came from. Any other origin is `custom`.
   */
  origin: z.string().max(140).optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  items: z.array(itemSchema).min(1).max(500).optional(),
});

const keyParams = z.object({ key: z.string().min(1).max(140) });

export function optionListsRoutes(deps: OptionListsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const lists = optionListsRepo(meta);
  const overrides = overridesRepo(meta);

  return async (app) => {
    async function requireSession(request: FastifyRequest): Promise<void> {
      await app.rbac.resolve(request);
    }

    /**
     * The built-ins, with their labels in the CALLER's own language.
     *
     * A country's name comes from `Intl.DisplayNames` in the reader's locale,
     * which is the whole reason the list is not a table of English strings; the
     * reader's locale is the one their session already resolves to.
     */
    async function builtins(request: FastifyRequest): Promise<
      { key: BuiltinOptionListKey; name: string; items: OptionListItem[]; origin: string; editable: boolean }[]
    > {
      const user = (request as unknown as { user?: { id?: string } }).user;
      const i18n = await translatorFor(meta, user?.id ?? null);
      const t = i18n.t.bind(i18n);
      const locale = i18n.language;
      const genderLabels = {
        female: t('ui:lists.gender.female', 'Female'),
        male: t('ui:lists.gender.male', 'Male'),
        other: t('ui:lists.gender.other', 'Other'),
      };
      // An exhaustive map of literal keys: a name assembled from the slug
      // would be a key no gate can check against the eight bundles.
      const NAMES: Record<BuiltinOptionListKey, [string, string]> = {
        'builtin:countries': ['ui:lists.name.countries', 'Countries'],
        'builtin:us-states': ['ui:lists.name.us-states', 'US states'],
        'builtin:gender': ['ui:lists.name.gender', 'Gender'],
      };
      return BUILTIN_OPTION_LIST_KEYS.map((key) => {
        const [nameKey, fallback] = NAMES[key];
        return {
          key,
          name: t(nameKey, fallback),
          items: builtinOptionItems(key, locale, genderLabels),
          origin: 'builtin',
          editable: false,
        };
      });
    }

    /** Which columns name this list, across every connection. */
    async function usedBy(key: string): Promise<string[]> {
      const rows = await overrides.listByOp('column.options');
      return rows
        .filter((row) => {
          const value = row.value as { list?: unknown };
          return typeof value.list === 'string' && value.list === key;
        })
        .map((row) => `${row.tableName}.${row.columnName ?? ''}`)
        .sort();
    }

    async function mustCustom(key: string) {
      if (isBuiltinOptionList(key)) {
        throw new ValidationFailedError(
          'A built-in list cannot be changed. Make an editable copy of it instead.',
          { key },
        );
      }
      const row = await lists.findByKey(key);
      if (row === null) throw new NotFoundError(`There is no list called ${JSON.stringify(key)}.`, { key });
      return row;
    }

    app.get(
      '/option-lists',
      { preHandler: requireSession, schema: { response: { 200: listsReply } } },
      async (request) => {
        const stored = await lists.list();
        return {
          lists: [
            ...(await builtins(request)),
            ...stored.map((row) => ({
              key: row.key,
              name: row.name,
              items: row.items,
              origin: row.origin,
              editable: true,
            })),
          ],
        };
      },
    );

    app.get(
      '/option-lists/:key',
      { preHandler: requireSession, schema: { params: keyParams, response: { 200: listReply } } },
      async (request) => {
        const { key } = request.params as { key: string };
        if (isBuiltinOptionList(key)) {
          const found = (await builtins(request)).find((list) => list.key === key);
          if (found === undefined) throw new NotFoundError('No such list.', { key });
          return found;
        }
        const row = await lists.findByKey(key);
        if (row === null) throw new NotFoundError(`There is no list called ${JSON.stringify(key)}.`, { key });
        return { key: row.key, name: row.name, items: row.items, origin: row.origin, editable: true };
      },
    );

    app.post(
      '/option-lists',
      {
        preHandler: app.rbac.require(SCHEMA_REMAP),
        config: { audit: audited('rbac') },
        schema: { body: createBody, response: { 201: listReply } },
      },
      async (request, reply) => {
        const body = request.body as z.infer<typeof createBody>;
        if (isBuiltinOptionList(body.key)) {
          throw new ValidationFailedError('That key belongs to a built-in list.', { key: body.key });
        }
        let row;
        try {
          row = await lists.create({
            key: body.key,
            name: body.name,
            items: body.items,
            ...(body.origin === undefined ? {} : { origin: body.origin }),
          });
        } catch (error) {
          if (error instanceof MetaValidationError) {
            throw new ValidationFailedError(error.message, { key: body.key });
          }
          throw error;
        }
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'option-list.create',
          changes: { after: { key: row.key, items: row.items.length } },
        });
        reply.code(201);
        return { key: row.key, name: row.name, items: row.items, origin: row.origin, editable: true };
      },
    );

    app.patch(
      '/option-lists/:key',
      {
        preHandler: app.rbac.require(SCHEMA_REMAP),
        config: { audit: audited('rbac') },
        schema: { params: keyParams, body: patchBody, response: { 200: listReply } },
      },
      async (request) => {
        const { key } = request.params as { key: string };
        const before = await mustCustom(key);
        const body = request.body as z.infer<typeof patchBody>;
        let row;
        try {
          row = await lists.update(key, body);
        } catch (error) {
          if (error instanceof MetaValidationError) throw new ValidationFailedError(error.message, { key });
          throw error;
        }
        if (row === null) throw new NotFoundError('No such list.', { key });
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'option-list.update',
          changes: { before: { items: before.items.length }, after: { items: row.items.length } },
        });
        return { key: row.key, name: row.name, items: row.items, origin: row.origin, editable: true };
      },
    );

    app.delete(
      '/option-lists/:key',
      {
        preHandler: app.rbac.require(SCHEMA_REMAP),
        config: { audit: audited('rbac') },
        schema: { params: keyParams, response: { 200: z.object({ deleted: z.boolean() }) } },
      },
      async (request) => {
        const { key } = request.params as { key: string };
        await mustCustom(key);
        const columns = await usedBy(key);
        if (columns.length > 0) {
          // `CONFLICT` is the code; the columns ride in `details`, which is
          // what the editor reads to say WHERE to go.
          throw new ConflictError('This list is in use. Remove it from those columns first.', 'CONFLICT', {
            key,
            usedBy: columns,
          });
        }
        const deleted = await lists.remove(key);
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'option-list.delete',
          changes: { before: { key } },
        });
        return { deleted };
      },
    );
  };
}
