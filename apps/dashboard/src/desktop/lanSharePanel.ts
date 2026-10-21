// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The panel's anchor, for "click → LAN panel".
 *
 * A hash and not a route: this is a panel opened FROM the toggle, and it
 * lives on the desktop settings page next to the switch that controls it. The
 * chip needs somewhere to send you, not a second page to maintain.
 */
//
// Its own module so the runtime chip, which is on every page, can name the
// panel without pulling the LAN share module into the first load.
export const LAN_SHARE_PANEL_HASH = 'lan-share';
