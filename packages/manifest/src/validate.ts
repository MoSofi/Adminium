/**
 * Manifest validation entry point (13-marketplace.md §2, §9). Layers the
 * envelope schema with the v1 publisher policy: the installer rejects any
 * `publisher.id` other than `adminium` unless the `third-party-publishers`
 * feature flag is on (off in v1). Pure — safe in the browser storefront.
 */

import { FIRST_PARTY_PUBLISHER_ID, manifestSchema, type Manifest } from './schema.js';

export interface ManifestIssue {
  /** Dotted path to the offending field, e.g. `publisher.id`. */
  path: string;
  message: string;
}

export interface ValidateManifestOptions {
  /**
   * Allow a non-`adminium` publisher. Wired to the `third-party-publishers`
   * feature flag (§9); OFF in v1, so third-party manifests are rejected.
   */
  allowThirdPartyPublishers?: boolean;
}

export type ValidateManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: ManifestIssue[] };

/**
 * Validate an untrusted manifest document. Returns the typed manifest on
 * success, or every issue found (schema + policy) on failure — never throws.
 */
export function validateManifest(
  input: unknown,
  opts: ValidateManifestOptions = {},
): ValidateManifestResult {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  }

  const manifest = parsed.data;
  const issues: ManifestIssue[] = [];

  if (!(opts.allowThirdPartyPublishers ?? false) && manifest.publisher.id !== FIRST_PARTY_PUBLISHER_ID) {
    issues.push({
      path: 'publisher.id',
      message: `third-party publishers are not accepted in v1 (expected "${FIRST_PARTY_PUBLISHER_ID}")`,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest };
}

/** Throwing variant for trusted callers (build tooling); use the safe form at runtime. */
export function parseManifest(input: unknown, opts: ValidateManifestOptions = {}): Manifest {
  const result = validateManifest(input, opts);
  if (!result.ok) {
    const summary = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`invalid manifest: ${summary}`);
  }
  return result.manifest;
}
