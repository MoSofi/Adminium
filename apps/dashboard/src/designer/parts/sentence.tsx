// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A translated sentence with one value drawn its own way (a Figma handle in mono): the sentence is
 * translated whole, so each language puts the value where its own word order wants it.
 */
import type { ReactNode } from 'react';

/** What stands in for the value while the sentence is translated: a character no translation holds. */
export const VALUE_MARK = String.fromCharCode(0x2063);

/** The sentence `t` gave (made with `VALUE_MARK` as the value), with the value drawn by `draw`. */
export function withValue(sentence: string, draw: ReactNode): ReactNode {
  const at = sentence.indexOf(VALUE_MARK);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      {draw}
      {sentence.slice(at + VALUE_MARK.length)}
    </>
  );
}
