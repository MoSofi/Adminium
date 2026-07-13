/**
 * Adapter registry mechanics + the typed adapter error — the acyclic leaf
 * under ./adapter.ts (the repo forbids circular imports, 01 §2.3).
 *
 * The public import path for everything here is `@adminium/engine/adapter`,
 * which re-exports this module and binds the process-wide singleton
 * `adapterRegistry` to the concrete `AdapterProvider` contract
 * (01-architecture.md §2.3.1):
 *
 * ```ts
 * import { adapterRegistry } from '@adminium/engine/adapter';
 * import { postgresAdapter } from '@adminium/adapter-postgres';
 *
 * adapterRegistry.register(postgresAdapter); // dialect: 'postgres'
 * ```
 *
 * v1.x adapters (MongoDB, MSSQL) plug into the same registry without
 * touching engine internals.
 */
import type { Dialect } from './schema-model.js';

// ---------------------------------------------------------------------------
// Typed errors (05 §3)
// ---------------------------------------------------------------------------

export const ADAPTER_ERROR_CODES = [
  'AUTH',
  'HOST_UNREACHABLE',
  'TLS',
  'PERMISSION',
  'TIMEOUT',
  'SCHEMA_DRIFT',
  'UNSUPPORTED',
  'UNKNOWN',
] as const;
export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[number];

/**
 * The only error type adapter methods may reject with. The Studio wizard and
 * the `diagnostics-readout` widget map `code` to remediation copy (e.g. the
 * allowlist-IP hint per designs/System States).
 */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  /** Machine-oriented details (driver error code, host, …). */
  readonly detail: string | null;
  /** Human remediation hint. */
  readonly hint: string | null;

  constructor(
    code: AdapterErrorCode,
    message: string,
    options: { detail?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AdapterError';
    this.code = code;
    this.detail = options.detail ?? null;
    this.hint = options.hint ?? null;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** The minimal shape the registry keys on; the full contract is `AdapterProvider` (./adapter.ts). */
export interface DialectKeyed {
  readonly dialect: Dialect;
}

export class AdapterRegistry<Provider extends DialectKeyed = DialectKeyed> {
  readonly #providers = new Map<Dialect, Provider>();

  /**
   * Register a provider for its dialect. Registering the same dialect twice
   * is a boot-composition bug and throws; call `unregister` first if a test
   * genuinely needs to swap providers.
   */
  register(provider: Provider): void {
    if (this.#providers.has(provider.dialect)) {
      throw new Error(`adapter for dialect "${provider.dialect}" is already registered`);
    }
    this.#providers.set(provider.dialect, provider);
  }

  /** Look up a provider; throws a typed UNSUPPORTED error when absent. */
  get(dialect: Dialect): Provider {
    const provider = this.#providers.get(dialect);
    if (provider === undefined) {
      const known = this.list();
      throw new AdapterError('UNSUPPORTED', `no adapter registered for dialect "${dialect}"`, {
        hint:
          known.length > 0
            ? `registered dialects: ${known.join(', ')}`
            : 'no adapters registered — did the server boot call register()?',
      });
    }
    return provider;
  }

  has(dialect: Dialect): boolean {
    return this.#providers.has(dialect);
  }

  /** Registered dialects, in registration order. */
  list(): Dialect[] {
    return [...this.#providers.keys()];
  }

  /** Remove one provider (tests, hot-swap). Returns whether it existed. */
  unregister(dialect: Dialect): boolean {
    return this.#providers.delete(dialect);
  }

  /** Remove everything (tests only). */
  clear(): void {
    this.#providers.clear();
  }
}
