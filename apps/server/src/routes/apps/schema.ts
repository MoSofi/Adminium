// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire shapes for `/api/v1/apps`.
 *
 * Mirrors `routes/add-ons/schema.ts` deliberately: the two surfaces acquire
 * bytes the same way, so an operator tool that can drive one can drive the
 * other, and a reviewer comparing them sees the differences rather than a
 * second dialect.
 */
import { z } from 'zod';

import { planReply } from '../schema-ddl/schema.js';

/**
 * `@adminium/manifest`'s identity grammar, restated.
 *
 * Restated rather than imported for the same reason `add-ons/store.ts` restates
 * it: this value becomes a PATH SEGMENT in the store and a URL segment under
 * `/apps/`, and a guard on a path should not be able to change out from under
 * this file when an unrelated package widens its schema.
 */
export const appKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,79}$/, 'an app key is lowercase letters, digits and hyphens');

export const appKeyParams = z.object({ key: appKey });

/**
 * Upload carries its bytes in the body, and the bundle names itself.
 *
 * The key and version are read from the bundle's own `manifest.json`. They
 * used to be asked for, and that was a question with one right answer that the
 * file already held: a bundle is served at the key its build baked into every
 * asset URL, so a typed key that differed was always going to be refused, one
 * step later. `key` and `version` remain as optional ASSERTIONS for a scripted
 * caller that wants to be told when it picked up the wrong file: given and
 * different from the manifest, the upload is refused before anything is
 * written.
 *
 * `expectedSha512` is the uploader's own hash of the file they are sending,
 * honesty about what that is worth applies here unchanged: for a tarball of
 * unknown origin it is self-referential, which is exactly why the hardened
 * unpack runs unconditionally rather than being skippable for a trusted source.
 */
export const uploadAppQuery = z.object({
  key: appKey.optional(),
  version: z.string().min(1).max(64).optional(),
  expectedSha512: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

/** The manifest's publisher, as the pages that name it read it. */
const appPublisher = z.object({ id: z.string(), name: z.string() });

export const stagedAppReply = z.object({
  key: appKey,
  version: z.string(),
  /** The manifest's display name, so the operator sees what was read. */
  name: z.string(),
  /** How many files the verified tree holds — the receipt for an unpack. */
  files: z.number(),
  integrity: z.string(),
  /** Which sides the package actually carries, in serve order. */
  sides: z.array(z.enum(['staff', 'customer'])),
  /** Who the manifest says made it. `local` is an app made on this install. */
  publisher: appPublisher.optional(),
  /**
   * Where the file goes on this server (one version per app, installed per
   * database): `install` — the key is installed nowhere; `update` — it is
   * newer than what every copy runs, so it updates them, one review each;
   * `install-another` — the same version, offered for a database without a
   * copy (`databasesFree` says how many there are; none means nowhere left).
   * An older version and another lineage are refused before this reply.
   */
  route: z.enum(['install', 'update', 'install-another']),
  /** The copies already installed, each on its database. */
  installs: z.array(
    z.object({
      installId: z.string(),
      connectionId: z.string().nullable(),
      connectionName: z.string(),
      slug: z.string(),
      version: z.string(),
      status: z.string(),
    }),
  ),
  /** The databases this server has with no copy of the key yet. */
  databasesFree: z.number().int().min(0),
});

/**
 * The plan preview.
 *
 * `connectionId` is required and is NOT inferred. An add-on can infer its
 * database from the host it attaches to; an app has no host, and guessing "the
 * only connection" on an instance that later grows a second one would silently
 * start planning against a different database than the operator meant.
 */
/**
 * The operator's answers on the check step: what to do with each table whose
 * name is taken (by its short name), and a different prefix for the whole app.
 */
export const installAnswers = {
  choices: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('reuse') }),
        z.object({ action: z.literal('share') }),
        z.object({ action: z.literal('rename-existing'), to: z.string().min(1).max(64) }),
      ]),
    )
    .optional(),
  altPrefix: z.string().min(2).max(40).optional(),
  /**
   * `use`: every table of the app that is here already is used as it is, all
   * at once — never renamed, never changed. A table that cannot be used so is
   * a plan problem (`EXISTING_TABLE_UNUSABLE`) and stops the install.
   */
  existing: z.literal('use').optional(),
  /**
   * The review's tick for a self-made file's deployment-wide part (`plan.instance`):
   * its look, languages, wording, edited system emails and plain settings,
   * written over this whole server. Off unless `true`, and applied only by
   * someone who may change the server's settings (otherwise 403).
   */
  instance: z.boolean().optional(),
  /**
   * The link hosts ticked for each edited system email (`plan.instance.systemEmails[].id`
   * → hosts). An email with a host left unticked is not applied, and the reply says so.
   */
  instanceHosts: z.record(z.string().regex(/^[a-z][a-z0-9-]*\/[A-Za-z0-9_]{2,24}$/), z.array(z.string().min(1).max(253)).max(50)).optional(),
  /**
   * Per shape the app declares (`menu@1`): use another installed app's tables
   * of that shape (`with` = its key) or keep separate ones. No answer uses the
   * first installed app's, when there is one.
   */
  shares: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*@\d+$/),
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('share'), with: z.string().min(1).max(64) }),
        z.object({ action: z.literal('separate') }),
      ]),
    )
    .optional(),
  /**
   * Per page of the app whose address a page here already has (`plan.pageClashes`,
   * by the app page's slug): `replace` the page there (only one nobody edited),
   * `rename-existing` it to `to` so the app's page takes the address, or `skip`
   * the app's page. A clash with no answer refuses the install.
   */
  pages: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/),
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('replace') }),
        z.object({ action: z.literal('rename-existing'), to: z.string().min(1).max(64) }),
        z.object({ action: z.literal('skip') }),
      ]),
    )
    .optional(),
};

/**
 * What the install does with one add-on the app names: install or connect it
 * at `version` — the one the check offered — and, for one installed at a
 * version the app does not work with, `update: true` ("Update it too").
 */
export const appAddOnChoice = z
  .object({
    key: appKey,
    version: z.string().min(1).max(64),
    update: z.boolean().optional(),
  })
  .strict();

/** One app that uses an add-on, and how. */
const appNeedWire = z.object({
  app: appKey,
  appName: z.string(),
  status: z.string(),
  need: z.enum(['requires', 'feature', 'suggests']),
  range: z.string().nullable(),
  features: z.array(z.object({ id: z.string(), label: z.record(z.string(), z.string()) })),
});

/** An add-on's own install plan, as its consent dialog reads it. */
const addOnPlanWire = z.object({
  addOnKey: z.string(),
  version: z.string(),
  installable: z.boolean(),
  touchesData: z.boolean(),
  create: z.array(z.object({ ref: z.string(), columns: z.array(z.object({ ref: z.string(), type: z.string() })) })),
  reuse: z.array(z.object({ ref: z.string(), missingColumns: z.array(z.string()) })),
  references: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      to: z.string(),
      resolution: z.enum(['internal', 'host', 'unresolved']),
    }),
  ),
  problems: z.array(z.object({ code: z.string(), message: z.string(), table: z.string(), column: z.string().optional() })),
  requiresSchemaChange: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

/**
 * One add-on the app names, resolved against this server. `state` and
 * `source` are kept apart because the screen shows both: "Installed · v1.1.0 ·
 * Comes with Adminium".
 */
export const appAddOnRow = z.object({
  key: appKey,
  name: z.string(),
  /** `requires`, `feature` (a feature of the app needs it) or `suggests`. */
  need: z.enum(['requires', 'feature', 'suggests']),
  range: z.string(),
  /** Why the app wants it, per language (the manifest's words, not a translation key). */
  reason: z.record(z.string(), z.string()),
  /** Ticked on the check: always when required, as the manifest says when suggested. */
  checked: z.boolean(),
  features: z.array(z.object({ id: z.string(), label: z.record(z.string(), z.string()) })),
  state: z.enum(['attached', 'installed', 'outdated', 'absent', 'unavailable']),
  source: z.enum(['bundled', 'catalog', 'upload']).nullable(),
  installedVersion: z.string().nullable(),
  offeredVersion: z.string().nullable(),
  /** Whether the INSTALLED version falls in the app's range. */
  satisfiesRange: z.boolean(),
  /** Whether the offered version's bytes are on this server; false means "download it first". */
  staged: z.boolean(),
  /** Connected to this app and switched on there. */
  enabled: z.boolean(),
  /** What installing the app does to it: null (nothing), attach, install or update. */
  action: z.enum(['attach', 'install', 'update']).nullable(),
  /** The other apps that use it — "Also used by" beside "Update it too". */
  usedBy: z.array(appNeedWire),
  /** Its own install plan (install or update). Absent from the settings read. */
  plan: addOnPlanWire.nullable().optional(),
  /** What stands in the way. Any one refuses the install when the add-on is required or ticked. */
  problems: z.array(z.object({ code: z.string(), message: z.string() })),
});

