// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE PLAIN ADDRESS, AND NOTHING ELSE: the one character class every check of
 * a contact's address shares, so none of them can drift from the others.
 *
 * The do-not-email list is keyed by the bare address, and a mail server reads
 * far more than a bare address in a recipient: `<x@y>`, `Name <x@y>`,
 * `"x@y"`, `x@y;` and `a,x@y` are each delivered to `x@y`. A value with any
 * of those characters could pass the list under its own spelling and still
 * reach the mailbox it names, so it is never taken for an address: no
 * spaces, no second `@`, and none of `, ; : < > " ( ) [ ] \`.
 */

/** One plain address and nothing else: what a marketing mail's recipient must be, and what the do-not-email list keeps. */
export const PLAIN_RECIPIENT = /^[^\s@,;:<>"()[\]\\]+@[^\s@,;:<>"()[\]\\]+$/;

/** The same, with a dotted domain: an address a code or an app's mail is sent to. */
export const PLAIN_DOTTED = /^[^\s@,;:<>"()[\]\\]+@[^\s@,;:<>"()[\]\\]+\.[^\s@,;:<>"()[\]\\]+$/;
