/**
 * Zod schemas for the branding resource (white-label chrome).
 *
 * SYNC NOTE: the client mirror lives in `apps/dashboard/src/app/branding.ts`
 * (type-only copy, same convention as app/bootstrap.ts) — change both together.
 */
import { z } from 'zod';

export const brandingView = z.object({
  appName: z.string(),
  logoUrl: z.string().nullable(),
  showVersion: z.boolean(),
});
export type BrandingViewSchema = z.infer<typeof brandingView>;

export const brandingReply = z.object({ data: brandingView });
export type BrandingReply = z.infer<typeof brandingReply>;

/** `?v=<fileId>` cache stamp; ignored by the handler, declared so it validates. */
export const brandingLogoQuery = z.object({ v: z.string().optional() });

export const brandingLogoUploadQuery = z.object({
  filename: z.string().min(1).max(200).default('logo'),
});

/**
 * What an uploaded logo may be.
 *
 * SVG is included — logos are vectors — but it is the reason
 * `GET /branding/logo` ships `Content-Security-Policy: default-src 'none'`,
 * `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`: an SVG
 * is a document that can carry script, and the one context it must work in
 * here is an `<img>` tag, which never runs it. Those headers make direct
 * navigation to the URL inert too.
 */
export const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;
export type LogoMime = (typeof LOGO_MIME_TYPES)[number];

/**
 * Content types whose bodies this route will PARSE. `application/octet-stream`
 * is here because a browser hands `File.type` back empty for some images and a
 * client that admits it does not know beats one that guesses `image/png`; the
 * sniffer decides either way, and the stored mime always comes from the bytes.
 */
export const LOGO_UPLOAD_CONTENT_TYPES = [
  ...LOGO_MIME_TYPES,
  'application/octet-stream',
] as const;

/** 1 MiB. A rail logo is ~30px tall; anything bigger is a mistake, not a need. */
export const LOGO_BODY_LIMIT = 1024 * 1024;
