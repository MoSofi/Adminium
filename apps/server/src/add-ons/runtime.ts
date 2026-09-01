// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on runtime: loading server halves, and the provider registry
 * (26-add-on-runtime.md §5.2, D4; 26-T09).
 *
 * ─── This is the module that runs other people's code ──────────────────────
 *
 * O1 was ratified on 2026-08-29 on the plan's recorded recommendation: server
 * halves run IN-PROCESS, with 24 D13's first-party publisher gate doing the
 * real work. That is a deliberate ruling rather than an inherited one, and it
 * is what this file implements. Everything below is written on the assumption
 * that an add-on's server half is trusted-because-first-party and NOT
 * sandboxed — which is exactly why the loading discipline is narrow:
 *
 *  - **Only from the installed bundle on local disk** (D4, verbatim: "no add-on
 *    server code is loaded from anywhere but the installed bundle on local
 *    disk"). No URL, no registry, no `eval`, no path the caller supplies.
 *  - **Re-hashed against the pin before it is imported.** The bytes are checked
 *    against the per-file sha256 recorded at unpack, so a package edited on the
 *    shared data volume after install does not get imported. A serve-time check
 *    protects a browser; this one protects the server process, and it is the
 *    more consequential of the two.
 *  - **Only a path the MANIFEST declares.** The `server` entry of a `provides`
 *    block, never an arbitrary file in the package.
 *  - **A failure to load is contained.** One broken add-on must not stop a boot
 *    or take down a request; it is recorded, reported, and skipped.
 *
 * ─── Why the registry is rebuilt rather than mutated ───────────────────────
 *
 * §5.2 says the map is "built at boot and on every install/disconnect". Rebuilt
 * whole, not patched: an incremental registry has to get removal exactly right
 * on every path (uninstall, disconnect, disable-per-host, upgrade), and the
 * failure mode of getting it wrong is a stale provider still answering for an
 * add-on the operator believes is gone. Rebuilding is O(installed add-ons),
 * which is a number in the low tens.
 *
 * ─── SLOT_CONFLICT is recorded, never resolved silently ───────────────────
 *
 * Two add-ons may legitimately implement one contract — `artwork-source@1`
 * already has two. For a `multi` slot both render, ordered by `order` then by
 * key so the result does not depend on install sequence. For a `single` slot
 * the lowest `order` wins and the loser is RECORDED by name. A silent override
 * would leave an operator looking at a slot filled by an add-on they did not
 * expect, with nothing anywhere saying why.
 */

import { SLOT_REGISTRY, hasContractVersion } from '@adminium/add-on-contracts';
import type { AddOnManifest } from '@adminium/manifest';

import type { AddOnHttpClient } from './egress.js';
import type { AddOnStore } from './store.js';

/** Why one add-on's server half could not be loaded. */
export type LoadRefusal =
  | 'NO_SERVER_HALF'
  | 'UNDECLARED_PATH'
  | 'TREE_MODIFIED'
  | 'IMPORT_FAILED'
  | 'CONTRACT_UNKNOWN';

export interface LoadProblem {
  addOnKey: string;
  reason: LoadRefusal;
  message: string;
  contract?: string;
}

/** One contract implementation, resolved to a live module. */
export interface ProviderEntry {
  addOnKey: string;
  contract: string;
  version: number;
  /** The imported module's default/namespace export. */
  module: unknown;
}

/** A slot fill offered by an installed add-on. */
export interface SlotFillEntry {
  addOnKey: string;
  slot: string;
  client: string;
  order: number;
}

/** A `single` slot claimed more than once (§5.2). */
export interface SlotConflict {
  slot: string;
  /** The add-on whose fill is used — lowest `order`, then key. */
  winner: string;
  /** The add-on whose fill is not used. Named, never silently dropped. */
  loser: string;
}

export interface AddOnRuntimeState {
  /** `contract@version` -> every add-on providing it, best first. */
  providers: Map<string, ProviderEntry[]>;
  /** Slot id -> the fills that will actually render, already resolved. */
  slots: Map<string, SlotFillEntry[]>;
  conflicts: SlotConflict[];
  problems: LoadProblem[];
}

/** What the registry needs to know about one installed add-on. */
export interface InstalledAddOn {
  manifest: AddOnManifest;
  version: string;
}

export interface BuildRuntimeOptions {
  store: AddOnStore;
  installed: readonly InstalledAddOn[];
  /**
   * Builds the guarded outbound client for one add-on. Injected so the runtime
   * does not reach for a meta handle, and so a test can observe what an add-on
   * was handed.
   */
  httpClientFor?: ((manifest: AddOnManifest) => AddOnHttpClient) | undefined;
  /**
   * Overridable ONLY for tests. Production always resolves through
   * {@link importServerHalf}, which is the D4 path.
   */
  importModule?: ((absolutePath: string) => Promise<unknown>) | undefined;
  log?: ((message: string, data?: Record<string, unknown>) => void) | undefined;
}

const key = (contract: string, version: number): string => `${contract}@${version}`;

/**
 * Loads one add-on's server half from the installed package, after checking
 * the bytes against the pin recorded at unpack.
 *
 * The path is not a parameter a caller chooses: it comes from the manifest's
 * own `provides[].server`, and the store's containment check refuses anything
 * that would leave the package directory even if a manifest asked for it.
 */
export async function importServerHalf(
  store: AddOnStore,
  addOnKey: string,
  version: string,
  relativePath: string,
  importModule: (absolutePath: string) => Promise<unknown> = (path) => import(path),
): Promise<unknown> {
  // Re-hash before import. This is the check that decides whether code the
  // process is about to EXECUTE is the code that was installed.
  await store.readVerifiedFile(addOnKey, version, relativePath);
  const absolute = `${store.dirFor(addOnKey, version)}/${relativePath}`;
  return importModule(absolute);
}

/**
 * Builds the provider registry and resolves slot fills for the installed set.
 *
 * Never throws for one bad add-on: every failure becomes a {@link LoadProblem}
 * and the rest of the set still loads. A boot that dies because one add-on's
 * bundle is corrupt would take the whole instance with it, which is a far worse
 * outcome than one missing integration.
 */
export async function buildAddOnRuntime(opts: BuildRuntimeOptions): Promise<AddOnRuntimeState> {
  const providers = new Map<string, ProviderEntry[]>();
  const problems: LoadProblem[] = [];
  const offered: SlotFillEntry[] = [];

  for (const { manifest, version } of opts.installed) {
    // ── Slot fills. Client-side, so nothing is loaded here — the browser
    //    imports the bundle from the SRI-checked route.
    for (const slot of manifest.addOn.slots ?? []) {
      offered.push({
        addOnKey: manifest.key,
        slot: slot.slot,
        client: slot.client,
        order: slot.order ?? 0,
      });
    }

    // ── Server halves, one per provided contract.
    for (const provided of manifest.addOn.provides ?? []) {
      if (!hasContractVersion(provided.contract, provided.version)) {
        // The manifest validator already refuses this, so reaching it means an
        // installed manifest predates a contract registry change — a real
        // situation after an Adminium upgrade, and one that must degrade rather
        // than crash.
        problems.push({
          addOnKey: manifest.key,
          reason: 'CONTRACT_UNKNOWN',
          contract: key(provided.contract, provided.version),
          message:
            `"${manifest.key}" implements ${key(provided.contract, provided.version)}, which ` +
            'this build does not know. Upgrade the add-on, or Adminium.',
        });
        continue;
      }

      try {
        const module = await importServerHalf(
          opts.store,
          manifest.key,
          version,
          provided.server,
          opts.importModule,
        );
        const entry: ProviderEntry = {
          addOnKey: manifest.key,
          contract: provided.contract,
          version: provided.version,
          module,
        };
        const id = key(provided.contract, provided.version);
        providers.set(id, [...(providers.get(id) ?? []), entry]);
      } catch (error) {
        const reason: LoadRefusal =
          (error as { reason?: string }).reason === 'TREE_MODIFIED'
            ? 'TREE_MODIFIED'
            : 'IMPORT_FAILED';
        problems.push({
          addOnKey: manifest.key,
          reason,
          contract: key(provided.contract, provided.version),
          message:
            reason === 'TREE_MODIFIED'
              ? `"${manifest.key}" was modified on disk after it was installed, so its server ` +
                'half was not loaded.'
              : `"${manifest.key}" failed to load: ${String(error)}`,
        });
        opts.log?.('add-on server half failed to load', { key: manifest.key, reason });
      }
    }
  }

  // Stable ordering everywhere: `order` first, then key. Never install
  // sequence, which differs between two instances of the same deployment.
  const byOrderThenKey = (a: SlotFillEntry, b: SlotFillEntry): number =>
    a.order !== b.order ? a.order - b.order : a.addOnKey < b.addOnKey ? -1 : 1;

  for (const list of providers.values()) {
    list.sort((a, b) => (a.addOnKey < b.addOnKey ? -1 : 1));
  }

  const fills = new Map<string, SlotFillEntry[]>();
  for (const fill of offered) {
    fills.set(fill.slot, [...(fills.get(fill.slot) ?? []), fill]);
  }

  const slots = new Map<string, SlotFillEntry[]>();
  const conflicts: SlotConflict[] = [];
  for (const [slotId, list] of fills) {
    const sorted = [...list].sort(byOrderThenKey);
    const definition = SLOT_REGISTRY.find((candidate) => candidate.id === slotId);
    // An unknown slot id keeps `multi` semantics rather than being dropped: the
    // manifest validator gates slot ids, so an unknown one here means the
    // registry moved under an installed add-on, and silently rendering nothing
    // is the worse of the two failures.
    if (definition?.fill === 'single' && sorted.length > 1) {
      const [winner, ...losers] = sorted;
      for (const loser of losers) {
        conflicts.push({ slot: slotId, winner: winner!.addOnKey, loser: loser.addOnKey });
      }
      slots.set(slotId, [winner!]);
      continue;
    }
    slots.set(slotId, sorted);
  }

  return { providers, slots, conflicts, problems };
}

/**
 * The one provider a host should use for a contract.
 *
 * Two implementations of one contract is legal, so this is a CHOICE rather than
 * a lookup — lowest add-on key, deterministically. A host that needs a specific
 * one names it; a host that just needs "a shipping carrier" gets a stable
 * answer rather than whichever loaded first.
 */
export function resolveProvider(
  state: AddOnRuntimeState,
  contract: string,
  version: number,
): ProviderEntry | null {
  return state.providers.get(key(contract, version))?.[0] ?? null;
}
