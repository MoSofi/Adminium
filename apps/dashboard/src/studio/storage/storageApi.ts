// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage-destinations data layer (37-files-and-storage.md §3.8, 37-T21) over
 * `/api/v1/storage/*` and `GET /api/v1/files/usage`
 * (`apps/server/src/routes/storage/`, `routes/files/`).
 *
 * Shapes mirror the server's Zod replies (`routes/storage/schema.ts` and the
 * config schemas in `@adminium/meta`'s `json-payloads.ts`) — the copied-mirror
 * convention this app uses everywhere: change both together. They are hand
 * mirrors rather than an import of the Zod types because the dashboard must
 * not pull the meta package (and its database machinery) into a browser chunk.
 *
 * THREE THINGS IN HERE ARE LOAD-BEARING AND ARE NOT PRESENTATION:
 *
 * 1. **The write-only secret.** A stored destination reports `hasSecret` and
 *    the server never sends the credential back, so the editor has nothing to
 *    round-trip. That is a feature, and it makes ONE mistake catastrophic:
 *    sending `secret: ''` — or a half-typed pair — on a PATCH would replace a
 *    working credential with a broken one and take every future upload down
 *    with it. {@link patchBodyFromDraft} therefore omits the key entirely
 *    unless a COMPLETE new credential was typed, and {@link draftSecretIssue}
 *    turns a half-typed pair into a refusal the operator can see rather than a
 *    silent drop.
 *
 * 2. **"This server's disk" is not a row.** `destination_id IS NULL` is the
 *    implicit destination (37 D3): it has no id, cannot be edited, disabled or
 *    deleted, and is addressed on the migrate route by the sentinel string
 *    `local` ({@link LOCAL_DESTINATION_VALUE}). Every picker in this feature
 *    has to offer it on both sides, so the sentinel lives here and not in a
 *    component.
 *
 * 3. **The presets fill mechanics, never a wrong value.** A preset that cannot
 *    know the operator's region or account id leaves the field EMPTY and hands
 *    the shape to the placeholder instead (`endpointHint`, `regionHint`). A
 *    plausible-looking wrong endpoint is worse than a blank one: it fails at
 *    the first upload rather than at Test.
 */
import { queryOptions } from '@tanstack/react-query';
import { getFormatters } from '@adminium/i18n';

import { api, ApiError } from '../../app/api.js';
import { getI18nInstance } from '../../i18n/t.js';

export type StorageDriver = 'local' | 's3' | 'webdav';
export type DestinationStatus = 'untested' | 'ok' | 'error';

/** Mirrors `localDestinationConfigSchema`. */
export interface LocalDestinationConfig {
  root: string;
}

/** Mirrors `s3DestinationConfigSchema`. */
export interface S3DestinationConfig {
  /** Absent = AWS itself, whose endpoint the server derives from the region. */
  endpoint?: string;
  region: string;
  bucket: string;
  prefix?: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
}

/** Mirrors `webdavDestinationConfigSchema`. */
export interface WebdavDestinationConfig {
  url: string;
  prefix?: string;
  publicBaseUrl?: string;
}

export type DestinationConfig =
  | LocalDestinationConfig
  | S3DestinationConfig
  | WebdavDestinationConfig;

/** Mirrors `destinationSecret` — a union, discriminated by the driver. */
export type DestinationSecret =
  | { accessKeyId: string; secretAccessKey: string }
  | { username: string; password: string };

/** Mirrors `destinationView`. The credential is never in here — see the header. */
export interface DestinationView {
  id: string;
  name: string;
  driver: StorageDriver;
  config: DestinationConfig;
  /** True when a credential is stored. The credential itself never appears. */
  hasSecret: boolean;
  isDefault: boolean;
  status: DestinationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** Live rows pointing here — what makes a delete refusal explicable. */
  fileCount: number;
}

/** Mirrors `destinationTestReply`'s `data`. A failure is a 200 — see below. */
export type DestinationTestResult = { ok: true; latencyMs: number } | { ok: false; error: string };

/** Mirrors one row of `filesUsageReply`. `destinationId: null` is this server's disk. */
export interface StorageUsageEntry {
  destinationId: string | null;
  name: string;
  driver: string;
  files: number;
  bytes: number;
  /** Local destinations only — a bucket cannot know (37 D23). */
  available?: number;
}

