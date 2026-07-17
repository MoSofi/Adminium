/**
 * Zod schemas for the desktop local-database resource
 * (11-electron.md §6 step 2 card 1, task 11-T07).
 */

import { z } from 'zod';

import { parseRequestFormat } from '../schema-import/schema.js';

export const desktopLocalDbBody = z.object({
  /** §6: "Name → slug → creates `<dataDir>/databases/<slug>.sqlite`". */
  name: z.string().min(1).max(80),
  /**
   * §6's sub-choice. Absent ⇒ *Blank* ("empty DB; Studio's table designer per
   * 09-generated-app.md"); present ⇒ *From a schema file*.
   *
   * The FILE is sent, not a parsed model, and that is a size decision as much as
   * a trust one: `POST /schema-import/parse` replies with a `DatabaseModel` whose
   * JSON is several times the source text for a wide schema, and posting it back
   * would put the round trip — not the upload — against the 2 MB body cap. The
   * server parses it here with the same resolver that route uses.
   */
  schemaFile: z
    .object({
      /** Raw schema text. Same 2 MB body cap as `/schema-import/parse`. */
      content: z.string().min(1),
      /** Omit to sniff from the content / file name. */
      format: parseRequestFormat.optional(),
      fileName: z.string().min(1).max(255).optional(),
    })
    .optional(),
  /**
   * `designs/Connect Database.dc.html`'s "Auto-generate placeholder entries".
   *
   * Defaults OFF. The comp shows it ON, but the comp is showing the state AFTER
   * the user imported a schema with no rows — and this body is also how a *Blank*
   * database is created, where there is nothing to seed. The wizard sets it
   * explicitly on the schema-file path; a default of `true` here would mean a
   * client that forgot the field writes rows into the user's database.
   */
  placeholderRows: z.boolean().default(false),
});
export type DesktopLocalDbBody = z.infer<typeof desktopLocalDbBody>;

/** A non-fatal translation gap — see `sqlite-ddl.ts`'s `DdlWarning`. */
export const desktopLocalDbWarning = z.object({
  code: z.string(),
  message: z.string(),
  tableId: z.string().nullable(),
});

export const desktopLocalDbReply = z.object({
  data: z.object({
    connectionId: z.string(),
    name: z.string(),
    /** The `<slug>` the name resolved to. */
    slug: z.string(),
    /**
     * The absolute `<dataDir>/databases/<slug>.sqlite` path — unmasked for the
     * reasons `desktop-demo/schema.ts` gives: a SQLite DSN carries no
     * credentials, and the wizard's "Show in folder" needs a path to hand the
     * §4 bridge.
     */
    file: z.string(),
    /** Tables created, in creation order. Empty for a blank database. */
    tables: z.array(z.string()),
    /** Rows written per table. Empty unless `placeholderRows` was on. */
    rows: z.record(z.string(), z.number().int().min(0)),
    /**
     * What the translation could not carry across (views, expression indexes,
     * generated columns…). §8.2's rule — never hide, always explain — is why
     * these are on the reply rather than in a server log.
     */
    warnings: z.array(desktopLocalDbWarning),
  }),
});
export type DesktopLocalDbReply = z.infer<typeof desktopLocalDbReply>;
