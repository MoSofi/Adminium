// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a model wrote, drawn as text is: headings, lists, bold, code, tables.
 *
 * A model's words are data. Nothing here runs or fetches any of it: there is
 * no HTML (a tag is shown as the characters it is), an image is its
 * description, and a link is its words with the address beside them, never
 * something to click. Every node is a React element made from a fixed set of
 * tags; no string is ever handed to the browser as markup.
 *
 * It is read while it is still being written, so a piece that has not ended
 * yet (a code block with no closing fence, a `**` with no partner) is drawn
 * as what it is so far, and never throws.
 */
import type { ReactNode } from 'react';

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; head: string[]; align: ('start' | 'center' | 'end')[]; rows: string[][] };

interface ListItem {
  text: string;
  children: Block[];
}

/** The most a reply is parsed for; the rest is shown as it is. A model's reply is a few thousand characters. */
const MAX_PARSED = 60_000;
/** How deep a list may nest before its items are drawn flat. */
const MAX_DEPTH = 4;

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const out: string[] = [];
  let cell = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;
    if (char === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (char === '|') {
      out.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  out.push(cell.trim());
  return out;
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1] as string;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${mark[0] === '`' ? '`' : '~'}{${String(mark.length)},}\\s*$`).test(lines[i] as string)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({ type: 'heading', level: (heading[1] as string).length, text: heading[2] as string });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1] as string) && (lines[i + 1] as string).includes('-')) {
      const head = cells(line);
      const align = cells(lines[i + 1] as string).map((cell) => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'end' : 'start'));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).includes('|') && (lines[i] as string).trim() !== '') {
        rows.push(cells(lines[i] as string));
        i += 1;
      }
      blocks.push({ type: 'table', head, align, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] as string)) {
        body.push((QUOTE.exec(lines[i] as string) as RegExpExecArray)[1] as string);
        i += 1;
      }
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }

    const first = ITEM.exec(line);
    if (first !== null) {
      const indent = (first[1] as string).length;
      const ordered = /\d/.test(first[2] as string);
      const items: ListItem[] = [];
      let inner: string[] = [];
      const close = (): void => {
        const last = items.at(-1);
        if (last !== undefined && inner.length > 0) last.children = depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : [{ type: 'paragraph', text: inner.map((entry) => entry.trim()).join('\n') }];
        inner = [];
      };
      while (i < lines.length) {
        const current = lines[i] as string;
        const item = ITEM.exec(current);
        if (current.trim() === '') {
          // A blank line ends the list unless what follows is more of it.
          const next = lines[i + 1];
          if (next === undefined || (ITEM.exec(next) === null && !/^\s{2,}\S/.test(next))) break;
          if (inner.length > 0) inner.push('');
          i += 1;
          continue;
        }
        if (item !== null && (item[1] as string).length <= indent) {
          if ((item[1] as string).length < indent || /\d/.test(item[2] as string) !== ordered) break;
          close();
          items.push({ text: item[3] as string, children: [] });
        } else if (item !== null || /^\s{2,}\S/.test(current)) {
          // Deeper: a nested list, or more of the item.
          if (item === null && inner.length === 0) (items.at(-1) as ListItem).text += `\n${current.trim()}`;
          else inner.push(current.slice(Math.min(indent + 2, current.length - current.trimStart().length)));
        } else if (FENCE.test(current) || HEADING.test(current) || RULE.test(current) || QUOTE.test(current)) {
          break;
        } else {
          // A line with no mark continues the item above it.
          (items.at(-1) as ListItem).text += `\n${current.trim()}`;
        }
        i += 1;
      }
      close();
      const from = Number.parseInt(first[2] as string, 10);
      blocks.push({ type: 'list', ordered, start: Number.isFinite(from) ? from : 1, items });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length) {
      const current = lines[i] as string;
      if (current.trim() === '' || FENCE.test(current) || HEADING.test(current) || RULE.test(current) || QUOTE.test(current) || ITEM.test(current)) break;
      if (body.length > 0 && current.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1] as string)) break;
      body.push(current.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

const CODE = 'rounded-[5px] bg-surface-3 px-[5px] py-px font-mono text-[0.92em] text-fg';
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

/** Where a closing `mark` is, from `from`, with something between; -1 when there is none. */
function closing(text: string, mark: string, from: number): number {
  let at = text.indexOf(mark, from);
  while (at !== -1) {
    const before = text[at - 1] as string;
    // `**` inside a longer run of stars belongs to that run.
    if (at > from && before !== ' ' && before !== '\n' && before !== '\\') return at;
    at = text.indexOf(mark, at + 1);
  }
  return -1;
}

/** The inline pieces of one run of text: bold, italic, struck, code, a link's words. */
export function inline(text: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain === '') return;
    // A line break inside a paragraph is kept: a model writes lines, not wrapped prose.
    plain.split('\n').forEach((piece, index) => {
      if (index > 0) out.push(<br key={`b${String(out.length)}`} />);
      if (piece !== '') out.push(piece);
    });
    plain = '';
  };
  const push = (node: ReactNode): void => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const next = text[i + 1];

    if (char === '\\' && next !== undefined && PUNCTUATION.test(next)) {
      plain += next;
      i += 2;
      continue;
    }

    if (char === '`') {
      let run = 1;
      while (text[i + run] === '`') run += 1;
      const mark = '`'.repeat(run);
      const end = text.indexOf(mark, i + run);
      if (end !== -1) {
        push(
          <code key={out.length} dir="ltr" className={CODE}>
            {text.slice(i + run, end).replace(/\n/g, ' ')}
          </code>,
        );
        i = end + run;
        continue;
      }
      plain += mark;
      i += run;
      continue;
    }

    // An image is never fetched: its description stands for it.
    if (char === '!' && next === '[') {
      const image = /^!\[([^\]]*)\]\([^)]*\)/.exec(text.slice(i));
      if (image !== null) {
        plain += image[1] as string;
        i += image[0].length;
        continue;
      }
    }

    // A link is its words, with the address beside them: nothing a model wrote is something to click.
    if (char === '[') {
      const link = /^\[([^\]]+)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(i));
      if (link !== null) {
        const words = link[1] as string;
        const address = link[2] as string;
        push(<span key={out.length}>{depth < 6 ? inline(words, depth + 1) : words}</span>);
        if (/^https?:\/\//i.test(address) && address !== words) {
          push(
            <span key={out.length} dir="ltr" className="break-all font-mono text-[0.92em] text-fg-muted">
              {` (${address})`}
            </span>,
          );
        }
        i += link[0].length;
        continue;
      }
    }

    if (depth < 6 && (char === '*' || char === '_' || char === '~')) {
      const double = next === char;
      const mark = double ? char + char : char;
      const opens = text[i + mark.length] !== undefined && !/\s/.test(text[i + mark.length] as string);
      // An underscore inside a word is a name (order_code), not emphasis.
      const insideWord = char === '_' && i > 0 && WORD.test(text[i - 1] as string);
      if (opens && !insideWord && (char !== '~' || double)) {
        let end = closing(text, mark, i + mark.length + 1);
        // A single star's partner is not half of a pair.
        while (end !== -1 && !double && (text[end + 1] === char || text[end - 1] === char)) end = closing(text, mark, end + 2);
        if (end !== -1 && char === '_' && text[end + mark.length] !== undefined && WORD.test(text[end + mark.length] as string)) end = -1;
        if (end !== -1) {
          const inner = inline(text.slice(i + mark.length, end), depth + 1);
          push(
            char === '~' ? (
              <del key={out.length}>{inner}</del>
            ) : double ? (
              <strong key={out.length} className="font-bold text-fg">
                {inner}
              </strong>
            ) : (
              <em key={out.length}>{inner}</em>
            ),
          );
          i = end + mark.length;
          continue;
        }
      }
      plain += mark;
      i += mark.length;
      continue;
    }

    plain += char;
    i += 1;
  }
  flush();
  return out;
}

