/**
 * The in-app Knowledge Base index (M10-T06).
 *
 * WHAT THIS IS — AND DELIBERATELY IS NOT. This is an INDEX, not a copy of the
 * documentation. Each entry is a title, a one-line excerpt, a category and a
 * deep link to docs.adminium.ai (Track DOCS, M10-T05), which is the single
 * source of truth for the prose. Duplicating the docs here would create two
 * copies of every answer with no mechanism to keep them in step — and the
 * in-app copy would be the stale one, because it ships on the app's release
 * cadence rather than the docs'. `ia-mapping.md` §2F is explicit that the KB
 * comp is the *pattern* for the docs site; the docs site owns the content.
 *
 * The comp's sample articles ARE the draft docs IA (`ia-mapping.md` §4: "KB
 * content = draft real docs"), so the categories and titles below follow it,
 * re-pointed from the sample SaaS domain onto Adminium's actual v0.5 surface:
 * the comp's "Connecting your first database" and "Authenticating with API
 * keys" are real pages; its "Setting up SSO with Okta" and "Slack & Teams
 * notifications" describe features that do not exist and are dropped rather
 * than linked into a 404.
 *
 * SEARCH IS LOCAL. The index is small and ships with the bundle, so filtering
 * is a substring match over titles and excerpts — no request per keystroke, and
 * it works on an air-gapped Electron install (M11) where the docs links do not.
 *
 * TRANSLATION. Titles/excerpts are i18n KEYS, not literals: unlike changelog
 * entries (a historical record), help copy is live UI text a reader needs in
 * their own language. `docsPath` stays language-neutral — the docs site does its
 * own locale negotiation.
 */
import { z } from 'zod';

export const KB_CATEGORIES = ['start', 'connect', 'api', 'security', 'selfhost', 'trouble'] as const;
export type KbCategoryId = (typeof KB_CATEGORIES)[number];

export const kbArticleSchema = z.object({
  id: z.string().min(1),
  category: z.enum(KB_CATEGORIES),
  /** i18n key for the title; the fallback is the en-US copy. */
  titleKey: z.string().min(1),
  titleFallback: z.string().min(1),
  excerptKey: z.string().min(1),
  excerptFallback: z.string().min(1),
  /** Path on docs.adminium.ai — resolved through `docsLinks.ts`. */
  docsPath: z.string().min(1),
});

export type KbArticle = z.infer<typeof kbArticleSchema>;

