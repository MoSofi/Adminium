// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One rule for turning a loaded add-on module into a `document-render@1`
 * provider (0.3 trap 11).
 *
 * ─── WHY THIS IS A FILE AND NOT A LOCAL FUNCTION ───────────────────────────
 *
 * It was a local function twice — once in the pipeline and once in the routes
 * — and the two had already drifted before a third caller arrived:
 *
 *   - the pipeline unwrapped the module FIRST and fell back to `.default`;
 *     the routes read `.default` FIRST and fell back to the module. A module
 *     that is both a namespace with `kinds` and a `default` export would have
 *     resolved to different objects in the two, which is the shape of a bug
 *     nobody would look for.
 *   - the pipeline required `render`, the routes did not — reasonably, since
 *     they only read labels. That difference is real and is kept, but as an
 *     explicit second check rather than as two spellings of the first.
 *
 * ─── THE SHAPE IS THE CONTRACT'S, NARROWED ─────────────────────────────────
 *
 * `@adminium/add-on-contracts` is the canonical `DocumentRenderer`, and this
 * server cannot import it at runtime — an add-on's module arrives as an opaque
 * `unknown` from the runtime loader. So the fields the server actually reads
 * are declared here, and everything else the contract carries is ignored
 * rather than re-typed.
 */

import type { SubjectSlot } from './subject.js';

/**
 * The contract this pipeline consumes, at the version it was bought at.
 *
 * Declared here rather than in `render.ts`, which re-exports them: `deliver.ts`
 * needs them too, and `render.ts` imports `deliver.ts`, so a definition there
 * made the two modules import each other.
 */
export const DOCUMENT_RENDER_CONTRACT = 'document-render';
export const DOCUMENT_RENDER_VERSION = 1;

/** What every consumer of a provider reads: the kinds it can draw. */
export interface DocumentProviderKind {
  id: string;
  /** The provider's own eight-locale record (D14) — never a key. */
  label: Record<string, string>;
  formats: readonly string[];
  paper: readonly string[];
  coverage: string;
}

export interface DocumentProviderModule {
  kinds(): readonly DocumentProviderKind[];
  describe(kind: string): { slots: readonly unknown[] };
}

/**
 * A provider that can also DRAW — what the render pipeline needs.
 *
 * `describe` is narrowed to the pipeline's own `SubjectSlot`, which is the
 * shape it coerces against. The routes keep the wider `unknown[]` because they
 * only forward the outline to an editor that reads it as data.
 */
export interface RenderingProvider extends DocumentProviderModule {
  describe(kind: string): { slots: readonly SubjectSlot[] };
  render(input: unknown): Promise<unknown>;
}

/**
 * The provider inside a loaded module, or null.
 *
 * Reads the module ITSELF before `.default`: a package built as ESM exports its
 * functions at the top level, and one bundled through an interop layer carries
 * them under `default`. Trying the top level first means the common case never
 * depends on the bundler's choice.
 */
export function providerOf(module: unknown): DocumentProviderModule | null {
  const direct = shaped(module);
  if (direct !== null) return direct;
  return shaped((module as { default?: unknown } | null)?.default);
}

/** The same, for a caller that will actually call `render`. */
export function renderingProviderOf(module: unknown): RenderingProvider | null {
  const provider = providerOf(module);
  return provider !== null && typeof (provider as Partial<RenderingProvider>).render === 'function'
    ? (provider as unknown as RenderingProvider)
    : null;
}

function shaped(candidate: unknown): DocumentProviderModule | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as Partial<DocumentProviderModule>;
  return typeof partial.kinds === 'function' && typeof partial.describe === 'function'
    ? (partial as DocumentProviderModule)
    : null;
}

/**
 * The provider's word for a kind, in a locale, falling back to en-US and then
 * to the kind's own id.
 *
 * The last step is the one worth stating: a provider whose label record is
 * incomplete fails its own conformance suite, so reaching the id means
 * something is wrong upstream — and showing the id is how somebody finds out,
 * where showing nothing would look like an empty subject line.
 */
export function labelForKind(
  provider: DocumentProviderModule | null,
  kind: string,
  locale: string,
): string {
  const label = provider?.kinds().find((row) => row.id === kind)?.label;
  if (label === undefined) return kind;
  const exact = label[locale];
  if (typeof exact === 'string' && exact !== '') return exact;
  const english = label['en-US'];
  return typeof english === 'string' && english !== '' ? english : kind;
}
