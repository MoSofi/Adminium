// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Inside the desktop app, while the project this window holds is shared on the
 * network: one line over the dashboard that says so, with the way back to the
 * sharing details (the addresses, "Go back to building"). Nothing anywhere
 * else: in a browser there is no bridge, and a project being built has the
 * Designer's own bar.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { RadioTower } from 'lucide-react';

import { t } from '../i18n/t.js';
import { getDesktopApi } from '../lib/desktop-runtime.js';

export function ShareBanner(): ReactNode {
  const project = getDesktopApi()?.project;
  const [shared, setShared] = useState(false);
  useEffect(() => {
    if (project?.shareInfo === undefined) return;
    let live = true;
    void project.shareInfo().then(
      (info) => {
        if (live) setShared(info !== null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [project]);
  if (!shared || project?.showShared === undefined) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-pos-soft px-4 py-2 text-[12.5px] leading-normal text-fg">
      <RadioTower aria-hidden="true" className="size-4 shrink-0 text-pos" />
      <span className="min-w-0 flex-1">{t('desktop.shared.banner', 'This project is shared on your network. The Designer is off while it is.')}</span>
      <button type="button" onClick={() => void project.showShared?.()} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold text-accent hover:underline">
        {t('desktop.shared.details', 'Sharing details')}
      </button>
    </div>
  );
}