/**
 * How "this server's disk" is said on the wire. `POST /storage/migrate` takes
 * `null` OR this sentinel for the implicit destination; a `<select>` cannot
 * carry `null`, so the value travels as the string and the server maps it back
 * (`toDestinationId`).
 */
export const LOCAL_DESTINATION_VALUE = 'local';

export const DESTINATIONS_QUERY_KEY = ['storage', 'destinations'] as const;
export const STORAGE_USAGE_QUERY_KEY = ['storage', 'usage'] as const;

export function destinationsQuery() {
  return queryOptions({
    queryKey: DESTINATIONS_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ data: DestinationView[] }>('/api/v1/storage/destinations')).data,
    /*
     * THE OPTIONS ARE PART OF THE CONTRACT, not a local preference, because
     * three surfaces read this list: this page, the ColumnManager's File
     * section and the EditPageScreen's Attachments card. React Query keys the
     * cache on `queryKey` alone, so three call sites with three different
     * option sets share ONE entry and whichever mounts first silently decides
     * the retry behaviour for the other two. They all import this instead.
     *
     * `retry: false` because the interesting failure is a 403: an admin who
     * can edit pages may not hold `storage.manage`, and retrying a permission
     * refusal three times only delays the fallback to "the workspace default
     * is your only option".
     */
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Bytes and file counts per destination, including the implicit one — and the
 * only source of "available on this disk", which the local driver reads from
 * `statfs`. Separate from the destinations list because it is the FILES route:
 * it answers for destinations that have no row, and it is readable with either
 * grant.
 */
export function storageUsageQuery() {
  return queryOptions({
    queryKey: STORAGE_USAGE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: StorageUsageEntry[] }>('/api/v1/files/usage')).data,
  });
}

export interface DestinationCreateBody {
  name: string;
  driver: StorageDriver;
  config: DestinationConfig;
  secret?: DestinationSecret;
  makeDefault?: boolean;
}

export interface DestinationPatchBody {
  name?: string;
  config?: DestinationConfig;
  /** Present ONLY when a complete new credential was typed — see the header. */
  secret?: DestinationSecret;
  disabled?: boolean;
}

export async function createDestination(body: DestinationCreateBody): Promise<DestinationView> {
  return (await api.post<{ data: DestinationView }>('/api/v1/storage/destinations', body)).data;
}

export async function updateDestination(
  id: string,
  body: DestinationPatchBody,
): Promise<DestinationView> {
  return (
    await api.patch<{ data: DestinationView }>(
      `/api/v1/storage/destinations/${encodeURIComponent(id)}`,
      body,
    )
  ).data;
}

export async function deleteDestination(id: string): Promise<DestinationView> {
  return (
    await api.delete<{ data: DestinationView }>(
      `/api/v1/storage/destinations/${encodeURIComponent(id)}`,
    )
  ).data;
}

/**
 * Probe a SAVED destination. Resolves for a failure too: the reply is a 200
 * whose `data.ok` is false, because "I could not reach your bucket" is a
 * successful answer to "can you reach my bucket". Routing the provider's own
 * message through an error boundary would discard the only part an operator
 * can act on, so callers must render `error` verbatim rather than replacing it
 * with copy of their own.
 */
export async function testDestination(id: string): Promise<DestinationTestResult> {
  return (
    await api.post<{ data: DestinationTestResult }>(
      `/api/v1/storage/destinations/${encodeURIComponent(id)}/test`,
    )
  ).data;
}

/** Same probe, for a draft nobody has stored yet — the first-configuration path. */
export async function testDraftDestination(body: {
  driver: StorageDriver;
  config: DestinationConfig;
  secret?: DestinationSecret;
}): Promise<DestinationTestResult> {
  return (
    await api.post<{ data: DestinationTestResult }>('/api/v1/storage/destinations/test', body)
  ).data;
}

export async function setDefaultDestination(id: string): Promise<DestinationView> {
  return (
    await api.post<{ data: DestinationView }>(
      `/api/v1/storage/destinations/${encodeURIComponent(id)}/default`,
    )
  ).data;
}

/**
 * Start a move. Both ends take {@link LOCAL_DESTINATION_VALUE} for the
 * implicit destination. Returns the job id and nothing else — the bytes move
 * in a worker, and this surface deliberately does not poll it.
 */
