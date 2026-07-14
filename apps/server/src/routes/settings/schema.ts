/**
 * Zod schemas for the global-defaults settings resource
 * (10-i18n-theming.md §7.2, 08-server-api.md): the four preference axes with
 * the same enums the meta json-payloads use, plus per-axis adoption counts
 * (`following` = users whose override is NULL for that axis).
 */
import { z } from 'zod';
import { accentSchema, densitySchema, localeSchema, themeSchema } from '@adminium/meta';

/** PUT body — a full-object write (§7.2), never a partial patch. */
export const settingsDefaultsPutBody = z.object({
  theme: themeSchema,
  accent: accentSchema,
  density: densitySchema,
  locale: localeSchema,
});
export type SettingsDefaultsPutBody = z.infer<typeof settingsDefaultsPutBody>;

const adoptionView = z.object({
  totalUsers: z.number().int().min(0),
  following: z.object({
    theme: z.number().int().min(0),
    accent: z.number().int().min(0),
    density: z.number().int().min(0),
    locale: z.number().int().min(0),
  }),
});

export const settingsDefaultsReply = z.object({
  data: z.object({
    theme: themeSchema,
    accent: accentSchema,
    density: densitySchema,
    locale: localeSchema,
    adoption: adoptionView,
  }),
});
export type SettingsDefaultsReply = z.infer<typeof settingsDefaultsReply>;