const TEXT = 'text-[13.5px] leading-normal text-fg';
const ALIGN = { start: 'text-start', center: 'text-center', end: 'text-end' } as const;

function draw(blocks: readonly Block[], caret: ReactNode, top: boolean): ReactNode[] {
  return blocks.map((block, index) => {
    const tail = top && index === blocks.length - 1 ? caret : null;
    switch (block.type) {
      case 'heading': {
        const Tag = block.level <= 2 ? 'h3' : 'h4';
        return (
          <Tag key={index} dir="auto" className={`m-0 text-pretty font-extrabold leading-snug text-fg ${block.level <= 2 ? 'text-[15px]' : 'text-[13.5px]'}`}>
            {inline(block.text)}
            {tail}
          </Tag>
        );
      }
      case 'code':
        return (
          <pre key={index} dir="ltr" className="nb-scroll m-0 max-w-full overflow-x-auto rounded-lg bg-surface-3 px-3 py-2.5 text-start font-mono text-[12px] leading-snug text-fg">
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={index} className="m-0 border-0 border-t border-border" />;
      case 'quote':
        return (
          <blockquote key={index} dir="auto" className={`m-0 border-s-2 border-border-strong ps-3 text-fg-muted ${TEXT}`}>
            {inline(block.text)}
            {tail}
          </blockquote>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={index} dir="auto" {...(block.ordered && block.start !== 1 ? { start: block.start } : {})} className={`m-0 flex flex-col gap-1 ps-5 ${block.ordered ? 'list-decimal' : 'list-disc'} ${TEXT} marker:text-fg-subtle`}>
            {block.items.map((item, at) => (
              <li key={at} className="ps-0.5">
                {inline(item.text)}
                {item.children.length === 0 && at === block.items.length - 1 ? tail : null}
                {item.children.length === 0 ? null : <div className="mt-1 flex flex-col gap-1.5">{draw(item.children, null, false)}</div>}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={index} className="nb-scroll max-w-full overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12.5px] leading-snug text-fg">
              <thead>
                <tr className="bg-surface-2">
                  {block.head.map((cell, at) => (
                    <th key={at} scope="col" dir="auto" className={`border-b border-border px-2.5 py-1.5 font-bold ${ALIGN[block.align[at] ?? 'start']}`}>
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, at) => (
                  <tr key={at} className="border-b border-border last:border-b-0">
                    {block.head.map((_, column) => (
                      <td key={column} dir="auto" className={`px-2.5 py-1.5 align-top text-fg-muted ${ALIGN[block.align[column] ?? 'start']}`}>
                        {inline(row[column] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return (
          <p key={index} dir="auto" className={`m-0 text-pretty ${TEXT}`}>
            {inline(block.text)}
            {tail}
          </p>
        );
    }
  });
}

/**
 * A model's reply. `caret` is drawn at the end of the last line while the
 * reply is still being written.
 */
/** The few signs a model writes as TeX in the middle of a sentence. Nothing else of TeX is read. */
const SIGNS: Record<string, string> = { rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', times: '×', le: '≤', ge: '≥', ne: '≠', approx: '≈' };
const signs = (text: string): string => text.replace(/\$\s*\\(rightarrow|to|leftarrow|leftrightarrow|times|le|ge|ne|approx)\s*\$/g, (_whole, name: string) => SIGNS[name] ?? _whole);

export function Markdown({ text: written, caret = null }: { text: string; caret?: ReactNode }): ReactNode {
  const text = signs(written);
  const parsed = text.length > MAX_PARSED ? text.slice(0, MAX_PARSED) : text;
  const rest = text.length > MAX_PARSED ? text.slice(MAX_PARSED) : '';
  const blocks = parseBlocks(parsed.replace(/\r\n?/g, '\n').split('\n'), 0);
  const last = blocks.at(-1);
  // A caret has a line to stand on only in text; after a code block or a table it would be a line of its own.
  const inText = rest === '' && last !== undefined && (last.type === 'paragraph' || last.type === 'heading' || last.type === 'list' || last.type === 'quote');
  return (
    <div className="flex min-w-0 flex-col gap-2.5 break-words">
      {draw(blocks, inText ? caret : null, true)}
      {rest === '' ? null : <p className={`m-0 whitespace-pre-wrap ${TEXT}`}>{rest}</p>}
    </div>
  );
}
