// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture of a landing page, inside the frame the renderer draws for it:
 * the page's own copy (an address the pages door gave), described for people
 * who cannot see it, or `alt=""` when it is only decoration.
 *
 * One that does not load (or has no address) draws a quiet box of the same
 * size with its description, no broken-picture icon (comp boards 1d-1,
 * 1d-2); a decorative one draws the box alone, hidden from screen readers.
 */
import { useState, type ReactNode } from 'react';

export function PagePicture({ src, alt, decorative }: { src: string | undefined; alt: string; decorative: boolean }): ReactNode {
  const [failed, setFailed] = useState(src === undefined);
  if (failed || src === undefined) {
    return decorative ? (
      <div className="lp-picture-empty" aria-hidden="true" />
    ) : (
      <div className="lp-picture-empty" role="img" aria-label={alt}>
        <span aria-hidden="true">{alt}</span>
      </div>
    );
  }
  return <img src={src} alt={decorative ? '' : alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
