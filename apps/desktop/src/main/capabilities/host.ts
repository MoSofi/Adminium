/**
 * CapabilityHost — the generic capability registry + IPC router
 * (11-electron.md §12).
 *
 * §12's whole point is that the pipeline — manifest → consent → grant → IPC →
 * provider — ships and is testable in M11 with nothing but a stub provider behind
 * it, so the POS plan later swaps provider internals and touches nothing else.
 * Two rules carry that, and this file is where both live:
 *
 *  - every `invoke` is checked against the grant table (`adminium_settings` key
 *    `desktop.capabilityGrants`) and rejects an ungranted call with
 *    `CAPABILITY_NOT_GRANTED`;
 *  - the grant table belongs to the SERVER (§1 principle 2: the main process
 *    never opens the meta store), so the host does not read it itself — it is
 *    handed a {@link CapabilityGrantReader} that reaches the loopback REST API,
 *    exactly as `main/backup.ts`'s `BackupTransport` reaches `POST /desktop/
 *    backup`. The real reader lives in `main/index.ts`; the unit suite injects a
 *    fake.
 *
 * WHY THE READ HAPPENS ON EVERY INVOKE, not once at boot. The revoke test —
 * "grant revoked → the next invoke rejects" — is a promise about immediacy, and
 * a cached grant set would have to invalidate on a write the host never sees (the
 * dashboard writes grants straight to the server, §12). Invoke is already async
 * and rare (a user pressing "print a receipt"), so a fresh loopback read is
 * negligible and always correct — there is no stale window to reason about.
 *
 * WHY THE CHECK IS BY `capabilityId`, not by manifest. §4's frozen bridge
 * signature is `invoke(capabilityId, method, payload)` — it carries no
 * `manifestId`, because the caller is the loopback renderer and every manifest
 * page shares that one origin. So a capability is reachable when SOME installed
 * manifest was consented to it, which is the honest meaning the signature allows:
 * the `manifestId` dimension of a grant is what the consent/revoke UI shows and
 * audits per app, not a second key the invoke path could enforce without a field
 * it does not have.
 */

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ FROZEN with 13-marketplace.md. The two interfaces below are quoted        │
 * │ verbatim from §12 and are being frozen together with the manifest         │
 * │ `capabilities` field, so changing their shape is a cross-document         │
 * │ decision, not a refactor.                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export interface CapabilityDescriptor {
  /** `"printer.escpos"`; future: `"serial"`, `"hid"`, … */
  id: string;
  version: 1;
  status: 'available' | 'unavailable' | 'stub';
  /** e.g. `["listDevices", "print", "openDrawer"]`. */
  methods: string[];
}

export interface CapabilityProvider {
  descriptor: CapabilityDescriptor;
  invoke(method: string, payload: unknown): Promise<unknown>;
}

/** §12's typed rejections. The SPA branches on these, so they are part of the API. */
export const CAPABILITY_NOT_GRANTED = 'CAPABILITY_NOT_GRANTED';
export const CAPABILITY_STUB = 'CAPABILITY_STUB';

export interface CapabilityHost {
  register(provider: CapabilityProvider): void;
  list(): CapabilityDescriptor[];
  invoke(capabilityId: string, method: string, payload: unknown): Promise<unknown>;
}

/**
 * One consented grant (§12), as the host reads it. Mirrors — and is pinned to,
 * by the `import type` assertion at the bottom of this file — `@adminium/server`'s
 * `CapabilityGrant` (which is `@adminium/meta`'s). Restated locally rather than
 * imported so this frozen-interface module stays free of a runtime edge that
 * would pull Fastify into the main process; the assertion fails the typecheck the
 * moment the two drift, the same arrangement `backup-archive.ts` uses.
 */
export interface CapabilityGrant {
  manifestId: string;
  capabilityId: string;
  grantedAt: number;
}

/**
 * Reads the current grant table (§12). `null` is the honest answer when there is
 * no session to read AS — first run, or "Require login on this device" with
 * nobody signed in — and the host treats it as "no grants", so a call fails
 * CLOSED (`CAPABILITY_NOT_GRANTED`), the only safe direction for a gate.
 */
export type CapabilityGrantReader = () => Promise<readonly CapabilityGrant[] | null>;

export interface CreateCapabilityHostOptions {
  /**
   * How the host learns what has been consented. The loopback REST reader in
   * `main/index.ts`; a fake in tests. Called on every {@link CapabilityHost.invoke}
   * — see the module header for why a fresh read, not a cache.
   */
  readGrants: CapabilityGrantReader;
  /**
   * Providers to register up front — `printer.escpos` in production. Optional
   * because {@link CapabilityHost.register} adds them too; passing them here is
   * just the one-call form the real wiring uses.
   */
  providers?: readonly CapabilityProvider[] | undefined;
  /** §9's main-process log — refusals are recorded, never swallowed. */
  log?: ((line: string) => void) | undefined;
}

/**
 * The real §12 host: holds providers, and gates every `invoke` on a fresh read
 * of the grant table.
 */
export function createCapabilityHost(opts: CreateCapabilityHostOptions): CapabilityHost {
  const providers = new Map<string, CapabilityProvider>();
  const log = opts.log ?? ((): void => {});

  const register = (provider: CapabilityProvider): void => {
    const id = provider.descriptor.id;
    if (providers.has(id)) {
      // A second provider for one id is a wiring bug (two drivers claiming the
      // printer), not a runtime condition — fail loud at boot, where it is fixed.
      throw new Error(`capability "${id}" already has a provider registered`);
    }
    providers.set(id, provider);
  };

  for (const provider of opts.providers ?? []) register(provider);

  return {
    register,
    list(): CapabilityDescriptor[] {
      return [...providers.values()].map((provider) => provider.descriptor);
    },
    async invoke(capabilityId: string, method: string, payload: unknown): Promise<unknown> {
      // Gate first, and fail closed. A `null` read (no session) and an empty
      // table both mean "nothing is granted", and an ungranted call is refused
      // BEFORE the provider is even looked up — the rejection must not depend on
      // whether the capability happens to exist in this build.
      const grants = (await opts.readGrants()) ?? [];
      const granted = grants.some((grant) => grant.capabilityId === capabilityId);
      if (!granted) {
        log(`capabilities: refused ${capabilityId}.${method} — no grant`);
        throw new Error(
          `${CAPABILITY_NOT_GRANTED}: no capability grant exists for "${capabilityId}".`,
        );
      }

      const provider = providers.get(capabilityId);
      if (provider === undefined) {
        // Granted, but no provider — a capability was consented that this build
        // cannot serve (a stale grant after a driver was removed). Not a typed
        // §4 code: it maps to INTERNAL, which is right, because it is a build
        // inconsistency and not something the manifest page can act on.
        log(`capabilities: ${capabilityId}.${method} is granted but has no provider`);
        throw new Error(`capability "${capabilityId}" has no provider in this build`);
      }

      // The provider owns the rest — including §12's `CAPABILITY_STUB` rejection,
      // which the escpos stub throws for `print`. It surfaces unchanged: the ipc
      // layer maps the message prefix to §4's typed code.
      return provider.invoke(method, payload);
    },
  };
}

// ─── Drift guard (see CapabilityGrant's doc) ─────────────────────────────────
// TYPE-ONLY. Erased at build; pulls no runtime code into the main process.
import type { CapabilityGrant as ServerCapabilityGrant } from '@adminium/server';

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/** Fails the typecheck if the local grant shape drifts from the server's. */
export type _CapabilityGrantMatchesServer = Assert<Mutual<CapabilityGrant, ServerCapabilityGrant>>;