/** What the install or update did to the add-ons — the done line ("Also installed: …"). */
export const addOnsDoneReply = z.object({
  installed: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })),
  updated: z.array(z.object({ key: z.string(), name: z.string(), from: z.string(), to: z.string() })),
  attached: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })),
});

export const connectionParams = z.object({ id: z.string().min(1).max(64) });

/** The rules a shape set on a connection, still as it set them (`GET /connections/:id/shape-rules`). */
export const shapeRulesReply = z.object({
  rules: z.array(
    z.object({
      tableName: z.string(),
      columnName: z.string().nullable(),
      op: z.string(),
      addOn: z.string(),
      /** The add-on's own name: "Set by Invoices & Receipts". */
      addOnName: z.string(),
      /** What switching it off stops guaranteeing: numbers, totals, edits of a sent document, or a kept value. */
      guarantee: z.enum(['numbers', 'totals', 'edits', 'kept']),
    }),
  ),
});

/** One part of an app, as the check step offers it. */
export const appPlanModule = z.object({
  id: z.string(),
  label: z.record(z.string(), z.string()),
  default: z.enum(['on', 'off', 'always']),
  /** How it stands on an app already installed; absent on a first install. */
  on: z.boolean().optional(),
  needs: z.array(z.string()),
  leftOut: z.boolean(),
  tables: z.array(z.string()),
  /** The roles that are offered only while this part (or another of theirs) is on. */
  roles: z.array(z.string()),
  /** How many of the app's rules are of this part. Absent from an older server. */
  rules: z.number().int().optional(),
});

/** The app's roles with the parts each is of, and its rules of no part: what the check counts beside the parts. */
export const appPlanWhole = z.object({
  roles: z.array(z.object({ name: z.string(), parts: z.array(z.string()) })),
  rules: z.number().int(),
});

export const planAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  connectionId: z.string().min(1),
  /**
   * The add-ons the install would bring, by key: the plan is of the app as it
   * would stand with them (a part built on one that is not there is left
   * out). Absent, the ones the check step shows ticked.
   */
  addOns: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,79}$/)).max(16).optional(),
  ...installAnswers,
});

/**
 * What installing would do to the chosen database.
 *
 * Mirrors `routes/add-ons`' `installPlanDto` field for field, with `key` where
 * that one says `addOnKey` — the underlying `InstallPlan` carries the add-on
 * spelling for historical reasons and each route names it for its own reader.
 */
