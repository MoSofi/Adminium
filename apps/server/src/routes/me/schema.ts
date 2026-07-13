/**
 * Zod schemas for the `me` resource (08-server-api.md §2.2): profile view and
 * patch plus per-user preference axes (07-meta-store.md §3.4, §7.2 —
 * `null` = "use workspace default").
 */
import { z } from 'zod';
import {
  accentSchema,
  densitySchema,
  dirSchema,
  localeSchema,
  themeSchema,
} from '@adminium/meta';

import { authUserView } from '../auth/schema.js';

export const meReply = z.object({ data: z.object({ user: authUserView }) });
export type MeReply = z.infer<typeof meReply>;

export const mePatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().min(3).max(320).optional(),
    /** Required when `email` changes (§2.2). */
    password: z.string().min(1).max(200).optional(),
  })
  .refine((body) => body.email === undefined || body.password !== undefined, {
    message: 'password is required to change email',
    path: ['password'],
  });
export type MePatchBody = z.infer<typeof mePatchBody>;

/** Raw per-user row: `null` = inherit the workspace/system default. */
export const mePrefsView = z.object({
  theme: themeSchema.nullable(),
  accent: accentSchema.nullable(),
  density: densitySchema.nullable(),
  locale: localeSchema.nullable(),
  dir: dirSchema.nullable(),
});

const prefSource = z.enum(['system', 'global', 'user']);

/** §7.2 resolved axes + per-axis provenance for the settings UI. */
export const mePrefsResolvedView = z.object({
  theme: themeSchema,
  accent: accentSchema,
  density: densitySchema,
  locale: localeSchema,
  dir: dirSchema,
  source: z.object({
    theme: prefSource,
    accent: prefSource,
    density: prefSource,
    locale: prefSource,
    dir: prefSource,
  }),
});

export const mePrefsReply = z.object({
  data: z.object({
    prefs: mePrefsView,
    resolved: mePrefsResolvedView,
  }),
});
export type MePrefsReply = z.infer<typeof mePrefsReply>;

/** Absent = unchanged; `null` = clear back to inherit (07-meta-store.md §7.2). */
export const mePrefsPatchBody = z.object({
  theme: themeSchema.nullable().optional(),
  accent: accentSchema.nullable().optional(),
  density: densitySchema.nullable().optional(),
  locale: localeSchema.nullable().optional(),
  dir: dirSchema.nullable().optional(),
});
export type MePrefsPatchBody = z.infer<typeof mePrefsPatchBody>;
