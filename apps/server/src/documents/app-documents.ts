// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An installed app's documents: the profiles its install makes and its
 * uninstall takes back, and whether one of them can be drawn right now.
 *
 * The install and uninstall routes call the two functions at the top; the
 * add-on routes call `attachAppDocuments` when an add-on is connected to an app
 * already installed; the staff route that draws a document for an app's own
 * screen asks `appDocumentOff`, and every other door that draws with a
 * profile — the generic render route, the render pipeline an automation step
 * and a queued job run — asks `ownedDocumentOff`.
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
import { appTablesRepo, documentProfilesRepo, manifestsRepo, type DocumentProfile, type MetaDb } from '@adminium/meta';

import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
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
  const providerOf = (addOnKey: string) => {
    const state = runtime();
    const entry = state === null ? null : providerByKey(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION, addOnKey);
    return entry === null ? null : renderingProviderOf(entry.module);
  };
  return {
    attached,
    kindsOf: (addOnKey) => {
      const provider = providerOf(addOnKey);
      return provider === null ? null : new Set(provider.kinds().map((kind) => kind.id));
    },
    slotsOf: (addOnKey, kind) => providerOf(addOnKey)?.describe(kind).slots ?? null,
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
      `This app asks for documents its add-ons cannot draw as it asks: ${result.refused.map((r) => `"${r.table}" ${r.kind ?? ''} — ${r.reason}`).join('; ')}.`,
      { refused: result.refused },
    );
  }
  return result;
}

/**
 * An add-on connected to apps that are already installed — attached, installed
 * onto them, or switched back on there: make each app's documents that need
 * THAT add-on, where they are missing.
 *
 * Without this only an install or an update made them, so an app that merely
 * SUGGESTS the add-on, installed before it was connected, kept the document
 * off until its next update. Idempotent, so connecting again changes nothing
 * — and mends an app connected before this ran.
 *
 * Only what is missing, and only for this add-on: a profile already there is
 * the operator's as they left it (renamed, remapped, given a trigger), and
 * connecting some other add-on makes nothing of theirs come back or change.
 * Nothing is ever removed here — bringing profiles up to date and taking back
 * what the app no longer asks for are the install's and the update's. And
 * when the app's tables cannot be read, nothing is done at all.
 *
 * It never refuses: the add-on is already connected when this runs. A kind the
 * add-on does not draw is left off, listed under `refused`, with nothing
 * written. A host that is not an app installed on a connection (the
 * dashboard, an app still installing, which makes its own) is passed over.
 * Switching the add-on off again leaves the profiles where they are, as it
 * does the install's: the draw is refused as off while it is.
 */
export async function attachAppDocuments(input: {
  meta: MetaDb;
  /** The add-on that was connected. */
  addOnKey: string;
  /** The hosts the add-on was just connected to. */
  hosts: readonly string[];
  runtime: () => AddOnRuntimeState | null;
  createdBy?: string | null | undefined;
}): Promise<{ app: string; result: AppProfilesResult }[]> {
  const manifests = manifestsRepo(input.meta, NO_SECRETS);
  const out: { app: string; result: AppProfilesResult }[] = [];
  for (const host of new Set(input.hosts)) {
    const installed = await manifests.findByKey(host);
    const manifest = installed?.document as AppManifest | undefined;
    const connectionId = installed?.row.connectionId ?? null;
    if (
      installed === null ||
      installed.row.kind !== 'app' ||
      (installed.row.status !== 'installed' && installed.row.status !== 'disabled') ||
      connectionId === null ||
      manifest?.kind !== 'app'
    ) {
      continue;
    }
    const view = await loadSnapshotView(input.meta, connectionId).catch(() => null);
    if (view === null) {
      out.push({
        app: host,
        result: {
          made: [],
          updated: [],
          removed: [],
          skipped: [{ kind: null, table: '', reason: "the app's tables could not be read, so its documents were left as they are" }],
          refused: [],
        },
      });
      continue;
    }
    const result = await makeAppProfiles({
      meta: input.meta,
      manifest,
      connectionId,
      realId: realIdIn(view, await appTablesRepo(input.meta).realNames(connectionId, host)),
      shapes: await installedShapes(input.meta),
      availability: await addOnAvailability(input.meta, host, input.runtime),
      only: { addOn: input.addOnKey },
      createdBy: input.createdBy,
    });
    out.push({ app: host, result });
  }
  return out;
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

/**
 * Why a profile an app owns cannot be drawn now, or null when it can — or
 * when no app owns it. For the doors that draw with a profile by its id
 * rather than by the app's own names: the generic render route and the
 * pipeline itself, which a queued job and an automation step run. The same
 * verdict the app's own screen gets: its add-on (and its feature's) attached
 * and switched on. An app that is gone, or whose tables cannot be read to
 * tell which of its documents this is, counts as off.
 */
export async function ownedDocumentOff(
  meta: MetaDb,
  profile: DocumentProfile,
  runtime: () => AddOnRuntimeState | null,
): Promise<{ addOn: string; feature: string | null; reason: string } | null> {
  if (profile.ownerApp === null) return null;
  const installed = await manifestsRepo(meta, NO_SECRETS).findByKey(profile.ownerApp);
  const manifest = installed?.document as AppManifest | undefined;
  if (installed === null || manifest?.kind !== 'app') {
    return { addOn: profile.addOnKey, feature: null, reason: `the app "${profile.ownerApp}" is not installed` };
  }
  const view = await loadSnapshotView(meta, profile.connectionId).catch(() => null);
  if (view === null) return { addOn: profile.addOnKey, feature: null, reason: "the app's tables cannot be read right now" };
  const names = await appTablesRepo(meta).realNames(profile.connectionId, profile.ownerApp);
  const real = view.model.tables.find((table) => table.id === profile.table)?.name;
  const ref = Object.entries(names).find(([, name]) => name === real)?.[0] ?? '';
  return await appDocumentOff({ meta, manifest, profile, table: ref, runtime });
}

/** The app's own profile for a kind of document on one of its tables, or null. */
export async function appProfileFor(meta: MetaDb, connectionId: string, appKey: string, tableId: string, kind: string): Promise<DocumentProfile | null> {
  const owned = await documentProfilesRepo(meta).listOwnedBy(connectionId, appKey);
  return owned.find((profile) => profile.table === tableId && profile.kind === kind) ?? null;
}
