/**
 * Boot-time adapter registration (01-architecture.md §2.3.1): the server —
 * and only the server — composes concrete adapter packages into the engine's
 * process-wide registry. Adapter packages import `@adminium/engine/adapter`;
 * the engine never imports adapters; everything stays acyclic.
 *
 * The adapter package is loaded dynamically and duck-checked because the
 * provider export lands in the same wave as this module — a stub package
 * (M0 scaffold) simply registers nothing, and PG-dependent features report
 * `UNSUPPORTED` through the registry's typed error instead of crashing boot.
 */

import { adapterRegistry, type AdapterProvider, type AdapterRegistry } from '@adminium/engine/adapter';

function isAdapterProvider(value: unknown): value is AdapterProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.dialect === 'string' &&
    typeof candidate.create === 'function' &&
    typeof candidate.createQueryEngine === 'function'
  );
}

/** Find an AdapterProvider among a module's exports (named, default, or factory). */
export function providerFromModule(mod: unknown): AdapterProvider | null {
  if (typeof mod !== 'object' || mod === null) return null;
  const exportsRecord = mod as Record<string, unknown>;
  const preferred = ['postgresAdapter', 'adapterProvider', 'provider', 'default'];
  for (const key of preferred) {
    if (isAdapterProvider(exportsRecord[key])) return exportsRecord[key] as AdapterProvider;
  }
  for (const value of Object.values(exportsRecord)) {
    if (isAdapterProvider(value)) return value;
  }
  return null;
}

export interface RegisterAdaptersResult {
  /** Dialects registered by this call (already-registered ones are skipped). */
  registered: string[];
  /** Adapter packages present but exposing no provider yet (wave-A stubs). */
  missing: string[];
}

/**
 * Register every available adapter package. Idempotent: dialects already in
 * the registry are left untouched (tests re-build apps against the same
 * process-wide registry).
 */
export async function registerAdapters(
  registry: AdapterRegistry<AdapterProvider> = adapterRegistry,
): Promise<RegisterAdaptersResult> {
  const result: RegisterAdaptersResult = { registered: [], missing: [] };
  const packages = ['@adminium/adapter-postgres'];
  for (const pkg of packages) {
    let mod: unknown;
    try {
      mod = await import(pkg);
    } catch {
      result.missing.push(pkg);
      continue;
    }
    const provider = providerFromModule(mod);
    if (provider === null) {
      result.missing.push(pkg);
      continue;
    }
    if (!registry.has(provider.dialect)) {
      registry.register(provider);
      result.registered.push(provider.dialect);
    }
  }
  return result;
}