export const appInstallPlanDto = z.object({
  key: appKey,
  version: z.string(),
  installable: z.boolean(),
  touchesData: z.boolean(),
  create: z.array(
    z.object({
      ref: z.string(),
      columns: z.array(z.object({ ref: z.string(), type: z.string() })),
    }),
  ),
  reuse: z.array(z.object({ ref: z.string(), missingColumns: z.array(z.string()) })),
  references: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      to: z.string(),
      resolution: z.enum(['internal', 'host', 'unresolved']),
    }),
  ),
  problems: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      table: z.string(),
      column: z.string().optional(),
      /** `ONE_VERSION_PER_APP` only: the connection another copy of the app (on another version) is on. */
      connectionId: z.string().optional(),
    }),
  ),
  /**
   * True when applying this plan needs DDL on the data source — what the
   * consent dialog needs in order to say "this will create tables in your
   * database" BEFORE anyone agrees to it, which is a different question from
   * whether the install can proceed at all.
   */
  requiresSchemaChange: z.boolean(),
  /**
   * The manifest's rules the install will skip because they would show a
   * column kept from readers — a secret, or masked personal data — of a
   * table it reuses: only an operator shows one, in Studio. Never a
   * refusal; absent when there is none.
   */
  ruleWarnings: z.array(z.object({ table: z.string(), column: z.string(), message: z.string() })).optional(),
  /**
   * What is wrong with the manifest's PAGES, from the manifest alone — an
   * unbound calendar, a binding to a table it does not declare, a table that
   * cannot back its template. Reported, never a refusal: the install goes on
   * and such a page arrives empty. The app's own CI is where they are refused.
   */
  pageWarnings: z.array(
    z.object({
      page: z.string(),
      code: z.string(),
      message: z.string(),
      table: z.string().optional(),
    }),
  ),
  /**
   * The columns a REUSED table is missing, as plan 35's `addColumns` edit —
   * what the update screen offers to run (with the exact statement shown)
   * instead of stopping at `COLUMNS_REQUIRED`. Empty lists when nothing is
   * missing. `blocked` columns cannot be added this way, and the update still
   * refuses while any remain.
   */
  missingColumnsEdit: z.object({
    addColumns: z.array(
      z.object({
        table: z.string(),
        column: z.object({
          name: z.string(),
          logicalType: z.string(),
          nullable: z.literal(true),
          default: z.null(),
          maxLength: z.number().int().nullable(),
          numericPrecision: z.number().int().nullable(),
          numericScale: z.number().int().nullable(),
          comment: z.null(),
        }),
      }),
    ),
    values: z.array(z.object({ table: z.string(), column: z.string(), values: z.array(z.string()) })),
    blocked: z.array(
      z.object({
        table: z.string(),
        column: z.string(),
        reason: z.enum(['foreign-key', 'primary-key', 'unsupported-type']),
      }),
    ),
  }),
  /**
   * The plan's identity: a hash of what it would do and of the
   * live tables it was made from. The install sends it back, and a database
   * that changed in between answers 409 `SCHEMA_DRIFT` instead of doing
   * something the operator never saw.
   */
  checksum: z.string(),
  /**
   * Each table's class, action, what the check step offers, and the safe edits
   * a reused table needs. Absent for an add-on.
   */
  tables: z
    .array(
      z.object({
        ref: z.string(),
        table: z.string(),
        class: z.enum(['new', 'own-leftover', 'shared', 'taken']),
        action: z.enum(['create', 'reuse', 'share', 'rename-existing', 'undecided']),
        offers: z.array(z.enum(['reuse', 'share', 'separate', 'rename-existing', 'alt-prefix'])),
        reuseRefusal: z.string().optional(),
        /** The columns that stop reuse: each refuses a row without a value, and the app never fills it. `reuseRefusal` says the same in English. */
        reuseRequires: z.array(z.string()).optional(),
        renameExistingTo: z.string().optional(),
        /** For `share`: the key of the app whose table it is, and that app's name. */
        sharedWith: z.string().optional(),
        sharedWithName: z.string().optional(),
        /** The shape the app declares the table with (`menu@1`). */
        shape: z.string().optional(),
        /** From an earlier install that used the table it found rather than making it. */
        adopted: z.literal(true).optional(),
        edits: z.array(
          z.object({
            kind: z.enum(['add-column', 'widen', 'set-identity', 'enum-values', 'add-unique', 'add-index', 'add-link']),
            column: z.string(),
            from: z.string().optional(),
            to: z.string().optional(),
            values: z.array(z.string()).optional(),
            /** `add-unique`: the columns it is unique together with (a parent row), when not alone. */
            with: z.array(z.string()).optional(),
            /** `add-unique` of a set the app declares: the rule's own name. */
            name: z.string().optional(),
          }),
        ),
        blocked: z.array(z.object({ column: z.string(), reason: z.string() })),
        /** The columns the app declares for it. */
        columns: z.array(z.object({ ref: z.string(), type: z.string() })),
      }),
    )
    .optional(),
  /** Short name → real table. */
  names: z.record(z.string(), z.string()).optional(),
  /**
   * Per shape the app declares (`menu@1`), the installed apps whose tables of
   * that shape it may use: the check step's "Use {app}'s menu" or "Keep a
   * separate menu". Absent when no other app here has them.
   */
  shareOffers: z
    .array(
      z.object({
        shape: z.string(),
        /** The app whose tables the plan uses (`share`), or the one recommended (`separate`). */
        with: z.string(),
        withName: z.string(),
        /** Every app whose tables could be used, recommended (the first installed) first, with its name. */
        candidates: z.array(z.object({ key: z.string(), name: z.string() })),
        action: z.enum(['share', 'separate']),
        /** `with`'s real tables of the shape. */
        tables: z.array(z.string()),
        /** The columns sharing adds to `with`'s tables. */
        addColumns: z.array(z.object({ table: z.string(), column: z.string() })),
      }),
    )
    .optional(),
  /**
   * The app's pages whose address a page here already has: the operator's own,
   * a generated one, or one an uninstalled app left. Each is answered in
   * `pages` (the install's answers); `offers` has `replace` only for a page
   * nobody edited. Absent when there is none. Another app's page is a problem
   * (`PAGE_SLUG_TAKEN`), never offered.
   */
  pageClashes: z
    .array(
      z.object({
        page: z.string(),
        title: z.string(),
        holder: z.enum(['yours', 'generated', 'orphan']),
        untouched: z.boolean(),
        offers: z.array(z.enum(['replace', 'rename-existing', 'skip'])),
        action: z.enum(['replace', 'rename-existing', 'skip', 'undecided']),
        renameTo: z.string().optional(),
      }),
    )
    .optional(),
  /** The app ships sample data, which can be added once it is installed. */
  sampleData: z.boolean().optional(),
  /** A self-made app's file (`provenance`): "Made at <label> on <date>, Adminium <version>". */
  madeAt: z.object({ label: z.string().nullable(), savedAt: z.string(), adminiumVersion: z.string() }).optional(),
  /**
   * What the owner fills in once it is installed, each by what it is, the
   * entry of the file it belongs to and the field: a rule's webhook or typed
   * addresses (the rule arrives switched off), a document's mail slot, who a
   * schedule goes to, a payment service's keys, a bank account.
   */
  afterInstall: z
    .array(
      z.object({
        kind: z.enum(['webhook', 'address', 'document', 'delivery', 'recipients', 'payment-key', 'bank-account', 'sender', 'system-grant', 'outbound']),
        item: z.string(),
        field: z.string(),
      }),
    )
    .optional(),
  /** The parts only a self-made file carries, counted: they are made beside its pages. */
  savedParts: z.object({ reports: z.number().int(), invoiceLayouts: z.number().int(), scheduledReports: z.number().int(), payments: z.boolean() }).optional(),
  /**
   * A self-made file's deployment-wide part: what it would change on this
   * whole server if ticked (`instance: true`). Each setting with its value now
   * and the file's; the pictures; the languages switched on and off; how many
   * words change; each edited system email as a diff, with every link host
   * it holds to tick one by one; and what this server would not take, with
   * why. Absent for a file without one.
   */
  instance: z
    .object({
      needs: z.string(),
      settings: z.array(z.object({ key: z.string(), from: z.unknown(), to: z.unknown() })),
      files: z.array(z.object({ setting: z.string(), file: z.string(), replaces: z.boolean() })),
      languages: z.object({ on: z.array(z.string()), off: z.array(z.string()) }),
      wording: z.object({ changed: z.number().int(), same: z.number().int() }),
      systemEmails: z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          locale: z.string(),
          subject: z.object({ from: z.string(), to: z.string() }).nullable(),
          preheaderChanged: z.boolean(),
          footerChanged: z.boolean(),
          blocks: z.object({ added: z.array(z.string()), removed: z.array(z.string()), changed: z.array(z.string()) }),
          hosts: z.array(z.string()),
          /** Per host: the placeholders a link to it carries, filled in when the mail is sent (the app's name, say). */
          carried: z.record(z.string(), z.array(z.string())),
        }),
      ),
      left: z.array(z.object({ item: z.string(), reason: z.string() })),
    })
    .optional(),
  /**
   * An update's check, for a new version that no longer carries the
   * deployment-wide part: what the running one wrote over the server and that
   * is still as it wrote it, which the update puts back. Each value by its
   * kind and item (`setting`, `branding.appName`), never the value itself;
   * only someone who may change the server's settings (`needs`) can run the
   * update (`canRestore` says whether the caller may). Absent when nothing
   * would be put back.
   */
  instanceRestore: z
    .object({
      needs: z.string(),
      canRestore: z.boolean(),
      values: z.array(z.object({ kind: z.enum(['setting', 'word', 'email', 'locale']), item: z.string() })),
    })
    .optional(),
  /** The app shows maps and nobody has yet said whether this install shows them: the check step asks. */
  maps: z.boolean().optional(),
  /**
   * The add-on settings the app's roles would be given (`addOn:<key>:settings`),
   * for the check step to show before anyone agrees: those settings are
   * shared by every app the add-on serves. Absent when none.
   */
  addOnGrants: z
    .array(
      z.object({
        role: z.string(),
        roleName: z.string(),
        addOn: z.string(),
        grant: z.literal('settings'),
        /** An update's check: the running version's role was not given it. The update gives it only with `"roleGrants": true`. */
        added: z.literal(true).optional(),
      }),
    )
    .optional(),
  /**
   * The roles that would find, download and erase a person's data
   * (`privacy:@:people`): everything the workspace keeps about one address,
   * past every role's limits. Shown on the check step. Absent when none.
   */
  privacyGrants: z
    .array(
      z.object({
        role: z.string(),
        roleName: z.string(),
        /** An update's check: the running version's role was not given it. The update gives it only with `"roleGrants": true`. */
        added: z.literal(true).optional(),
      }),
    )
    .optional(),
  /**
   * What each role of the app would hold of the tables of the add-ons it
   * names (`roles[].tables`), for the check step to show: written when that
   * add-on is there for the app, taken back when it is not. Absent when none.
   */
  roleTables: z
    .array(
      z.object({
        /** Another app's role, named when an add-on this install or update brings a newer version of gives it more of its tables. Absent: this app's. */
        app: z.string().optional(),
        appName: z.string().optional(),
        role: z.string(),
        roleName: z.string(),
        addOn: z.string(),
        table: z.string(),
        /** What the role will hold: cut to the add-on's own words (its shape and its `appGrants`). */
        actions: z.array(z.string()),
        /** The columns each action reaches. Absent: every column (only on an add-on that sets no `appGrants`). */
        readable: z.array(z.string()).optional(),
        writable: z.array(z.string()).optional(),
        creatable: z.array(z.string()).optional(),
        /** What the app asks for and the role will not get, by name. */
        narrowed: z.object({ actions: z.array(z.string()), readable: z.array(z.string()).optional(), writable: z.array(z.string()).optional(), creatable: z.array(z.string()).optional() }).optional(),
        /** Why the entry, or part of it, is left out: `not-offered` (the add-on gives the table to no app), `ceiling` (cut to what it gives), `ledger-table`, `unknown-column`, `unknown-table`. */
        skipped: z.string().optional(),
        /** The add-on is not on this server: what the app asks, before the add-on's own words cut it. */
        unchecked: z.literal(true).optional(),
        /** An update's check: what this version's role holds that the running one's did not (`*`: every column). The update gives it only with `"roleTables": true`. */
        wider: z.object({ actions: z.array(z.string()), columns: z.array(z.string()) }).optional(),
      }),
    )
    .optional(),
  /**
   * An update's check: each public endpoint stored here (the app's own, or an
   * add-on's it updates or that serves through its key) whose new definition
   * would let a key that already uses it see or do more. The update saves
   * them only with `"publicWider": true`. Absent when none would widen.
   */
  publicWider: z
    .array(
      z.object({
        ref: z.string(),
        /** Whose entry it is: the app, or an add-on. */
        owner: z.string(),
        /** Columns it would newly show. */
        columns: z.array(z.string()),
        /** Methods it would newly take. */
        methods: z.array(z.string()),
        /** A filter, or a limit on what may be written, loosened. */
        rows: z.boolean(),
        /** Each widening in words. */
        reasons: z.array(z.string()),
      }),
    )
    .optional(),
  /**
   * What the app's guests could do through the public API, as it asks, for
   * the check step to show and the installer to allow or not. Absent for an
   * app asking for none.
   */
  publicAccess: z
    .object({
      endpoints: z.array(
        z.object({
          ref: z.string(),
          table: z.string(),
          methods: z.array(z.string()),
          select: z.array(z.string()),
          writable: z.array(z.string()),
          claim: z.array(z.string()).nullable(),
          /** `availability` answers free or full per slot, never a row. */
          kind: z.enum(['records', 'availability']),
          /** A guest's create here is confirmed by email. */
          confirms: z.boolean(),
          /** Answered by a later release: listed, not made now. */
          pending: z.boolean(),
          issues: z.array(z.string()),
          /** The manifest that declares it: the app, or an add-on of its served through the app's key. */
          owner: z.string().optional(),
          /**
           * For an app already installed (the check an update is shown): its
           * key already holds this (`held`), the update gives it once allowed
           * (`granted`), the change is one its key may not take and it stays
           * as it is (`kept`), or its key was taken back and is not made
           * again (`withheld`). Absent for an install.
           */
          onUpdate: z.enum(['held', 'granted', 'kept', 'withheld']).optional(),
        }),
      ),
      /**
       * For an app already installed: the purposes of its keys that this
       * version turns from a staff screen's (served only beside a staff
       * sign-in) into a shared link's, whose token alone opens what it reads.
       * Made only when the update is sent `publicAccess: true`.
       */
      opensWithoutStaff: z.array(z.string()).optional(),
      /**
       * For an app with a phone side that is already installed: whether its
       * phone app has a key (`held`), the update would make one (`made`: a
       * key for a program, with what guests may already reach, and only when
       * the update is sent `publicAccess: true`), or the operator took it
       * back and none is made (`withheld`).
       */
      phoneKey: z.enum(['held', 'made', 'withheld']).optional(),
      warnings: z.array(z.object({ code: z.string(), message: z.string() })),
      /** Making the app's key needs `system:api-keys:manage`. */
      canGrant: z.boolean(),
    })
    .optional(),
  /**
   * The add-ons the app names, each with its state, its source and its own
   * plan. Absent for an app that names none — its check is exactly as before.
   */
  addOns: z.array(appAddOnRow).optional(),
  /**
   * The parts of the app, for the ticks of the check step. `switch` is false
   * for a part that is always on. `needs` are the add-ons its feature needs;
   * `leftOut` says its tables are not made by this install, with the tables.
   */
  modules: z.array(appPlanModule).optional(),
  /** Beside `modules`: the roles and the rules of no part, for the check's counts. Absent for an app with no parts. */
  whole: appPlanWhole.optional(),
});

