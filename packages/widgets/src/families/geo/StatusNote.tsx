// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';

/**
 * A notice a screen reader reads aloud (`role="status"`). A live region is
 * read when what is IN it changes, and many readers say nothing of one that
 * came into the page already filled. So the region is put in the page empty,
 * and its words are put into it right after.
 */
export function StatusNote({ children, ...rest }: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => setFilled(true), []);
  return (
    <p role="status" {...rest}>
      {filled ? children : null}
    </p>
  );
}