/**
 * The kinds a move may be narrowed to (`fileKindSchema` in `@adminium/meta`,
 * plus 34's `document` once it lands).
 *
 * Offered because "move my users' uploads to the bucket and leave the export
 * artifacts on the disk" is a real thing an operator wants on a box with a
 * small volume — and because the server has always accepted the parameter
 * (`routes/storage/schema.ts`), so not offering it was the UI hiding a
 * capability rather than the product not having one.
 */
export const MIGRATE_KINDS = ['upload', 'export', 'import', 'branding', 'schema', 'archive'] as const;
export type MigrateKind = (typeof MIGRATE_KINDS)[number];

export async function migrateFiles(input: {
  from: string;
  to: string;
  /** Empty or omitted = every kind, which is what the server does with no filter. */
  kinds?: readonly MigrateKind[];
}): Promise<string> {
  const reply = await api.post<{ data: { jobId: string } }>('/api/v1/storage/migrate', {
    from: input.from === LOCAL_DESTINATION_VALUE ? null : input.from,
    to: input.to === LOCAL_DESTINATION_VALUE ? null : input.to,
    // Omitted rather than sent empty: `kinds: []` would be a filter matching
    // nothing on a stricter reading, where absent unambiguously means "all".
    ...(input.kinds === undefined || input.kinds.length === 0 ? {} : { kinds: [...input.kinds] }),
  });
  return reply.data.jobId;
}

/* --- the editor draft (pure — unit-tested without a DOM) ------------------- */

/**
 * One flat draft for all three drivers.
 *
 * Flat rather than a per-driver sub-object because `prefix` and
 * `publicBaseUrl` genuinely ARE the same field on s3 and webdav, and because
 * switching the driver picker mid-edit must not throw away what was typed —
 * an operator who picks `webdav`, sees the wrong fields and picks `s3` again
 * gets their bucket back.
 *
 * The four credential fields start EMPTY on every open, including an edit of a
 * destination that has one, because there is nothing to prefill them with.
 * `hasSecret` is what lets the editor say so.
 */
export interface DestinationDraft {
  /** `null` on a destination that does not exist yet. */
  id: string | null;
  name: string;
  driver: StorageDriver;
  /** Which S3 preset last filled the endpoint/region/path-style fields. */
  presetId: S3PresetId;
  /** local */
  root: string;
  /** s3 */
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  /** webdav */
  url: string;
  /** s3 + webdav */
  prefix: string;
  publicBaseUrl: string;
  /** Write-only, always blank on open (see above). */
  accessKeyId: string;
  secretAccessKey: string;
  username: string;
  password: string;
  /** True when the server already holds a credential for this destination. */
  hasSecret: boolean;
}

export function emptyDraft(driver: StorageDriver = 's3'): DestinationDraft {
  return {
    id: null,
    name: '',
    driver,
    presetId: 'aws',
    root: '',
    endpoint: '',
    region: '',
    bucket: '',
    forcePathStyle: false,
    url: '',
    prefix: '',
    publicBaseUrl: '',
    accessKeyId: '',
    secretAccessKey: '',
    username: '',
    password: '',
    hasSecret: false,
  };
}

/**
 * A stored destination as an editable draft.
 *
 * THE CREDENTIAL FIELDS ARE LEFT BLANK ON PURPOSE and this function is where a
 * future change would break that: there is no value to copy — the server never
 * sent one — so anything that appeared in those fields would be invented.
 */
export function draftFromDestination(view: DestinationView): DestinationDraft {
  const draft = emptyDraft(view.driver);
  // One widened view of the config rather than three casts of the same object:
  // `prefix` and `publicBaseUrl` are literally the same property on the s3 and
  // webdav shapes, and reading them twice invited a "which one wins" question
  // that has no answer.
  const config = view.config as Partial<
    LocalDestinationConfig & S3DestinationConfig & WebdavDestinationConfig
  >;
  return {
    ...draft,
    id: view.id,
    name: view.name,
    driver: view.driver,
    presetId: view.driver === 's3' ? presetIdFor(config) : draft.presetId,
    root: config.root ?? '',
    endpoint: config.endpoint ?? '',
    region: config.region ?? '',
    bucket: config.bucket ?? '',
    forcePathStyle: config.forcePathStyle ?? false,
    url: config.url ?? '',
    prefix: config.prefix ?? '',
    publicBaseUrl: config.publicBaseUrl ?? '',
    hasSecret: view.hasSecret,
  };
}