const RAW: unknown = [
  {
    id: 'install',
    category: 'start',
    titleKey: 'kb.article.install.title',
    titleFallback: 'Install Adminium',
    excerptKey: 'kb.article.install.excerpt',
    excerptFallback: 'Run npx adminium, or docker run, and reach the first-run wizard in a minute.',
    docsPath: 'getting-started/quickstart',
  },
  {
    id: 'first-admin',
    category: 'start',
    titleKey: 'kb.article.firstAdmin.title',
    titleFallback: 'Create your first super admin',
    excerptKey: 'kb.article.firstAdmin.excerpt',
    excerptFallback: 'What the first-run wizard asks for, and why it can only run once.',
    docsPath: 'getting-started/quickstart#2-run-the-wizard',
  },
  {
    id: 'connect-db',
    category: 'connect',
    titleKey: 'kb.article.connectDb.title',
    titleFallback: 'Connecting your first database',
    excerptKey: 'kb.article.connectDb.excerpt',
    excerptFallback: 'Point Adminium at PostgreSQL, MySQL or SQLite and generate an admin app.',
    docsPath: 'getting-started/first-connection',
  },
  {
    id: 'schema-file',
    category: 'connect',
    titleKey: 'kb.article.schemaFile.title',
    titleFallback: 'Generate from a schema file',
    excerptKey: 'kb.article.schemaFile.excerpt',
    excerptFallback: 'Upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump — no connection needed.',
    docsPath: 'guides/schema-import',
  },
  {
    id: 'read-only',
    category: 'connect',
    titleKey: 'kb.article.readOnly.title',
    titleFallback: 'Use a read-only role',
    excerptKey: 'kb.article.readOnly.excerpt',
    excerptFallback: 'Introspection reads schema metadata only. Give Adminium the least privilege it needs.',
    docsPath: 'guides/connect/read-only-and-meta',
  },
  {
    id: 'api-keys',
    category: 'api',
    titleKey: 'kb.article.apiKeys.title',
    titleFallback: 'Authenticating with API keys',
    excerptKey: 'kb.article.apiKeys.excerpt',
    excerptFallback: 'Create and revoke keys, and why a key is only ever shown to you once.',
    docsPath: 'reference/rest-api#authentication',
  },
  {
    id: 'rest',
    category: 'api',
    titleKey: 'kb.article.rest.title',
    titleFallback: 'REST API reference',
    excerptKey: 'kb.article.rest.excerpt',
    excerptFallback: 'Every endpoint the generated app exposes, with request and response shapes.',
    docsPath: 'reference/rest-api',
  },
  {
    id: 'manifest',
    category: 'api',
    titleKey: 'kb.article.manifest.title',
    titleFallback: 'The page manifest',
    excerptKey: 'kb.article.manifest.excerpt',
    excerptFallback: 'How a page is described as config, and how to hand-edit one.',
    docsPath: 'reference/manifest',
  },
  {
    id: 'roles',
    category: 'security',
    titleKey: 'kb.article.roles.title',
    titleFallback: 'Roles & permissions',
    excerptKey: 'kb.article.roles.excerpt',
    excerptFallback: 'Assign Viewer, Editor and Admin, and build your own roles from the permission matrix.',
    docsPath: 'self-hosting/security#accounts',
  },
  {
    id: 'audit',
    category: 'security',
    titleKey: 'kb.article.audit.title',
    titleFallback: 'Reading the audit log',
    excerptKey: 'kb.article.audit.excerpt',
    excerptFallback: 'Who changed what, when, and from where.',
    docsPath: 'self-hosting/security#the-audit-log',
  },
  {
    id: 'secrets',
    category: 'security',
    titleKey: 'kb.article.secrets.title',
    titleFallback: 'How Adminium stores your secrets',
    excerptKey: 'kb.article.secrets.excerpt',
    excerptFallback: 'Connection credentials are encrypted at rest with ADMINIUM_SECRET. API keys are hashed.',
    docsPath: 'self-hosting/security#adminium_secret',
  },
  {
    id: 'docker',
    category: 'selfhost',
    titleKey: 'kb.article.docker.title',
    titleFallback: 'Self-host with Docker',
    excerptKey: 'kb.article.docker.excerpt',
    excerptFallback: 'The official image, docker-compose, and running a separate meta database.',
    docsPath: 'self-hosting/docker-compose',
  },
  {
    id: 'backup',
    category: 'selfhost',
    titleKey: 'kb.article.backup.title',
    titleFallback: 'Back up and move an instance',
    excerptKey: 'kb.article.backup.excerpt',
    excerptFallback: 'export-zip bundles your server config; import it to replay the same setup elsewhere.',
    docsPath: 'self-hosting/export-zip',
  },
  {
    id: 'telemetry',
    category: 'selfhost',
    titleKey: 'kb.article.telemetry.title',
    titleFallback: 'Telemetry and update checks',
    excerptKey: 'kb.article.telemetry.excerpt',
    excerptFallback: 'Both are opt-in and off by default. What is sent if you turn them on.',
    docsPath: 'self-hosting/telemetry',
  },
  {
    id: 'connection-fails',
    category: 'trouble',
    titleKey: 'kb.article.connectionFails.title',
    titleFallback: 'A database connection fails',
    excerptKey: 'kb.article.connectionFails.excerpt',
    excerptFallback: 'Read the diagnostics card: host, port, TLS, and the IP your database must allow.',
    docsPath: 'guides/connect/postgres',
  },
  {
    id: 'missing-tables',
    category: 'trouble',
    titleKey: 'kb.article.missingTables.title',
    titleFallback: 'Tables are missing after introspection',
    excerptKey: 'kb.article.missingTables.excerpt',
    excerptFallback: 'Schema visibility, excluded tables, and re-running generation.',
    docsPath: 'guides/connect/read-only-and-meta#what-you-lose-with-a-read-only-source',
  },
];

export const KB_ARTICLES: readonly KbArticle[] = z.array(kbArticleSchema).min(1).parse(RAW);

// --- pure filtering (unit-tested without a DOM) ------------------------------

/** Article count per category — the card subtitles, derived not hardcoded. */
export function countByCategory(articles: readonly KbArticle[]): Map<KbCategoryId, number> {
  const counts = new Map<KbCategoryId, number>();
  for (const article of articles) {
    counts.set(article.category, (counts.get(article.category) ?? 0) + 1);
  }
  return counts;
}

/**
 * Category filter + substring search over the LOCALIZED title and excerpt.
 *
 * Matching the translated text — not the English source — is the whole point: a
 * de-DE reader searching "Datenbank" must find the database article, and they
 * only can if we search what is on their screen. Hence `resolve`, which the page
 * supplies from `t()`.
 */
export function filterArticles(
  articles: readonly KbArticle[],
  options: {
    category: KbCategoryId | null;
    query: string;
    resolve: (article: KbArticle) => { title: string; excerpt: string };
  },
): KbArticle[] {
  const needle = options.query.trim().toLocaleLowerCase();
  return articles.filter((article) => {
    if (options.category !== null && article.category !== options.category) return false;
    if (needle === '') return true;
    const { title, excerpt } = options.resolve(article);
    return (
      title.toLocaleLowerCase().includes(needle) || excerpt.toLocaleLowerCase().includes(needle)
    );
  });
}
