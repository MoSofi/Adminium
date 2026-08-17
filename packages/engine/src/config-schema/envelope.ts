import { layoutItemSchema, pageLayoutSchema, queryDescriptorSchema } from '@adminium/widgets/page-config';
import { z } from 'zod';

/**
 * The config envelope every stored config document uses (01-architecture.md
 * §6.1, 07-meta-store.md §3.17). The envelope persists verbatim into
 * `adminium_pages.config`; the stored version path the config-migration
 * runner keys on is `config.v`.
 */
export const CONFIG_KINDS = ['page', 'dashboard', 'view', 'nav', 'manifest-module'] as const;
export const configKindSchema = z.enum(CONFIG_KINDS);
export type ConfigKind = z.infer<typeof configKindSchema>;

/**
 * Prefixed document id: `page_`/`view_`/`nav_` + slug or ULID suffix.
 * Engine-generated ids carry ULID suffixes (`page_01HZX…`); hand-authored and
 * seeded documents may use readable slugs (`page_customers`, per the §3.17
 * examples), so the suffix alphabet is not restricted to Crockford base32.
 */
export const configIdPattern = /^(page|view|nav)_[A-Za-z0-9][A-Za-z0-9_-]*$/;

const kebabCasePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Nav placement block (01-architecture.md §6.1). */
export const navConfigSchema = z.object({
  group: z.string().min(1),
  icon: z.string().min(1), // lucide-react icon name
  order: z.number().int(),
  slug: z.string().regex(kebabCasePattern, 'must be kebab-case').optional(),
  badge: z.string().min(1).optional(),
});
export type NavConfig = z.infer<typeof navConfigSchema>;

/**
 * Per-page gutter override for the inner main section (02-design-system.md
 * §1.8). OMITTED is the common case and means "whatever this template
 * normally uses" — only an explicit value overrides, so the default can be
 * retuned centrally without rewriting stored documents.
 *
 * `none` and `standard` name the two shared choices; the object form is an
 * explicit x/y pair in CSS pixels. Capped at 200px because the control that
 * writes it is a number input, and a page inset by four figures is a support
 * ticket, not a layout.
 */
export const pagePaddingSchema = z.union([
  z.literal('none'),
  z.literal('standard'),
  z.object({
    x: z.number().int().min(0).max(200),
    y: z.number().int().min(0).max(200),
  }),
]);
export type PagePaddingConfig = z.infer<typeof pagePaddingSchema>;

const envelopeShape = z.object({
  v: z.literal(1), // config schema version (integer, 01-architecture.md §8.2)
  kind: configKindSchema,
  id: z
    .string()
    .regex(configIdPattern, 'must be a prefixed document id (page_* / view_* / nav_*)'),
  template: z.string().regex(kebabCasePattern, 'must be a kebab-case Registry id'),
  title: z.object({ key: z.string().min(1), fallback: z.string().min(1) }),
  // Data-scope defaults for widgets/bindings on this page.
  source: z.object({
    connectionId: z.string().nullable(),
    table: z.string().nullable(), // "public.orders" — primary table for record pages
  }),
  nav: navConfigSchema,
  access: z.object({ minRole: z.string().min(1), permissions: z.array(z.string()) }),
  // Page chrome, not template body — hence a sibling of `config` rather than a
  // key inside it. Optional so every stored document predating it still
  // validates and keeps rendering with its template's own gutter.
  padding: pagePaddingSchema.optional(),
  // Per-template body. Unknown fields are preserved on round-trip
  // (forward compatibility, 01-architecture.md §6.2); per-template schemas
  // live in @adminium/widgets/page-config and are applied by kind below.
  // `config.templateVersion` (stamped by composeTemplate from the manifest) is
  // ADVISORY-ONLY until the 04-T15 per-template migrations/ mechanism lands:
  // nothing validates or migrates on it — the migration chain keys solely on
  // the envelope `v` above, and stored pre-stamp documents render fine because
  // layouts are self-contained. 04 §10's "version bumps let H5 migrate old
  // configs deliberately" gets its enforcement surface with 04-T15.
  config: z.record(z.string(), z.unknown()),
});

export const pageEnvelopeSchema = envelopeShape.superRefine((doc, ctx) => {
  if (doc.kind !== 'dashboard') return;
  const layout = pageLayoutSchema.safeParse(doc.config['layout']);
  if (layout.success) return;
  for (const issue of layout.error.issues) {
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: ['config', 'layout', ...issue.path],
    });
  }
});

export type PageEnvelope = z.infer<typeof pageEnvelopeSchema>;
/** Canonical alias used across the specs. */
export type PageConfig = PageEnvelope;

/**
 * A validated dashboard widget instance (01-architecture.md §6.1): a grid
 * layout item whose `config.binding`, when present, must be a declarative
 * query descriptor (04-widget-registry.md §5.1).
 */
export const widgetConfigSchema = layoutItemSchema.superRefine((item, ctx) => {
  const binding = item.config['binding'];
  if (binding === undefined) return;
  const descriptor = queryDescriptorSchema.safeParse(binding);
  if (descriptor.success) return;
  for (const issue of descriptor.error.issues) {
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: ['config', 'binding', ...issue.path],
    });
  }
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;
