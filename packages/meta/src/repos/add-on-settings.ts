// SPDX-License-Identifier: AGPL-3.0-only
/**
 * addOnSettingsRepo — adminium_add_on_settings (wave 0031). Closes 0.2 item
 * 10 for every add-on with a settings panel.
 *
 * Every add-on in the fleet ships a `settings.add-on.panel` fill and, until
 * this table, none of them had anywhere to put what somebody typed into it.
 * The panels wrote into whatever the host happened to hand them, which meant
 * the two hosts that mounted the surface stored the same add-on's values in
 * two different shapes.
 *
 * ─── A SECRET NEVER LANDS HERE, AND THE REPO IS WHERE THAT IS ENFORCED ─────
 *
 * `values` is read back in clear by the settings route, by the panel and by
 * every render. A credential belongs in 0021's encrypted table instead. The
 * check lives here rather than at the route because there is more than one
 * writer — the panel's PUT, the installer's defaults, and a future import —
 * and a rule enforced at one door is a rule with three doors.
 *
 * The caller passes the manifest's own declared settings, so the repo does
 * not need to know what any particular add-on's keys mean: it needs to know
 * which of them the MANIFEST marked `secret`, and refuse exactly those.
 *
 * ─── ONE ROW PER INSTALL (wave 0076) ──────────────────────────────────────
 *
 * The same add-on may be installed once per database, and each install keeps
 * its own values (Fernhill's business name is not Kiln's). Rows are found by
 * the install id (`manifest_id`), never by the add-on key: a caller with only
 * a key resolves the install first.
 */

import type { Kysely } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumAddOnSettingsTable, MetaDB } from '../schema/tables.js';
import { affected, packJson, readJson } from './util.js';

export interface AddOnSettings {
  /** The install the values belong to. */
  manifestId: string;
  addOnKey: string;
  values: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: number;
}

/** One declared setting, as far as this repo cares about it. */
export interface DeclaredSetting {
  key: string;
  secret?: boolean;
}

export class SecretSettingRefused extends Error {
  readonly keys: readonly string[];
  constructor(keys: readonly string[]) {
    super(
      `these settings are declared secret and may not be stored in clear: ${keys.join(', ')}`,
    );
    this.name = 'SecretSettingRefused';
    this.keys = keys;
  }
}

export function addOnSettingsRepo(meta: MetaDb) {
  const db = meta.db as unknown as Kysely<MetaDB>;

  async function getForInstall(manifestId: string): Promise<AddOnSettings | null> {
    const row = await db
      .selectFrom('adminium_add_on_settings')
      .selectAll()
      .where('manifestId', '=', manifestId)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          manifestId: row.manifestId,
          addOnKey: row.addOnKey,
          values: readJson<Record<string, unknown>>(row.values),
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        };
  }

  /** The values, or `{}` — what a renderer wants, with no null to handle. */
  async function valuesForInstall(manifestId: string): Promise<Record<string, unknown>> {
    return (await getForInstall(manifestId))?.values ?? {};
  }

  /**
   * Merge a partial change into an add-on's values.
   *
   * MERGE RATHER THAN REPLACE, because the panel patches one field at a time
   * and a replace would mean every panel had to send the whole object back —
   * which is how one tab's stale copy silently reverts another's save.
   */
  async function patch(
    install: { manifestId: string; addOnKey: string },
    changes: Record<string, unknown>,
    declared: readonly DeclaredSetting[],
    opts: { updatedBy?: string | null; at?: number } = {},
  ): Promise<AddOnSettings> {
    const secrets = new Set(
      declared.filter((setting) => setting.secret === true).map((setting) => setting.key),
    );
    const refused = Object.keys(changes).filter((key) => secrets.has(key));
    if (refused.length > 0) throw new SecretSettingRefused(refused);

    /*
     * A key the manifest does not declare is DROPPED, not refused. The panel
     * and the manifest can be a version apart — a bundle loaded from a cached
     * asset, an add-on upgraded while somebody had the page open — and
     * refusing the whole save because one field is unknown would lose the four
     * that were fine. Dropping is silent by necessity; the alternative is a
     * message about a key nobody typed.
     */
    const allowed = new Set(declared.map((setting) => setting.key));
    const accepted = Object.fromEntries(
      Object.entries(changes).filter(([key]) => allowed.has(key)),
    );

    const at = opts.at ?? Date.now();
    const { manifestId, addOnKey } = install;
    const current = await getForInstall(manifestId);
    const values = { ...(current?.values ?? {}), ...accepted };

    if (current === null) {
      await db
        .insertInto('adminium_add_on_settings')
        .values({
          manifestId,
          addOnKey,
          values: packJson(values),
          updatedBy: opts.updatedBy ?? null,
          updatedAt: at,
        })
        .execute();
    } else {
      await db
        .updateTable('adminium_add_on_settings')
        .set({
          values: packJson(values),
          updatedBy: opts.updatedBy ?? null,
          updatedAt: at,
        } as never)
        .where('manifestId', '=', manifestId)
        .execute();
    }
    return (await getForInstall(manifestId))!;
  }

  /**
   * Drop an add-on's settings — uninstall's half that lives here.
   *
   * This is the one place "uninstall keeps data" bends, and it bends on
   * purpose: what that rule protects is the CUSTOMER'S data — their rows,
   * their files, the documents already issued. An add-on's own configuration
   * is not that. It is part of the add-on, it means nothing without it, and it
   * goes with it exactly as a credential does.
   */
  async function clearForInstall(manifestId: string): Promise<boolean> {
    const rows = await db
      .deleteFrom('adminium_add_on_settings')
      .where('manifestId', '=', manifestId)
      .executeTakeFirst();
    return affected(rows.numDeletedRows) === 1;
  }

  return { getForInstall, valuesForInstall, patch, clearForInstall };
}

export type AddOnSettingsRepo = ReturnType<typeof addOnSettingsRepo>;
export type { AdminiumAddOnSettingsTable };
