// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose deciding code this server may run, as it is kept: the packages the
 * build bundles (`bundled-pins.ts`), the ones recorded when the bundled seed
 * staged them or a catalogue download verified them (the meta setting
 * `addOns.deciderTrust`), and a developer's list from the environment.
 * A package uploaded by hand is recorded nowhere, so its deciding code does
 * not load. The judgement itself is `deciderTrusted` (`decide.ts`).
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { BUNDLED_PINS } from './bundled-pins.js';
import type { TrustSources, TrustedPackage } from './decide.js';

/** Records that a package's bytes were vouched for: by the build's own bundle, or by the catalogue's feed. */
export async function recordDeciderTrust(meta: MetaDb, pkg: TrustedPackage): Promise<void> {
  const settings = settingsRepo(meta);
  const recorded = await settings.get('addOns.deciderTrust');
  const id = `${pkg.key}@${pkg.version}`;
  if (recorded[id] === pkg.integrity) return;
  await settings.set('addOns.deciderTrust', { ...recorded, [id]: pkg.integrity });
}

/** Everything the judgement reads, as it stands now. */
export async function trustSources(meta: MetaDb, env: Readonly<Record<string, string | undefined>> = process.env): Promise<TrustSources> {
  return {
    bundled: BUNDLED_PINS,
    recorded: await settingsRepo(meta).get('addOns.deciderTrust'),
    devKeys: env['ADMINIUM_ADD_ON_DEV_TRUST'],
    nodeEnv: env['NODE_ENV'],
  };
}
