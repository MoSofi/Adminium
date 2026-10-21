// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The few small readers of a parse5 tree that the page converter and the finder share.
 */
import type { DefaultTreeAdapterMap } from 'parse5';

export type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
export type ParentNode = DefaultTreeAdapterMap['parentNode'];

export const HTML_NS = 'http://www.w3.org/1999/xhtml';

export const isElement = (node: Node): node is Element => 'tagName' in node;
export const attrOf = (el: Element, name: string): string | null => el.attrs.find((attr) => attr.name === name && attr.prefix === undefined)?.value ?? null;
export const isHtml = (el: Element, ...names: string[]): boolean => el.namespaceURI === HTML_NS && names.includes(el.tagName);

/** Elements whose text is not shown. */
const NOT_SHOWN = ['script', 'style', 'template', 'noscript'];

/**
 * The text a node holds, in order, scripts and styles left out, and anything else named in `skip`.
 * It walks with a list of its own, not by calling itself, so a page nested very deep cannot run the stack out.
 */
export function textOf(node: Node, skip: readonly string[] = NOT_SHOWN): string {
  let text = '';
  const stack: Node[] = [node];
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    if (at.nodeName === '#text' && 'value' in at) {
      text += at.value;
      continue;
    }
    if (!('childNodes' in at) || (isElement(at) && skip.includes(at.tagName))) continue;
    for (let k = at.childNodes.length - 1; k >= 0; k -= 1) {
      const child = at.childNodes[k];
      if (child !== undefined) stack.push(child);
    }
  }
  return text;
}
