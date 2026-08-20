// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hand-written declarations for the plain-ESM coverage helper.
 *
 * `packages/config` has no TypeScript build (its `typecheck` script is a no-op),
 * but every `vitest.config.ts` that imports this IS typechecked — and a
 * dashboard `build` runs `tsc --noEmit` over its own config file. Without this
 * file that build fails with TS7016 on an implicit `any`.
 */
export interface CoverageOptions {
  /** Statement floor. Omit to collect and report without asserting. */
  statements?: number;
  /** Branch floor. Required whenever `statements` is given. */
  branches?: number;
  /** Extra globs appended to the shared exclude list. */
  exclude?: readonly string[];
}

/** Build a package's `test.coverage` block. See index.js for the policy. */
export function coverage(options?: CoverageOptions): Record<string, unknown>;

/**
 * Build a package's worker cap. `share` is a vitest `maxWorkers` value — a
 * percentage string is preferred so the cap scales with the machine. See
 * index.js for why this exists at all.
 */
export function workers(share?: string | number): { maxWorkers: string | number; minWorkers: number };
