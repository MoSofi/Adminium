// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An installed app's documents: the profiles its install makes and its
 * uninstall takes back, and whether one of them can be drawn right now.
 *
 * The install and uninstall routes call the two functions at the top; the
 * staff route that draws a document for an app's own screen calls the third.
 *
 * ─── A DOCUMENT IS A FEATURE ───────────────────────────────────────────────
 *
 * A document is drawn by an add-on, so it exists for the app only while that
 * add-on is ATTACHED to the app and switched on — and, when the app files the
 * document under one of its features (`addOns.features`), while every add-on
 * that feature needs is too. Anything short of that is the feature being off:
 * the install makes no profile for it (and says why), and a request to draw
 * one is refused as off. Never an install that fails over an optional add-on.
 *
 * What does refuse an install is an app asking an attached add-on for a kind
 * of document it does not draw — a mistake in the app, found before anything
 * is written.
 */
import type { AppManifest } from '@adminium/manifest';
import { documentProfilesRepo, manifestsRepo, type DocumentProfile, type MetaDb } from '@adminium/meta';

import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { AppError } from '../errors.js';
import {
  availabilityOf,
  installedShapes,
  makeAppProfiles,
  removeAppProfiles,
  type AddOnAvailability,
  type AppProfilesResult,
} from './app-profiles.js';
import { DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION, renderingProviderOf } from './provider.js';

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('app documents never store a credential');
  },
  decrypt: (): string => {
    throw new Error('app documents never read a credential');
  },
};

/**
 * What the app's add-ons can draw now: those attached to it and switched on,
 * and the kinds each one's loaded provider draws.
 */
export async function addOnAvailability(
  meta: MetaDb,
  appKey: string,
  runtime: () => AddOnRuntimeState | null,
): Promise<AddOnAvailability> {
  const attached = new Set((await manifestsRepo(meta, NO_SECRETS).enabledForHost(appKey)).map((m) => m.row.manifestKey));
  return {
    attached,
    kindsOf: (addOnKey) => {
      const state = runtime();
      const entry = state === null ? null : providerByKey(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION, addOnKey);
      const provider = entry === null ? null : renderingProviderOf(entry.module);
      return provider === null ? null : new Set(provider.kinds().map((kind) => kind.id));
    },
  };
}

/** The real snapshot id of one of the app's tables, from its real names. */
export function realIdIn(view: SnapshotView | null, names: Readonly<Record<string, string>>): (ref: string) => string | null {
  return (ref) => {
    const real = names[ref] ?? ref;
    return view?.model.tables.find((table) => table.name === real)?.id ?? null;
  };
}

/**
 * The install's (and an update's) step: make or bring up to date the app's
 * document profiles on its connection. Idempotent. Refuses — before writing
 * anything — when an attached add-on does not draw a kind the app asks for;
 * everything else it cannot make is skipped and listed with its reason.
 */
export async function installAppDocuments(input: {
  meta: MetaDb;
  manifest: AppManifest;
  connectionId: string;
  /** The connection's schema AFTER the app's tables were made and read. */
  view: SnapshotView | null;
  /** The app's real table names (`invoices` → `studio_invoices`). */
  names: Readonly<Record<string, string>>;
  runtime: () => AddOnRuntimeState | null;
  createdBy?: string | null | undefined;
}): Promise<AppProfilesResult> {
  const result = await makeAppProfiles({
    meta: input.meta,
    manifest: input.manifest,
    connectionId: input.connectionId,
    realId: realIdIn(input.view, input.names),
    shapes: await installedShapes(input.meta),
    availability: await addOnAvailability(input.meta, input.manifest.key, input.runtime),
    createdBy: input.createdBy,
  });
  if (result.refused.length > 0) {
    throw new AppError(
      422,
      'DOCUMENT_KIND_UNKNOWN',
      `This app asks for documents its add-ons do not draw: ${result.refused.map((r) => `"${r.table}" ${r.kind ?? ''} — ${r.reason}`).join('; ')}.`,
      { refused: result.refused },
    );
  }
  return result;
}

/** The uninstall's step: the app's own profiles on its connection, and nothing else. */
export async function uninstallAppDocuments(meta: MetaDb, connectionId: string, appKey: string): Promise<number> {
  return await removeAppProfiles(meta, connectionId, appKey);
}

/** Why a document of the app cannot be drawn now, or null when it can. */
export async function appDocumentOff(input: {
  meta: MetaDb;
  manifest: AppManifest;
  profile: DocumentProfile;
  /** The app's table ref the document is drawn for. */
  table: string;
  runtime: () => AddOnRuntimeState | null;
}): Promise<{ addOn: string; feature: string | null; reason: string } | null> {
  const entry = (input.manifest.documents ?? []).find((d) => d.table === input.table && d.kind === input.profile.kind);
  const plan = { addOn: input.profile.addOnKey, kind: input.profile.kind, feature: entry?.feature };
  const verdict = availabilityOf(plan, input.manifest, await addOnAvailability(input.meta, input.manifest.key, input.runtime));
  return verdict.state === 'on' ? null : { addOn: plan.addOn, feature: plan.feature ?? null, reason: verdict.reason };
}

/** The app's own profile for a kind of document on one of its tables, or null. */
export async function appProfileFor(meta: MetaDb, connectionId: string, appKey: string, tableId: string, kind: string): Promise<DocumentProfile | null> {
  const owned = await documentProfilesRepo(meta).listOwnedBy(connectionId, appKey);
  return owned.find((profile) => profile.table === tableId && profile.kind === kind) ?? null;
}
