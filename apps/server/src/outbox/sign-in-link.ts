// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `{{signInLink}}` — a link that signs the reader into the app's client side.
 *
 * The sender asks for one only at send time, only for the person the
 * outbox's recipient names, and only when the address the message is going
 * to IS that person's address as it is now (trimmed, lower-case). A message
 * addressed anywhere else — an old address kept on a held reminder, one a
 * person typed, a studio notice sent to a setting — gets an empty variable,
 * never a link to someone else's account. The link itself is made by the
 * public side, which owns sign-in; this is the one call the outbox needs.
 */
export interface SignInLinkMinter {
  /**
   * A one-use sign-in link for one identity row of an installed app, bound to
   * that row's current email, under the app's guest address `base` (its own
   * host, else the server's public address — never a request's Host). Null
   * when the app offers no emailed-link sign-in, or none could be made; the
   * email then goes without one.
   */
  mint(input: {
    appKey: string;
    connectionId: string;
    /** The identity table's id, as the outbox definition stores it. */
    table: string;
    /** The identity row's primary key. */
    pk: Record<string, string | number>;
    /** The address the message is going to, normalised: the row's current email. */
    email: string;
    base: string;
    now: number;
    /**
     * Where to open once signed in: a route of the app's client side (its
     * manifest's `frontends[].routes`), filled with the row the message is
     * about — `/invoices/42` — and never a URL. The public side carries it
     * in the link's fragment and checks it against the app's routes again.
     */
    to?: string;
  }): Promise<string | null>;
}