/** Optional string fields are OMITTED when blank — the server's schemas take no empty string. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function configFromDraft(draft: DestinationDraft): DestinationConfig {
  if (draft.driver === 'local') return { root: draft.root.trim() };
  if (draft.driver === 'webdav') {
    return {
      url: draft.url.trim(),
      ...(optional(draft.prefix) === undefined ? {} : { prefix: draft.prefix.trim() }),
      ...(optional(draft.publicBaseUrl) === undefined
        ? {}
        : { publicBaseUrl: draft.publicBaseUrl.trim() }),
    };
  }
  return {
    ...(optional(draft.endpoint) === undefined ? {} : { endpoint: draft.endpoint.trim() }),
    region: draft.region.trim(),
    bucket: draft.bucket.trim(),
    ...(optional(draft.prefix) === undefined ? {} : { prefix: draft.prefix.trim() }),
    forcePathStyle: draft.forcePathStyle,
    ...(optional(draft.publicBaseUrl) === undefined
      ? {}
      : { publicBaseUrl: draft.publicBaseUrl.trim() }),
  };
}

/**
 * The credential the operator typed, or `null` for "they typed none".
 *
 * `null` is not "clear it": the caller must OMIT the key, which is what the
 * server reads as "keep what is stored". A half-typed pair is also `null` here
 * and is reported separately by {@link draftSecretIssue}, so the two failure
 * modes never collapse into one silent one.
 */
export function secretFromDraft(draft: DestinationDraft): DestinationSecret | null {
  if (draft.driver === 's3') {
    const accessKeyId = draft.accessKeyId.trim();
    const secretAccessKey = draft.secretAccessKey.trim();
    if (accessKeyId === '' || secretAccessKey === '') return null;
    return { accessKeyId, secretAccessKey };
  }
  if (draft.driver === 'webdav') {
    const username = draft.username.trim();
    const password = draft.password.trim();
    if (username === '' || password === '') return null;
    return { username, password };
  }
  // A path on this machine has no credential to carry.
  return null;
}

/**
 * `'partial'` when exactly one half of a credential pair was typed.
 *
 * Worth its own answer because the alternative is the quiet one: the save
 * would succeed, the key would be dropped, and the destination would keep
 * working on the OLD credential the operator believed they had just replaced.
 */
export function draftSecretIssue(draft: DestinationDraft): 'partial' | null {
  const pair =
    draft.driver === 's3'
      ? [draft.accessKeyId.trim(), draft.secretAccessKey.trim()]
      : draft.driver === 'webdav'
        ? [draft.username.trim(), draft.password.trim()]
        : [];
  const typed = pair.filter((value) => value !== '').length;
  return typed === 1 ? 'partial' : null;
}

export function createBodyFromDraft(draft: DestinationDraft): DestinationCreateBody {
  const secret = secretFromDraft(draft);
  return {
    name: draft.name.trim(),
    driver: draft.driver,
    config: configFromDraft(draft),
    ...(secret === null ? {} : { secret }),
  };
}

/**
 * The PATCH body for an edit.
 *
 * The `secret` key is present only when a complete credential was typed. Every
 * other path — untouched fields, a name change, a bucket rename — leaves it
 * out, and the server keeps the stored one. Sending an empty string instead
 * would be a real credential loss with no undo, so this is the one function in
 * the feature whose absence of a key is the whole point.
 */
export function patchBodyFromDraft(draft: DestinationDraft): DestinationPatchBody {
  const secret = secretFromDraft(draft);
  return {
    name: draft.name.trim(),
    config: configFromDraft(draft),
    ...(secret === null ? {} : { secret }),
  };
}

/** The draft body for `POST /storage/destinations/test` — same rules, no name. */
export function testBodyFromDraft(draft: DestinationDraft): {
  driver: StorageDriver;
  config: DestinationConfig;
  secret?: DestinationSecret;
} {
  const secret = secretFromDraft(draft);
  return {
    driver: draft.driver,
    config: configFromDraft(draft),
    ...(secret === null ? {} : { secret }),
  };
}

/**
 * Whether the draft has enough to be saved at all — the Save button's gate.
 *
 * Deliberately thin: the server validates properly and says why. This exists
 * so the common blank-form case is not a round trip, not to reimplement Zod.
 */