export const appInstallPlanReply = z.object({ plan: appInstallPlanDto });

export type AppInstallPlanDto = z.infer<typeof appInstallPlanDto>;

export const installAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
  /**
   * The database the app's tables are created in, and the one its staff surface
   * reads afterwards.
   *
   * OPTIONAL IN THE SHAPE, REQUIRED IN PRACTICE. `requiredSchema.tables` is
   * `min(1)` on the app branch, so every valid app manifest declares at least
   * one table and every app install therefore needs a connection. It is
   * optional here so the refusal can be a sentence naming the tables that need
   * a home, rather than a schema rejection reading "Required" — and so that a
   * later manifest version permitting no tables does not need a wire change.
   */
  connectionId: z.string().min(1).optional(),
  /**
   * Take the app's plain addresses (`/apps/<key>/<side>/`, `/a/<key>`) for this
   * copy. The first copy of a key has them; once that copy is uninstalled they
   * stay free until an install asks for them like this, never by default.
   * Refused while another copy holds them.
   */
  bareAddress: z.literal(true).optional(),
  /**
   * The `checksum` of the plan the operator reviewed. When present, the install
   * re-plans from the live database and refuses with 409 `SCHEMA_DRIFT` if the
   * plan came out different. Optional so a scripted install that never showed
   * anyone a plan keeps working.
   */
  planChecksum: z.string().min(1).max(128).optional(),
  /**
   * The check step's "Allow this public access". Absent means allowed — the
   * box starts ticked — for an app that asks for any.
   */
  publicAccess: z.boolean().optional(),
  /**
   * The add-ons to install, connect or update with the app. A required one
   * that needs only installing or connecting is done without being listed; a
   * suggested one only when listed; an update only with `update: true`.
   */
  addOns: z.array(appAddOnChoice).max(16).optional(),
  /**
   * The check's say on what an add-on this install updates gives OTHER apps'
   * roles more of its tables (`roleTables[].wider`, each with its `app`).
   * Only `true` allows it; without it such an install is refused (422
   * `ROLE_TABLES_WIDER`) before anything is written.
   */
  roleTables: z.boolean().optional(),
  /**
   * The check's say on what an add-on this install updates would widen for
   * the keys already using its public endpoints (`publicWider[]`). Only
   * `true` allows it, and only from someone who may manage API keys;
   * without it such an install is refused (422 `PUBLIC_WIDER`) before
   * anything is written.
   */
  publicWider: z.boolean().optional(),
  /**
   * The parts of the app to start with, by id: `true` on, `false` off. A part
   * left out starts as its manifest says. A part that is `always` on, or one
   * the app does not have, is refused.
   */
  modules: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), z.boolean()).optional(),
  /** Whether maps are shown on this install, when the check asked (`plan.maps`). Absent: shown. Ignored once somebody has answered. */
  maps: z.boolean().optional(),
  ...installAnswers,
});

/** One side of an installed app, as the operator's list shows it. */
const installedSide = z.object({
  side: z.enum(['staff', 'customer']),
  /** Where it is served, no trailing slash. */
  prefix: z.string(),
  /**
   * False = the bundle carries no `surface.json`, so the blended placement is
   * unavailable and Studio says "rebuild" rather than showing an empty
   * section.
   */
  navAvailable: z.boolean(),
  /**
   * Where this side opens: its mapped host when it has one, else its prefix.
   * Absent from an older server.
   */
  openUrl: z.string().optional(),
  /** `on`, switched `off` by the operator, or the whole app `disabled`. */
  state: z.enum(['on', 'off', 'disabled']).optional(),
});

/** What the install actually did to the database, for the receipt. */
const appliedSchema = z.object({
  created: z.array(z.string()),
  reused: z.array(z.string()),
});

/** One thing a folder app's manifest dropped that holds data. */
export const appRemovalChange = z.object({
  /** `narrow` is a column that holds less than it did: counted, never changed in the database. */
  kind: z.enum(['table', 'column', 'narrow']),
  /** The table's short name in the manifest it was last applied with. */
  table: z.string(),
  /** The real table in the database. */
  tableName: z.string(),
  column: z.string().optional(),
  /** Rows in the table, rows holding a value in the column, or rows that no longer fit. */
  rows: z.number(),
  detail: z.string().optional(),
});

export const appRemovalsReply = z.object({
  key: appKey,
  /** The question waiting, or null when there is none. */
  removals: z.array(appRemovalChange).nullable(),
});

export const answerRemovalBody = z.object({
  /** True drops the tables and columns asked about, with their data. False keeps them, released from the app. */
  accept: z.boolean(),
});

export const answerRemovalReply = z.object({
  key: appKey,
  accepted: z.boolean(),
  dropped: z.object({ tables: z.array(z.string()), columns: z.array(z.string()) }),
  kept: z.array(z.string()),
});

