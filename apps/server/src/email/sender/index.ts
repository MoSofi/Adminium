// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sender checks for marketing mail: free-mail domains, DNS (DKIM and
 * DMARC), Adminium's own DKIM key and signature options, each mail service's
 * tracking switches, and the refusals a marketing send meets.
 */
export * from './dkim.js';
export * from './dkim-keys.js';
export * from './dns.js';
export * from './free-mail.js';
export * from './refusals.js';
export * from './relay.js';