export function draftIsSavable(draft: DestinationDraft): boolean {
  if (draft.name.trim() === '') return false;
  if (draftSecretIssue(draft) !== null) return false;
  if (draft.driver === 'local') return draft.root.trim() !== '';
  if (draft.driver === 'webdav') return draft.url.trim() !== '';
  return draft.bucket.trim() !== '' && draft.region.trim() !== '';
}

/* --- the S3 presets -------------------------------------------------------- */

export type S3PresetId = 'aws' | 'spaces' | 'r2' | 'tigris' | 'b2' | 'wasabi' | 'minio';

export interface S3Preset {
  id: S3PresetId;
  /**
   * Endpoint this preset can fill in COMPLETELY. `''` means the operator has
   * to supply it — either because the provider derives it from the region
   * (AWS) or because only they know their account id or region.
   */
  endpoint: string;
  /** Shape to show as the endpoint field's placeholder while it is empty. */
  endpointHint: string;
  /** Region this preset knows; `''` when only the operator does. */
  region: string;
  regionHint: string;
  /**
   * `<endpoint>/<bucket>/<key>` rather than `<bucket>.<endpoint>/<key>`. The
   * managed providers all issue per-bucket hostnames; self-hosted servers
   * mostly do not.
   */
  forcePathStyle: boolean;
}

/**
 * The picker's mechanics. Labels are NOT here: they are seven static `t()`
 * calls at the render site, because a key assembled from `preset.id` would be
 * invisible to the extractor and to the parity gate (`no-dynamic-i18n-key`).
 *
 * Provider names are used nominatively as picker labels, which 24 D12 allows;
 * what it bans is logos, and there are none.
 */
/*
 * WHY THESE DISAGREE WITH THE ENVIRONMENT SEED, ON PURPOSE.
 *
 * `config/storage-seed.ts` defaults `forcePathStyle` to TRUE whenever an
 * endpoint is given, because a bare URL tells it nothing about the provider
 * and path-style is the form every S3-compatible target accepts — the safe
 * blanket guess. These presets are not guessing: each one encodes what its
 * provider actually documents, which is virtual-hosted for the managed
 * services that issue per-bucket hostnames. Either way the operator can flip
 * the switch, and `Test` tells them within a second which one their target
 * wanted.
 */
const AWS_PRESET: S3Preset = {
  id: 'aws',
  endpoint: '',
  endpointHint: '',
  region: '',
  regionHint: 'us-east-1',
  forcePathStyle: false,
};

export const S3_PRESETS: readonly S3Preset[] = [
  AWS_PRESET,
  {
    id: 'spaces',
    endpoint: '',
    endpointHint: 'https://nyc3.digitaloceanspaces.com',
    region: '',
    regionHint: 'nyc3',
    forcePathStyle: false,
  },
  {
    id: 'r2',
    endpoint: '',
    endpointHint: 'https://<account-id>.r2.cloudflarestorage.com',
    region: 'auto',
    regionHint: 'auto',
    /*
     * THE ONE MANAGED PROVIDER HERE THAT WANTS PATH-STYLE, and the reason is
     * in its endpoint: R2's S3 origin is ACCOUNT-scoped
     * (`<account-id>.r2.cloudflarestorage.com`), and Cloudflare documents
     * addressing buckets as a path under it. Virtual-hosted would ask for
     * `<bucket>.<account-id>.r2.cloudflarestorage.com`, which is a different
     * host and not the form R2's own documentation uses.
     *
     * Spaces, Tigris, B2 and Wasabi all issue per-bucket hostnames and are
     * left virtual-hosted; MinIO and anything self-hosted has no wildcard DNS
     * and must be path-style. (Caught by the 37f docs review, which found this
     * preset disagreeing with both the plan's Appendix A and the environment
     * seed.)
     */
    forcePathStyle: true,
  },
  {
    id: 'tigris',
    // The one preset that knows its endpoint outright: Tigris is a single
    // global origin, so nothing here is a guess about the operator's account.
    endpoint: 'https://fly.storage.tigris.dev',
    endpointHint: 'https://fly.storage.tigris.dev',
    region: 'auto',
    regionHint: 'auto',
    forcePathStyle: false,
  },
  {
    id: 'b2',
    endpoint: '',
    endpointHint: 'https://s3.us-west-004.backblazeb2.com',
    region: '',
    regionHint: 'us-west-004',
    forcePathStyle: false,
  },
  {
    id: 'wasabi',
    endpoint: '',
    endpointHint: 'https://s3.eu-central-1.wasabisys.com',
    region: '',
    regionHint: 'eu-central-1',
    forcePathStyle: false,
  },
  {
    id: 'minio',
    endpoint: '',
    endpointHint: 'http://127.0.0.1:9000',
    // A self-hosted server ignores the region but the signature still carries
    // one, so a working default beats a blank field that fails validation.
    region: 'us-east-1',
    regionHint: 'us-east-1',
    forcePathStyle: true,
  },
];

