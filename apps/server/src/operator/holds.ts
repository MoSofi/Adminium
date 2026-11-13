// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the server's operator holds back on this instance, read once at boot
 * and kept in memory: the gate over every public page asks on every request,
 * and only the operator endpoint, in this process, changes it.
 *
 * The one hold today is `public-pages`: every public page hidden, with the
 * reason Studio shows the instance's owner. It is kept in its own meta table
 * (`adminium_operator_holds`), so it survives a restart and no settings route,
 * config import, export or archive reads or writes it.
 *
 * Until the hold has been read once the instance does not know whether its
 * pages are held, so it treats them as held ({@link OperatorHolds.unread}):
 * a boot that cannot read the store keeps serving staff pages and hides the
 * public ones, and tries the read again every {@link HOLDS_RETRY_MS} until
 * it works.
 */
import { operatorHoldsRepo, type MetaDb } from '@adminium/meta';

/** The hold that hides every public page. */
export const PUBLIC_PAGES_HOLD = 'public-pages';

/** How long a boot that could not read the holds waits before it tries again. */
export const HOLDS_RETRY_MS = 30_000;

export interface PublicPagesHold {
  hidden: boolean;
  /** The operator's reason, shown in Studio; null when they gave none or the pages are shown. */
  reason: string | null;
  /** When the operator last changed it; null when they never did. */
  changedAt: number | null;
}

/** A logo for the page a hidden public page answers with: the stored image, inline. */
export interface HiddenPageLogo {
  mime: string;
  bytes: Buffer;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** What the operator holds back on this instance (`operator/holds.ts`). */
    operatorHolds: OperatorHolds;
  }
}

export interface OperatorHolds {
  /** The public pages' hold, as last read or set. */
  publicPages(): PublicPagesHold;
  /**
   * Read the holds from the meta store; the boot calls it before the server answers anything. A store
   * it cannot read (one never migrated, one already closed) leaves the last state and answers why.
   */
  load(): Promise<Error | null>;
  /**
   * True while there is a meta store and the holds have never been read from it (or set): what the
   * operator holds is not known yet, so every public page counts as hidden.
   */
  unread(): boolean;
  /** Stop trying the read again (the server's close). */
  close(): void;
  /** Hide or show every public page, kept in the meta store before it takes effect. */
  setPublicPages(input: { hidden: boolean; reason: string | null }, at?: number): Promise<PublicPagesHold>;
  /** The instance's logo for the hidden page, when the server can read stored files. */
  logo(): Promise<HiddenPageLogo | null>;
  /** Called once by the composition root, which holds the file storage. */
  readLogoWith(reader: () => Promise<HiddenPageLogo | null>): void;
}

const SHOWN: PublicPagesHold = { hidden: false, reason: null, changedAt: null };

export interface OperatorHoldsOptions {
  /** How long to wait before reading again after a read failed; {@link HOLDS_RETRY_MS} unless a test says. */
  retryMs?: number;
  /** Told of each read again that failed too. */
  onRetryFailed?: (error: Error) => void;
}

export function createOperatorHolds(meta: MetaDb | null, opts: OperatorHoldsOptions = {}): OperatorHolds {
  let publicPages: PublicPagesHold = SHOWN;
  let read = meta === null;
  let retry: NodeJS.Timeout | null = null;
  let logoReader: () => Promise<HiddenPageLogo | null> = async () => null;
  const readOnce = async (): Promise<Error | null> => {
    if (meta === null) return null;
    try {
      const row = await operatorHoldsRepo(meta).get(PUBLIC_PAGES_HOLD);
      publicPages = row === null ? SHOWN : { hidden: row.held, reason: row.held ? row.reason : null, changedAt: row.changedAt };
      read = true;
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  const stopRetrying = (): void => {
    if (retry !== null) clearInterval(retry);
    retry = null;
  };
  return {
    publicPages: () => publicPages,
    unread: () => !read,
    async load() {
      const failed = await readOnce();
      if (failed === null) {
        stopRetrying();
        return null;
      }
      if (retry === null) {
        let reading = false;
        retry = setInterval(() => {
          if (reading) return;
          reading = true;
          void readOnce()
            .then((again) => {
              if (again === null) stopRetrying();
              else opts.onRetryFailed?.(again);
            })
            .finally(() => {
              reading = false;
            });
        }, opts.retryMs ?? HOLDS_RETRY_MS);
        retry.unref();
      }
      return failed;
    },
    close: stopRetrying,
    async setPublicPages(input, at = Date.now()) {
      if (meta === null) throw new Error('There is no meta store to keep the hold in.');
      const reason = input.hidden ? input.reason : null;
      const row = await operatorHoldsRepo(meta).set({ name: PUBLIC_PAGES_HOLD, held: input.hidden, reason }, at);
      publicPages = { hidden: row.held, reason: row.reason, changedAt: row.changedAt };
      read = true;
      stopRetrying();
      return publicPages;
    },
    logo: async () => logoReader(),
    readLogoWith(reader) {
      logoReader = reader;
    },
  };
}
