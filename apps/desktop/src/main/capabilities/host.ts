/**
 * CapabilityHost — the generic capability registry + IPC router
 * (11-electron.md §12).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STUB. **11-T17 owns this file.** 11-T01 created it so the §3 tree exists │
 * │ and the scaffold builds; nothing calls `createCapabilityHost` yet. The   │
 * │ two interfaces below are quoted verbatim from §12 — that shape is being  │
 * │ FROZEN together with 13-marketplace.md's manifest `capabilities` field,  │
 * │ so changing it is a cross-document decision, not a refactor.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * §12's point is that the whole pipeline — manifest → consent → grant → IPC →
 * provider — ships and is testable in M11 with nothing but a stub provider
 * behind it, so the POS plan later swaps provider internals and touches nothing
 * else. Two rules carry that:
 *
 *  - every `invoke` is checked against the grant table (`adminium_settings` key
 *    `desktop.capability_grants`) and rejects ungranted calls with
 *    `CAPABILITY_NOT_GRANTED`;
 *  - non-desktop runtimes report every capability `unavailable`, so a manifest
 *    page degrades on self-host and Cloud instead of erroring.
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

export interface CreateCapabilityHostOptions {
  // 11-T17: a grant-table reader/writer over `adminium_settings`, reached
  // through the server's REST API rather than the meta store directly (§1
  // principle 2 — the main process never opens the meta store).
  placeholder?: never;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- 11-T17 scaffold stub: the
   parameter list is the contract 11-T01 wired against and must survive until
   11-T17 implements the body. */
export function createCapabilityHost(_opts: CreateCapabilityHostOptions): CapabilityHost {
  throw new Error('src/main/capabilities/host.ts is a scaffold stub — 11-T17 implements it.');
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * The host the §4 bridge is wired with until 11-T17 lands: no providers, and
 * therefore no grants.
 *
 * WHY THIS EXISTS AND {@link createCapabilityHost} STILL THROWS. `main/ipc.ts`
 * registers the two §12 channels unconditionally, and the bridge is wired at
 * boot NOW — so `registerIpcHandlers` needs a `CapabilityHost` today, while the
 * registry, the `adminium_settings` grant table and the consent flow are all
 * 11-T17's and do not exist. The choice is between this and leaving the two
 * channels unhandled, which is strictly worse: `ipcRenderer.invoke` on an
 * unregistered channel rejects with Electron's own "No handler registered for
 * …" prose, which is neither one of §4's typed codes nor something the SPA can
 * branch on. It would also mean the bridge answers 12 of its 14 channels, which
 * is not a state §4 describes.
 *
 * The answers it gives are the ones §12 already specifies for this exact state,
 * not placeholders:
 *
 *  - `list()` is `[]` — nothing is registered, so there is nothing to describe.
 *    A manifest page reading this degrades exactly as it must on self-host and
 *    Cloud (§12: "non-desktop runtimes report every capability `unavailable`").
 *  - `invoke()` rejects with `CAPABILITY_NOT_GRANTED` — §12: "Calls without a
 *    grant reject with a typed `CAPABILITY_NOT_GRANTED` error", and with no
 *    grant table there is no grant behind any call. It fails CLOSED, which is
 *    the only direction a capability gate may fail, and `main/ipc.ts` maps the
 *    message prefix onto §4's typed code so the SPA sees the real contract.
 *
 * 11-T17 replaces the call site in `main/index.ts` with the real host; nothing
 * else moves.
 */
export function createUngrantedCapabilityHost(): CapabilityHost {
  return {
    register(): void {
      throw new Error(
        'capability providers are 11-T17: the Wave 1 host holds none. ' +
          'Register them on the real CapabilityHost once it exists.',
      );
    },
    list(): CapabilityDescriptor[] {
      return [];
    },
    invoke(capabilityId: string, method: string): Promise<unknown> {
      return Promise.reject(
        new Error(
          `${CAPABILITY_NOT_GRANTED}: no capability grant exists for "${capabilityId}.${method}". ` +
            'Capability providers and the grant table are not wired in this build.',
        ),
      );
    },
  };
}
