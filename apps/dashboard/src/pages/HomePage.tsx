// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/` fallback when the nav tree is empty: rendered inside the content outlet
 * (`/welcome` onboarding lands with). When nav items exist the index route
 * redirects before this renders.
 *
 * An empty nav is three different things, and only one of them is "no data
 * sources": a connected database with no pages made from it yet (an empty
 * one, or one whose pages are still to be generated), and pages that exist
 * but are not shared with this role. Saying "connect a database" in either
 * sends the reader looking for a setup step that is already done.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { Database, Lock } from 'lucide-react';

import { bootstrapQuery } from '../app/bootstrap.js';
import { StateHero } from '../states/StateHero.js';
import { SYSTEM_STATES, type SystemStateSpec } from '../states/stateMap.js';

const NO_SOURCES = SYSTEM_STATES['empty-no-sources'];

/** Connected, and nothing made from it yet. No button: which step comes next is Studio's to offer. */
export const HOME_NO_PAGES: SystemStateSpec = {
  id: 'empty-no-sources',
  icon: Database,
  tone: 'accent',
  title: { key: 'states.emptyNoPages.title', en: 'No pages yet' },
  body: {
    key: 'states.emptyNoPages.body',
    en: 'A database is connected, but no pages have been made from it yet. Make them in Studio, or install an app.',
  },
};

/** Pages exist, and none is shared with this role. */
export const HOME_WITHHELD: SystemStateSpec = {
  id: 'empty-no-sources',
  icon: Lock,
  tone: 'neutral',
  title: { key: 'states.emptyWithheld.title', en: 'No pages shared with you yet' },
  body: {
    key: 'states.emptyWithheld.body',
    en: 'No pages have been shared with your role yet. Ask an administrator for access.',
  },
};

export function HomePage() {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const spec =
    bootstrap.pagesWithheld === true ? HOME_WITHHELD : bootstrap.hasConnections === true ? HOME_NO_PAGES : NO_SOURCES;
  return <StateHero spec={spec} fullPage={false} />;
}