export const installedAppReply = z.object({
  key: appKey,
  version: z.string(),
  /*
   * Which install the row is (the same app may be installed once per
   * database). Set on the list route; absent from an install's or an
   * update's own reply, and from an older server.
   */
  /** The install's id: what `X-Adminium-Install` names. */
  installId: z.string().optional(),
  /** Its address slug: `''` for the install that owns the plain addresses. */
  slug: z.string().optional(),
  /** `key`, or `key~slug` for a later install: its page's and its grants' name. */
  address: z.string().optional(),
  /** The database it is installed on, by name; null for one of no database. */
  connectionName: z.string().nullable().optional(),
  /** The manifest's display name; the key when it has none. */
  name: z.string().optional(),
  /** A self-made app's icon, a lucide name from the pinned set. Absent when the manifest names none. */
  icon: z.string().max(60).optional(),
  /** A self-made app's file (`provenance`): "Made at <label> on <date>, Adminium <version>". */
  madeAt: z.object({ label: z.string().nullable(), savedAt: z.string(), adminiumVersion: z.string() }).optional(),
  /**
   * A later install of an app whose screens know one database
   * (`frontends[].instances` unset): its screens open for the first install
   * only, so `sides` is empty. Its pages, tables and rules work.
   */
  screensFirstOnly: z.literal(true).optional(),
  /** Absent when the app declares no tables and none were touched. */
  schema: appliedSchema.optional(),
  /** `file` (a package: uploaded, downloaded or bundled) or `folder` (an app this project's folder carries). */
  source: z.string(),
  /**
   * Set for an app that runs from the project folder. `here`: `apps/<key>/` is
   * in the project and decides what the app is. `gone`: the folder was removed;
   * the app stays installed, serving nothing of its own, until it is uninstalled.
   */
  folder: z
    .object({
      state: z.enum(['here', 'gone']),
      /**
       * The folder's newest manifest was not applied, and why. The app keeps
       * running as it was; the next change to the folder is the next attempt.
       */
      notApplied: z.object({ stage: z.string(), message: z.string() }).optional(),
      /**
       * What the folder's manifest no longer declares that holds data. Nothing
       * of it was dropped: it waits for an answer (`POST /project/apps/:key/removals`).
       */
      removals: z.array(appRemovalChange).optional(),
    })
    .optional(),
  installedAt: z.number(),
  connectionId: z.string().nullable(),
  /**
   * An update of this copy that moved its version and stopped before it wrote
   * all the version brings (`adminium_app_updates`): the version it came
   * from, the one it runs now, and the step it stopped at (null when the
   * server stopped while it ran). The same update, sent again, finishes it.
   * Absent when there is none.
   */
  unfinishedUpdate: z.object({ from: z.string(), to: z.string(), stage: z.string().nullable() }).optional(),
  sides: z.array(installedSide),
  /** True for an app with a phone side (a phone app for customers): it is served to nobody, and has a key of its own. Absent otherwise. */
  phone: z.literal(true).optional(),
  /** Who the manifest says made it; `local` is an app made on this install. Absent when unreadable. */
  publisher: appPublisher.optional(),
  /**
   * The row is installed but nothing of it is on this server, so none of it is
   * served. A redeploy on a host with no disk is how this happens:
   * the meta row survives, the files do not. `sides` is empty then too, but
   * an empty list reads as "no frontends", which is a different thing.
   */
  missing: z.boolean(),
  /**
   * The row's status. `installing` is an install that
   * stopped part way: not served, and finished by installing again. Absent
   * from an older server.
   */
  status: z.enum(['installing', 'installed', 'disabled', 'error']).optional(),
  /**
   * Set when the app is prefixed now and this install's tables still carry
   * the plain names they were made or found with: the prefix they would get,
   * and how many. The page offers the rename. Absent otherwise.
   */
  oldTableNames: z.object({ prefix: z.string(), count: z.number() }).optional(),
  /**
   * The manifest's pages, as install/update just wrote them. Absent on the
   * list route and for an app declaring none. `warnings` never mean the call
   * failed: a page that could not be bound was created empty, and shows the
   * "this page has no table" notice.
   */
  pages: z
    .object({
      created: z.array(z.string()),
      recomposed: z.array(z.string()),
      kept: z.array(z.string()),
      warnings: z.array(z.object({ page: z.string(), reason: z.string(), message: z.string() })),
    })
    .optional(),
  /**
   * The column rules and option lists the manifest asked for, as install or
   * update just wrote them. A skipped rule is one the operator already keeps,
   * or one the database cannot. Absent where pages are.
   */
  rules: z
    .object({
      written: z.number(),
      removed: z.number(),
      lists: z.array(z.string()),
      skipped: z.array(z.object({ table: z.string(), column: z.string(), op: z.string(), reason: z.string() })),
    })
    .optional(),
  /** The manifest's roles made now, and the grants given now (each once). Absent where pages are. */
  roles: z
    .object({
      created: z.array(z.string()),
      seeded: z.number(),
      /** What the roles hold of the tables of the add-ons that are here for the app, entry by entry — and what was left out, by name. */
      tables: z
        .array(
          z.object({
            role: z.string(),
            addOn: z.string(),
            table: z.string(),
            actions: z.array(z.string()),
            /** The columns each action reaches now. Absent: every column (only on an add-on that sets no `appGrants`). */
            readable: z.array(z.string()).optional(),
            writable: z.array(z.string()).optional(),
            creatable: z.array(z.string()).optional(),
            /** What the app asked for and the role does not get, by name. */
            narrowed: z.object({ actions: z.array(z.string()), readable: z.array(z.string()).optional(), writable: z.array(z.string()).optional(), creatable: z.array(z.string()).optional() }).optional(),
            skipped: z.enum(['unknown-table', 'unknown-column', 'ledger-table', 'not-offered', 'ceiling']).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  /** The public endpoints the manifest asked for, saved now, and the guests' key if one was made now. */
  publicAccess: z
    .object({
      endpoints: z.array(z.string()),
      keyId: z.string().nullable(),
      /** Every key made now, by purpose: the guests' (`customer`) and a second one's (`kiosk`). */
      keys: z.record(z.string(), z.string()),
      /**
       * An update's change the app's own key does not take: one it may not
       * (the endpoint stays as it was), or one the operator did not allow.
       */
      skipped: z.array(z.object({ ref: z.string(), reason: z.string() })),
      /** What each of the app's live keys gained with an update, by purpose: the endpoints, by ref. Absent when none did. */
      granted: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
  /**
   * The emails the manifest declares: whether its outbox is defined now, and
   * each template language written, kept (the operator edited it), skipped
   * (the name is someone else's) or removed (no longer shipped, unedited).
   */
  outbox: z
    .object({
      defined: z.boolean(),
      templates: z.object({
        written: z.array(z.string()),
        kept: z.array(z.string()),
        skipped: z.array(z.object({ key: z.string(), locale: z.string(), reason: z.string() })),
        removed: z.number(),
      }),
    })
    .optional(),
  /**
   * The app's starting rows (`seeds`) written now, by table, and the tables
   * that already held a row and were left as they are. Absent for an app
   * that declares none.
   */
  seeds: z.object({ written: z.record(z.string(), z.number()), kept: z.array(z.string()) }).optional(),
  /**
   * The deployment-wide part, when it was ticked: the values written
   * (`<kind>:<item>`), those an earlier version wrote and this one put back,
   * and what was left out with why (an email with a host not ticked among
   * them). Absent when it was not applied.
   */
  instance: z
    .object({
      written: z.array(z.string()),
      restored: z.array(z.string()),
      left: z.array(z.object({ item: z.string(), reason: z.string() })),
    })
    .optional(),
  /**
   * The app's documents that wait: each of a kind the add-on attached to the
   * app does not draw yet (a version of the add-on that draws it is not
   * installed). Left off, with the attachment a message makes of it, until the
   * add-on is updated; then made with no step of the app's. Absent when none
   * waits.
   */
  documents: z
    .object({
      waiting: z.array(z.object({ kind: z.string(), table: z.string(), addOn: z.string(), addOnName: z.string(), name: z.string(), reason: z.string() })),
    })
    .optional(),
  /** The add-ons installed, updated or connected along with the app. Absent for an app that names none. */
  addOns: addOnsDoneReply.optional(),
});

export const appListReply = z.object({
  apps: z.array(installedAppReply),
  /**
   * Packages on disk that no row has installed yet — an upload that was
   * interrupted between staging and install, which the page offers to finish
   * or discard rather than leaving as bytes nobody can see.
   */
  staged: z.array(z.object({ key: appKey, version: z.string() })),
});

/**
 * One app this instance could install, as the browse surface shows it.
 *
 * Everything here is read off DISK — the packages in the app store (the bundled
 * set staged at boot, uploads, downloads) plus the app catalog the last refresh
 * cached there (b G8-D3). Browsing never reaches the network, which is what
 * makes the page work identically on an air-gapped install (restated for apps
 * in 47 step 4) and what stops a page load becoming an outbound call nobody
 * asked for.
 */
export const appCatalogEntry = z.object({
  key: appKey,
  /** The version on disk — not necessarily the installed one. */
  version: z.string(),
  name: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  /** `publisher.name` — the comp's "by {publisher}" byline. */
  publisher: z.string(),
  /**
   * The manifest's declared capabilities, which are what the comp's feature
   * chips actually are once the invented ones are dropped: a shipped app really
   * says `payments`, `email-delivery`, `realtime`.
   */
  capabilities: z.array(z.string()),
  sides: z.array(z.enum(['staff', 'customer'])),
  installed: z.boolean(),
  /** Set when a DIFFERENT version is installed than the one staged. */
  installedVersion: z.string().nullable(),
  /**
   * False when the package's own `manifest.json` could not be read.
   *
   * The row is still returned: bytes on disk that the page cannot describe are
   * exactly the ones an operator needs to see in order to discard them, and
   * hiding them is how a store grows packages nobody can account for.
   */
  readable: z.boolean(),
  /**
   * Where the row comes from. `disk`: a package in the app store, installable
   * with no network. `catalog`: offered only by the cached app catalog, so
   * installing it downloads first.
   */
  source: z.enum(['disk', 'catalog']),
  /** `available` rows are catalog-only; `staged` rows are on disk and not installed. */
  /**
   * `missing` — installed according to the meta store, but its files are not
   * on this server. Before this state, such an app was labelled
   * `installed` here, or left out of the reply when the cached feed did not
   * carry it either.
   */
  state: z.enum(['installed', 'staged', 'available', 'missing']),
  /**
   * For an installed app: the newest version above the installed one that this
   * server can use, from disk or from the catalog. A catalog version whose
   * minimum is above this server does not count (see `needsNewerAdminium`).
   */
  updateTo: z.string().nullable(),
  /** True when `updateTo` is already in the store, so updating needs no download. */
  updateStaged: z.boolean(),
  /**
   * A catalog version this server cannot take, and why (48 G8-D2): the
   * available row itself, or an installed app's newer release. Listed so the
   * page can say "needs Adminium 0.2.9" instead of hiding the app.
   */
  needsNewerAdminium: z
    .object({ version: z.string(), minAdminiumVersion: z.string() })
    .nullable(),
  /**
   * A newer release on disk that cannot update the installed version in
   * place: its manifest's `updatesFrom` leaves this version out. Uninstalling
   * first is the way to it, and the page says so rather than offering it.
   */
  cannotUpdate: z.object({ version: z.string(), updatesFrom: z.string() }).nullable(),
  /** `coming-soon`: the site lists it and there is nothing to download yet. */
  availability: z.enum(['installable', 'coming-soon']),
  /** The catalog's icon: its tint and the icon's SVG path data. Null when only the disk knows the row. */
  iconTint: z.string().nullable(),
  iconPaths: z.array(z.string()).nullable(),
  /** When the site last saw it change, ISO 8601. */
  lastUpdatedAt: z.string().nullable(),
  /** The add-ons its catalog release requires, by key — the card's "Needs Invoices". */
  requiresAddOns: z.array(z.string()),
  /**
   * Each copy installed on this server, one per database: the card shows one
   * version per key, and a status row per copy.
   */
  installs: z.array(
    z.object({
      installId: z.string(),
      connectionId: z.string().nullable(),
      connectionName: z.string(),
      slug: z.string(),
      version: z.string(),
      status: z.string(),
    }),
  ),
});

export const appCatalogReply = z.object({
  apps: z.array(appCatalogEntry),
  /** When the cached app catalog was fetched; null when none is cached (or it is unreadable). */
  catalogFetchedAt: z.number().nullable(),
  /** Whether online browsing is on: `ADMINIUM_NETWORK_FEATURES` AND `apps.catalogEnabled`. */
  onlineEnabled: z.boolean(),
  /** Whether the list is being fetched right now. */
  refreshing: z.boolean(),
});

/**
 * The online app catalog's switch (48 R2, G8-D3): its own setting,
 * `apps.catalogEnabled`, beside the add-on one and never the same.
 *
 * On `manifests.manage` rather than under `/settings/*` for the add-on switch's
 * reason: whether this deployment talks to adminium.dev is not the authority to
 * rename a workspace.
 */
export const appCatalogSettingsBody = z.object({ enabled: z.boolean() });

export const appCatalogSettingsReply = z.object({
  /** The EFFECTIVE state: an environment veto keeps it off whatever was stored. */
  onlineEnabled: z.boolean(),
  /** True when `ADMINIUM_NETWORK_FEATURES` is overriding the stored setting. */
  vetoed: z.boolean(),
});

export const appJobReply = z.object({ jobId: z.string() });

/**
 * An app's sample data, asked for at its install: `addOns` names the add-ons
 * that install put in, whose own sample is added too. Each must be one the
 * app names; one that ships no sample, or holds one, is passed over.
 */
// Nullish: the request has always been sent with no body at all, which arrives as null.
export const addSampleBody = z.object({ addOns: z.array(appKey).max(32).optional() }).nullish();

/** One catalog release to download into the store (48 G8-D5). */
export const downloadAppBody = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
});

/**
 * An update may carry the check's answers for a new version's tables, and the
 * checksum of the plan the operator saw. No body updates as before.
 */
export const updateAppBody = z
  .object({
    planChecksum: z.string().min(1).max(128).optional(),
    choices: installAnswers.choices,
    shares: installAnswers.shares,
    /** As the install's: what to do where a new page's address is taken here. */
    pages: installAnswers.pages,
    /** As the install's: the tables the new version brings that are here already are used as they are. */
    existing: installAnswers.existing,
    /** As the install's: the new version's deployment-wide part, written only when ticked, and the hosts ticked. */
    instance: installAnswers.instance,
    instanceHosts: installAnswers.instanceHosts,
    /**
     * The check's "Allow this public access", for what the new version adds
     * to it: an entry its keys do not hold (`onUpdate: granted`), a key it
     * never had, a staff key opened to a shared link (`opensWithoutStaff`).
     * Only `true` allows it, and only from someone who may manage API keys
     * (otherwise 403). Absent or `false`: the app's keys gain nothing and no
     * key is made. What the version no longer declares is taken back either
     * way.
     */
    publicAccess: z.boolean().optional(),
    /** As the install's: the add-ons the new version needs, installed, connected or updated first. */
    addOns: z.array(appAddOnChoice).max(16).optional(),
    /**
     * The check's say on what the new version's roles hold MORE of an
     * add-on's tables (`roleTables[].wider`): an action, or a column, the
     * running version's did not, including what an add-on it updates gives
     * this or another app's roles more (`appGrants` widened). Only `true`
     * allows it; without it such an update is refused (422
     * `ROLE_TABLES_WIDER`) before anything moves.
     */
    roleTables: z.boolean().optional(),
    /**
     * The check's say on the grants the new version's roles are given that
     * the running version's were not (`privacyGrants[].added`,
     * `addOnGrants[].added`): finding and erasing people's data, or an
     * add-on's shared settings. Only `true` allows them; without it such an
     * update is refused (422 `ROLE_GRANTS_ADDED`) before anything moves.
     */
    roleGrants: z.boolean().optional(),
    /**
     * The check's say on the public endpoints the new version would widen for
     * the keys that already use them (`publicWider[]`): a column a visitor now
     * sees, a method they now have, a filter loosened — the app's own and its
     * add-ons'. Only `true` allows it, and only from someone who may manage
     * API keys (otherwise 403); without it such an update is refused (422
     * `PUBLIC_WIDER`) before anything moves.
     */
    publicWider: z.boolean().optional(),
  })
  // A POST with no body at all arrives as null.
  .nullish();

/** One table the rename to the app's prefix would move. */
const prefixRename = z.object({ ref: z.string(), from: z.string(), to: z.string() });

/**
 * What renaming an install's tables to the app's prefix would do: EVERY table
 * that carries a plain name, and the schema editor's own plan for the renames.
 */
export const renameTablesPlanReply = z.object({
  prefix: z.string(),
  connectionId: z.string(),
  tables: z.array(prefixRename),
  plan: planReply,
});

export const renameTablesBody = z.object({
  /** The `plan.checksum` the operator reviewed; a database that moved answers SCHEMA_DRIFT. */
  checksum: z.string().min(1).max(128),
});

export const renameTablesReply = z.object({
  prefix: z.string(),
  renamed: z.array(prefixRename),
  changeId: z.string(),
});

// ── One app's own settings page ─────────────────────────────────────────────

const appSide = z.enum(['staff', 'customer']);

/**
 * Change one app's settings. Every field is optional and only what is sent
 * changes: its display name (null = the app's own), where its staff screens
 * live, the connection its staff side reads (null = infer), which sides are
 * switched off, and the values of the settings its manifest declares.
 */
export const appSettingsBody = z
  .object({
    name: z.string().trim().min(1).max(60).nullable().optional(),
    placement: z.enum(['internal', 'external']).optional(),
    connectionId: z.string().min(1).nullable().optional(),
    off: z.array(appSide).max(2).optional(),
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const appSettingsReply = z.object({
  key: appKey,
  /** The operator's own name, or null for the app's. */
  name: z.string().nullable(),
  placement: z.enum(['internal', 'external']),
  connectionId: z.string().nullable(),
  off: z.array(appSide),
  /** Every declared, non-secret setting, with its default where none was saved. */
  values: z.record(z.string(), z.unknown()),
  /** This app's mapped hosts. */
  domains: z.record(z.string(), z.object({ side: appSide, instance: z.string().optional() })),
  /** What each of those settings is, so a page can draw its control. Secrets never appear. */
  declared: z.array(
    z.object({
      key: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'enum', 'file', 'json']),
      enum: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      /** The manifest's English label and help. */
      label: z.string().optional(),
      help: z.string().optional(),
    }),
  ),
  /** The add-ons the app names, each with its state and source. Absent for an app that names none. */
  addOns: z.array(appAddOnRow).optional(),
  /**
   * For an app whose customer side calls the public API: whether that API is
   * switched on, and whether the install made the app's access. Absent for an
   * app that asks for none.
   */
  publicAccess: z.object({ apiOn: z.boolean(), granted: z.boolean() }).optional(),
});

/**
 * What one app's settings page shows beside its settings: the connection it
 * reads, every table it uses (with the snapshot's row estimate, never a live
 * count), and its recent activity from the audit log.
 */
export const appOverviewReply = z.object({
  key: appKey,
  connection: z.object({ id: z.string(), name: z.string(), engine: z.string() }).nullable(),
  /**
   * What this install put here: the pages it made (`adminium_pages` of this
   * install), its own email templates (each key once, whatever its
   * languages), the scheduled reports it made, and its roles.
   */
  added: z.object({ pages: z.number(), emailTemplates: z.number(), scheduledReports: z.number(), roles: z.number() }),
  tables: z.array(
    z.object({
      ref: z.string(),
      table: z.string(),
      state: z.string(),
      /** The table was here before the app: the install found it and used it (or shares another app's), and did not make it. */
      before: z.literal(true).optional(),
      /** `sample-ledger`: Adminium's list of the sample rows it added, made on the first add. */
      role: z.enum(['app', 'sample-ledger']),
      /** The last introspection's estimate; null when it has none. */
      rows: z.number().nullable(),
    }),
  ),
  activity: z.array(
    z.object({
      action: z.string(),
      at: z.number(),
      actor: z.string(),
      /** What the action was done to, when the action alone does not name it (an add-on's name). */
      subject: z.string().optional(),
    }),
  ),
});

export const appStatusReply = z.object({
  key: appKey,
  status: z.enum(['installing', 'installed', 'disabled', 'error']),
});

const appDomainTarget = z.object({ side: appSide, instance: z.string().min(1).max(40).optional() });

/** This app's hosts, all of them: the ones left out are unmapped. Other apps' hosts are untouched. */
export const appDomainsBody = z.object({ domains: z.record(z.string(), appDomainTarget) }).strict();
export const appDomainsReply = z.object({ domains: z.record(z.string(), appDomainTarget) });

/** This app's extra instances, all of them. */
export const appInstancesBody = z
  .object({ instances: z.array(z.object({ slug: z.string(), connectionId: z.string().min(1) })).max(32) })
  .strict();
export const appInstancesReply = z.object({
  instances: z.array(z.object({ slug: z.string(), connectionId: z.string() })),
});

// ── Sample data ─────────────────────────────────────────────────────────────

const tableCount = z.object({ ref: z.string(), count: z.number() });

export const sampleStatusReply = z.object({
  /** The app ships a sample bundle. */
  offered: z.boolean(),
  loaded: z.boolean(),
  total: z.number(),
  /** When it was added (epoch ms), or null. */
  addedAt: z.number().nullable(),
  tables: z.array(tableCount),
  /** What an add would write, when the app offers sample data and none is loaded. */
  available: z.object({ total: z.number(), tables: z.array(tableCount), assets: z.number() }).nullable(),
});

export const sampleRemovePlanReply = z.object({
  tables: z.array(tableCount),
  /** Sample rows your own records still use: kept. */
  kept: z.array(
    z.object({
      ref: z.string(),
      label: z.string().nullable(),
      /** What the record is called now (its label column), when it has one. */
      title: z.string().nullable(),
      usedBy: z.number(),
    }),
  ),
  /** Sample rows changed since they were added, and which columns. */
  changed: z.array(
    z.object({ ref: z.string(), label: z.string().nullable(), title: z.string().nullable(), columns: z.array(z.string()) }),
  ),
  total: z.number(),
});

export const sampleRemoveBody = z.object({ keepChanged: z.boolean().default(true) }).strict();

export const sampleRemoveReply = z.object({
  removed: z.number(),
  kept: z.number(),
  byTable: z.record(z.string(), z.number()),
});

/** An update's receipt (48 G8-D6). */
export const updateAppReply = z.object({
  app: installedAppReply,
  from: z.string(),
  to: z.string(),
  /** Older version directories removed once the update succeeded (D11). */
  pruned: z.array(z.string()),
});

export const stagedAppParams = z.object({
  key: appKey,
  version: z.string().min(1).max(64),
});

export const discardStagedAppReply = z.object({
  key: appKey,
  version: z.string(),
  discarded: z.boolean(),
});

/**
 * What uninstalling would remove and keep, for the dialog to say before
 * anything happens. Deleting a role takes its members' membership and its
 * `adm_sk_` keys with it (hard-deleted, not revoked), so both are counted.
 */
export const uninstallPlanReply = z.object({
  key: appKey,
  pages: z.object({
    /** Untouched since install: deleted with their grants. */
    removed: z.array(z.object({ slug: z.string(), title: z.string() })),
    /** Edited by someone: kept as ordinary pages. */
    kept: z.array(z.object({ slug: z.string(), title: z.string() })),
  }),
  keys: z.number(),
  endpoints: z.number(),
  roles: z.array(z.object({ slug: z.string(), name: z.string(), members: z.number(), apiKeys: z.number() })),
  tables: z.array(
    z.object({
      table: z.string(),
      /** Made by this app and named by nothing else: the one kind the option may drop. */
      droppable: z.boolean(),
      /** The other installed apps that use the table too (a shared menu): it is never dropped. */
      sharedWith: z.array(z.object({ key: z.string(), name: z.string() })).optional(),
    }),
  ),
  hosts: z.array(z.string()),
  /**
   * The app's sample rows in tables another app uses too: an uninstall leaves
   * them, and removing the sample data first takes them out. Absent when none.
   */
  sharedSampleRows: z.number().optional(),
  /** Column rules the app wrote that are still as it wrote them: taken back. */
  rules: z.number(),
  /** Discarding data is Super Admin's alone; the dialog offers the drop only when this is true. */
  canDropTables: z.boolean(),
  /**
   * The add-ons connected to the app. They stay installed — they are shared —
   * and only their link to this app goes (the Kept line).
   */
  addOns: z.array(z.object({ key: z.string(), name: z.string(), version: z.string() })).optional(),
  /**
   * The apps on this database that require this one (`apps.requires`): while
   * any is installed, the uninstall is refused (`APP_REQUIRED_BY`). Absent when none.
   */
  requiredBy: z.array(z.object({ key: z.string(), name: z.string() })).optional(),
  /**
   * What the app's deployment-wide part wrote over the server, put back by
   * the uninstall. `canRestore` false: the reader may not change the server's
   * settings, and the uninstall is refused (`INSTANCE_RESTORE_NEEDS_SETTINGS`).
   * Absent when it wrote nothing.
   */
  instance: z.object({ values: z.number(), canRestore: z.boolean() }).optional(),
});

/** Uninstall. Dropping the app's own tables needs the app's key typed back. */
export const uninstallAppBody = z
  .object({
    dropTables: z.boolean().optional(),
    confirmKey: z.string().max(64).optional(),
  })
  .nullish();

export const uninstallAppReply = z.object({
  key: appKey,
  uninstalled: z.boolean(),
  /** What went. Absent from an older server. */
  removed: z
    .object({
      pages: z.number(),
      keys: z.number(),
      endpoints: z.number(),
      roles: z.number(),
      rules: z.number().optional(),
      /** The app's email templates nobody edited. */
      emails: z.number().optional(),
      /** The values its deployment-wide part had written, put back as they were. */
      instance: z.number().optional(),
    })
    .optional(),
  /** What stayed: pages someone edited, and every table not dropped. */
  kept: z
    .object({
      pages: z.number(),
      tables: z.array(z.string()),
      /** Add-ons that stay installed; their link to this app is gone. */
      addOns: z.array(z.string()).optional(),
    })
    .optional(),
  dropped: z.array(z.string()).optional(),
  /** False when the app's files stay: another database still runs this app (they go with its last install), or removing them failed. */
  filesRemoved: z.boolean().optional(),
});


// ── parts ────────────────────────────────────────────────────────────────────

export const appPartParams = z.object({ key: appKey, part: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/) });

/** One part of an installed app, as its page shows it. */
export const appPartDto = z.object({
  id: z.string(),
  /** In the reader's language. */
  label: z.string(),
  default: z.enum(['on', 'off', 'always']),
  /** The owner's switch (true for a part that is always on). */
  switch: z.boolean(),
  /** Whether it is on now: its switch, and every add-on it needs connected. */
  on: z.boolean(),
  /** The add-ons it still waits for, by name. */
  waiting: z.array(z.object({ key: z.string(), name: z.string() })),
  /** Every add-on it is built on, by name, connected or not: the add-on the card draws it under. Absent from an older server. */
  needs: z.array(z.object({ key: z.string(), name: z.string() })).optional(),
  /** Its tables were not made by the install: they are when the add-on it waits for is connected. */
  leftOut: z.boolean(),
  pages: z.number().int(),
  tables: z.number().int(),
  rules: z.number().int(),
  /** Its roles, each in the reader's language, with how many people hold it. */
  roles: z.array(z.object({ slug: z.string(), name: z.string(), members: z.number().int() })),
});

export const appPartsReply = z.object({ parts: z.array(appPartDto) });

/**
 * One rule the app ships, as the app's own people read it: the key the
 * manifest gives it, its name in the reader's language, and whether it is
 * switched on. Nothing else of a rule is ever part of this answer (`.strict()`
 * holds it to these three): not what starts it, its steps, who it tells, an
 * address, or its runs.
 */
export const appRuleDto = z
  .object({
    key: z.string(),
    name: z.string(),
    on: z.boolean(),
  })
  .strict();

export const appRulesReply = z.object({ rules: z.array(appRuleDto) }).strict();

/**
 * What switching a part off would stop, for the question asked first: the
 * rows of its tables that are part way through their states, the rules that
 * are switched on, and the people whose every role is of this part.
 */
export const appPartOpenReply = z.object({
  id: z.string(),
  label: z.string(),
  open: z.array(z.object({ table: z.string(), label: z.string(), rows: z.number().int() })),
  rules: z.number().int(),
  pages: z.number().int(),
  /** People left with nothing switched on for them. */
  stranded: z.number().int(),
});

export const appPartBody = z.object({ on: z.boolean() });

/** A legacy instance of an app (`/apps/<key>/<slug>/…`, made before installs were per database). */
export const appInstanceParams = z.object({
  key: appKey,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
});

/** What making a legacy instance an install of its own would do, before it does it. */
export const appInstanceAdoptPlanReply = z.object({
  key: z.string(),
  slug: z.string(),
  /** The database the instance reads: the new install's own. */
  connectionId: z.string(),
  connectionName: z.string(),
  /** The version installed: the first copy's (one version per app). */
  version: z.string(),
  /** The first copy's settings the new install takes as its own. */
  settings: z.array(z.string()),
  /** The secret settings it does not take: given again on the new copy. */
  secretsLeft: z.array(z.string()),
  /** The roles that open the first copy's staff screens, which will open this one's. */
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const appInstanceAdoptBody = z
  .object({
    /** The checksum of the plan (`POST /apps/plan` on the instance's database with `existing: "use"`) the operator saw. */
    planChecksum: z.string().min(1).max(128).optional(),
  })
  .strict();

export const appInstanceAdoptReply = z.object({
  app: installedAppReply,
  settingsCopied: z.array(z.string()),
  secretsLeft: z.array(z.string()),
  rolesGranted: z.array(z.object({ id: z.string(), name: z.string() })),
});

// ── After you install ────────────────────────────────────────────────────────

export const afterInstallParams = z.object({ key: appKey, id: z.string().min(1).max(64) });

const afterInstallItem = z.object({
  id: z.string(),
  /** `webhook` | `address` | `document` | `delivery` | `recipients` | `payment-key` | `bank-account` | `sender` | `system-grant` | `outbound`. */
  kind: z.string(),
  /** The entry of the file it belongs to: a rule's key, a mail's, a report's, `<table>/<kind>` of a document, a role's. */
  item: z.string(),
  /** What to fill in, inside it. Never the value. */
  field: z.string(),
  /** What it points at, by name (the rule, the mail, the report, the document, the role); null when it is gone. */
  name: z.string().nullable(),
  /** Ticked, or seen done. */
  done: z.boolean(),
  /** Who ticked it; null when nobody did (or it is only seen done). */
  doneBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  doneAt: z.number().nullable(),
  /** The server sees it done: the address filled in, the sender set, the recipients chosen, the permission given. */
  seen: z.boolean(),
  /** The permission a person needs to do it. */
  right: z.string(),
  /** The reader holds `right`, so may tick it or untick it. */
  canTick: z.boolean(),
  /** Where it is done. */
  link: z
    .object({ to: z.enum(['automation', 'email-templates', 'reports', 'roles', 'payments', 'documents', 'settings']), id: z.string().optional() })
    .nullable(),
});

/** One install's "After you install" list. `hidden`: put away once everything was done (an undone item shows it again). */
export const afterInstallReply = z.object({ items: z.array(afterInstallItem), hidden: z.boolean() });

export const afterInstallTickBody = z.object({ done: z.boolean() }).strict();
export const afterInstallHiddenBody = z.object({ hidden: z.boolean() }).strict();

// ── The look and languages a self-made app's file brought ────────────────────

const lookGroup = z.enum(['logo', 'colours', 'languages', 'wordings', 'systemEmails', 'settings']);

/**
 * What this install's deployment-wide part wrote over the server, by group,
 * with the groups somebody changed since (an undo leaves those). `look` is
 * null when it wrote nothing (or it was undone).
 */
export const appLookReply = z.object({
  look: z
    .object({
      /** When the install wrote it. */
      appliedAt: z.number(),
      logo: z.boolean(),
      colours: z.boolean(),
      /** The languages it switched on, by tag. */
      languages: z.array(z.string()),
      wordings: z.number(),
      /** Each edited system email once, whatever its languages. */
      systemEmails: z.number(),
      /** Other plain settings (the menu's name, whether the version shows…). */
      settings: z.number(),
      changed: z.array(lookGroup),
      /** The reader may change the server's settings, and so put it back. */
      canUndo: z.boolean(),
    })
    .nullable(),
});

export const appLookUndoReply = z.object({
  /** Values put back: `<kind>:<item>`. */
  restored: z.array(z.string()),
  /** Values somebody changed since the install: left as they are. */
  kept: z.array(z.string()),
});
