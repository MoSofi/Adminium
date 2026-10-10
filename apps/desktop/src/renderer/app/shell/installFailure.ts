// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Why getting a project's packages failed, told apart from the installer's own
 * last lines: the four things a person can do something about, each in its own
 * words. Anything else keeps the plain sentence, with the lines under it.
 */
import type { useT } from '@adminium/i18n/react';

export type InstallFailure = 'offline' | 'proxy' | 'disk' | 'registry' | null;

export function installFailureKind(detail: string): InstallFailure {
  // A proxy first: a proxy that refuses also names the registry it would not reach.
  if (/\bE407\b|ERR_PROXY|proxy authentication|tunneling socket/i.test(detail)) return 'proxy';
  if (/\bENOSPC\b|no space left/i.test(detail)) return 'disk';
  if (/\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ERR_SOCKET_TIMEOUT)\b|network request .* failed/i.test(detail)) return 'offline';
  if (/\bE(4\d\d|5\d\d)\b|registry returned|registry error/i.test(detail)) return 'registry';
  return null;
}

/** The sentence for a cause, or `null`: the caller's own plain sentence stands. */
export function installFailureWords(t: ReturnType<typeof useT>, kind: InstallFailure): string | null {
  switch (kind) {
    case 'offline':
      return t('desktop:install.offline', 'Could not reach the internet. The packages come from registry.npmjs.org: check your connection and try again.');
    case 'proxy':
      return t('desktop:install.proxy', 'Your network’s proxy refused the download. Check the proxy settings of this computer and try again.');
    case 'disk':
      return t('desktop:install.disk', 'This disk is full. Free some space and try again.');
    case 'registry':
      return t('desktop:install.registry', 'The package registry answered with an error. Try again in a moment.');
    case null:
      return null;
  }
}