export function presetById(id: S3PresetId): S3Preset {
  return S3_PRESETS.find((preset) => preset.id === id) ?? AWS_PRESET;
}

/**
 * Apply a preset to a draft.
 *
 * Only the three fields a preset actually knows are touched, and a field the
 * preset cannot fill is CLEARED rather than left holding the previous
 * provider's value — a Wasabi endpoint under a "Cloudflare R2" label is the
 * failure this is here to prevent. The empty field then shows the preset's
 * hint as its placeholder.
 */
export function applyPreset(draft: DestinationDraft, id: S3PresetId): DestinationDraft {
  const preset = presetById(id);
  return {
    ...draft,
    presetId: id,
    endpoint: preset.endpoint,
    region: preset.region,
    forcePathStyle: preset.forcePathStyle,
  };
}

/**
 * The host an endpoint addresses, or `null` when it does not parse.
 *
 * A stored endpoint always carries a scheme — the meta schema types the column
 * `z.string().url()`, so one without it never reaches here — and this does NOT
 * supply a missing one. Prepending would mean writing `https://` immediately
 * before an interpolation, and that literal survives minification into the
 * bundle, where `check-offline-assets` reads it as a remote host the app might
 * fetch and fails the desktop build.
 */
function endpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether `host` IS `domain` or sits under it — never merely contains it. */
function isHostUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Which preset a stored config looks like — so reopening an editor is not a reset.
 *
 * Matched on the parsed HOST, not on a substring of the whole endpoint. The
 * providers here all issue per-account or per-region subdomains
 * (`nyc3.digitaloceanspaces.com`, `<account>.r2.cloudflarestorage.com`), so the
 * test has to accept a subdomain while refusing a lookalike:
 * `https://minio.internal/?ref=wasabisys.com` and `https://wasabisys.com.evil`
 * both merely CONTAIN a provider domain and are neither of those providers.
 * Anything unparseable or unrecognised is MinIO, which is what "some other S3"
 * has always meant here.
 */
export function presetIdFor(config: Partial<S3DestinationConfig>): S3PresetId {
  const endpoint = config.endpoint ?? '';
  if (endpoint.trim() === '') return 'aws';
  const host = endpointHost(endpoint);
  if (host === null) return 'minio';
  if (isHostUnder(host, 'digitaloceanspaces.com')) return 'spaces';
  if (isHostUnder(host, 'r2.cloudflarestorage.com')) return 'r2';
  if (isHostUnder(host, 'fly.storage.tigris.dev')) return 'tigris';
  if (isHostUnder(host, 'backblazeb2.com')) return 'b2';
  if (isHostUnder(host, 'wasabisys.com')) return 'wasabi';
  return 'minio';
}

/* --- reading the server's refusals ---------------------------------------- */

/**
 * The file count out of a 409 on `DELETE /storage/destinations/:id`.
 *
 * The count IS the message: "12 files live here, move them first" is
 * actionable and "the destination is in use" is not. Returns `null` for any
 * other failure so the caller can fall back to the server's own text rather
 * than inventing a number.
 */
export function fileCountFromError(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details as { fileCount?: unknown } | null | undefined;
  return typeof details?.fileCount === 'number' ? details.fileCount : null;
}

/** What went wrong, in the server's words. Never re-worded — see `testDestination`. */
export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* --- formatting ------------------------------------------------------------ */

/**
 * "1.2 MB" in the reader's locale.
 *
 * Always a bare figure, never a fraction of a capacity: 37 Appendix D forbids
 * "N of M" outright, and the only second number this feature ever shows is the
 * local disk's own "available", which is a separate sentence and not a
 * denominator.
 */
export function formatBytes(bytes: number): string {
  return getFormatters(getI18nInstance()?.language ?? 'en-US').bytes(bytes);
}
