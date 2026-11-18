// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE, DRAWN: the one renderer the stranger's page and the
 * add-on's editor canvas both use, so the canvas looks exactly like the page
 * a stranger sees.
 *
 *  - PURE: it reads its props and nothing else. It fetches nothing, holds no
 *    words of its own (the canvas's "Edit …" labels come from `words`), and
 *    imports only React (`react/jsx-runtime` is React's own), so an add-on's
 *    build can alias it to the host's runtime.
 *  - TEXT AS TEXT: every text of the page is drawn as React text, never as
 *    markup; a link's address comes only from its typed link.
 *  - STYLES: plain CSS on the house tokens, in `landing.css` beside this file
 *    (`@adminium/add-on-contracts/landing/landing.css`), classes prefixed
 *    `lp-`, logical properties only, so one set of rules lays the page out at
 *    phone width and at 1280, left to right and right to left.
 *  - HEADINGS: exactly one `h1`: the first Hero's heading, else the first
 *    Heading's, else the page's title drawn for screen readers only. Every
 *    other heading of a block is `h2`, and an item under a titled block is
 *    `h3`.
 *  - SLOTS: what the renderer cannot draw on its own is the host's: the form
 *    a Form block shows, a picture's file, the cookie banner, a feature's
 *    icon (from the closed list) and the address of another page. For a
 *    stranger, a Form block whose slot draws nothing is left out, and so is a
 *    button whose link goes nowhere (a page that is not live, no form on the
 *    page).
 *  - THE CANVAS (`mode: 'canvas'`): each block is a group, marked with
 *    `data-block-id`, holding one "Edit {kind}" button; the host draws the
 *    selection around it. Links carry no address there, so nothing in the
 *    editor leaves it.
 */
import type { ReactNode } from 'react';

import type { LandingBlock, LandingBlockKind, LandingBlockOf, LandingFeatureIcon, LandingLink, LandingPage, PictureRef } from './document.js';
import { mainHeadingOf } from './headings.js';

/** What the host draws for the renderer. */
export interface LandingRenderSlots {
  /** The form a Form block shows: the real form for a stranger, a stand-in on the canvas. */
  form?: ((block: LandingBlockOf<'form'>) => ReactNode) | undefined;
  /** A picture's file, inside the frame the renderer draws. Without it, the frame shows the description. */
  picture?: ((ref: PictureRef, opts: { decorative: boolean; alt: string }) => ReactNode) | undefined;
  /** The cookie banner, docked under the page. */
  banner?: (() => ReactNode) | undefined;
  /** A feature's icon, by its name on the closed list. */
  icon?: ((name: LandingFeatureIcon) => ReactNode) | undefined;
  /** The address of another page of the add-on, by its key; null when it has none (not live). */
  pageHref?: ((key: string) => string | null) | undefined;
}

/** The words the renderer shows, all the host's. */
export interface LandingRenderWords {
  /** The canvas's button on a block: "Edit Hero". */
  edit: (kind: LandingBlockKind) => string;
}

export interface LandingPageViewProps {
  page: LandingPage;
  /** The page's language (`lang` on the page). */
  language: string;
  /** Its direction: `rtl` lays the page out right to left. */
  dir: 'ltr' | 'rtl';
  /** For a stranger, or on the editor's canvas. */
  mode: 'stranger' | 'canvas';
  slots?: LandingRenderSlots | undefined;
  /** Needed on the canvas, for its "Edit …" buttons. */
  words?: LandingRenderWords | undefined;
  /** The canvas's "Edit …" button was pressed on this block. */
  onEdit?: ((blockId: string) => void) | undefined;
}

/** The anchor a Form block is reached by (a link to "the form on this page"). */
export const landingFormAnchor = (blockId: string): string => `lp-form-${blockId}`;

/** A text's paragraphs: split at a blank line. A single line break stays inside its paragraph. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ ]*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

interface Context {
  props: LandingPageViewProps;
  /** The block whose heading is the page's `h1`; null when the title is. */
  main: string | null;
  /** The first Form block, which a link to "the form on this page" goes to. */
  firstForm: string | null;
}

function Paragraphs({ text, className }: { text: string; className: string }) {
  return (
    <>
      {paragraphsOf(text).map((part, index) => (
        <p key={index} className={className}>
          {part}
        </p>
      ))}
    </>
  );
}

/** Where a link goes, or nothing: never on the canvas, never for a page with no address. */
function hrefOf(link: LandingLink, ctx: Context): string | undefined {
  if (ctx.props.mode === 'canvas') return undefined;
  if (link.kind === 'url') return link.href;
  if (link.kind === 'form') return ctx.firstForm === null ? undefined : `#${landingFormAnchor(ctx.firstForm)}`;
  return ctx.props.slots?.pageHref?.(link.key) ?? undefined;
}

/** Whether a link goes nowhere for a stranger (a page not live, no form on the page): its button is left out. */
function goesNowhere(link: LandingLink, ctx: Context): boolean {
  return ctx.props.mode === 'stranger' && hrefOf(link, ctx) === undefined;
}

function LinkButton({ label, link, ctx }: { label: string; link: LandingLink; ctx: Context }) {
  if (goesNowhere(link, ctx)) return null;
  return (
    <a className="lp-button" href={hrefOf(link, ctx)}>
      {label}
    </a>
  );
}

function Picture({ picture, shape, ctx }: { picture: PictureRef; shape: 'wide' | 'card'; ctx: Context }) {
  const decorative = 'decorative' in picture;
  const alt = 'alt' in picture ? picture.alt : '';
  const slot = ctx.props.slots?.picture;
  return (
    <div className="lp-picture" data-shape={shape}>
      {slot !== undefined ? (
        slot(picture, { decorative, alt })
      ) : decorative ? (
        <div className="lp-picture-empty" aria-hidden="true" />
      ) : (
        <div className="lp-picture-empty" role="img" aria-label={alt}>
          <span aria-hidden="true">{alt}</span>
        </div>
      )}
    </div>
  );
}

function Hero({ block, ctx }: { block: LandingBlockOf<'hero'>; ctx: Context }) {
  const Heading = ctx.main === block.id ? 'h1' : 'h2';
  return (
    <section className="lp-section lp-hero" data-pictured={block.picture === undefined ? undefined : ''}>
      <div className="lp-hero-words">
        <Heading className="lp-display">{block.heading}</Heading>
        <Paragraphs text={block.text} className="lp-lead" />
        {block.button === undefined ? null : <LinkButton label={block.button.label} link={block.button.link} ctx={ctx} />}
      </div>
      {block.picture === undefined ? null : <Picture picture={block.picture} shape="card" ctx={ctx} />}
    </section>
  );
}

function Columns({ block, ctx }: { block: LandingBlockOf<'columns'>; ctx: Context }) {
  return (
    <section className="lp-section lp-columns" data-count={block.columns.length}>
      {block.columns.map((one, index) => (
        <div key={index} className="lp-column">
          {one.heading === undefined ? null : <h2 className="lp-title">{one.heading}</h2>}
          <Paragraphs text={one.text} className="lp-body" />
          {one.picture === undefined ? null : <Picture picture={one.picture} shape="card" ctx={ctx} />}
        </div>
      ))}
    </section>
  );
}

function Features({ block, ctx }: { block: LandingBlockOf<'features'>; ctx: Context }) {
  // An item is a section of its own when the block has no title, and under it when it has one.
  const Item = block.title === undefined ? 'h2' : 'h3';
  return (
    <section className="lp-band">
      <div className="lp-section lp-features">
        {block.title === undefined ? null : <h2 className="lp-title lp-features-title">{block.title}</h2>}
        <ul className="lp-feature-list">
          {block.items.map((item, index) => (
            <li key={index} className="lp-feature">
              <span className="lp-feature-icon" aria-hidden="true">
                {item.icon === undefined ? null : (ctx.props.slots?.icon?.(item.icon) ?? null)}
              </span>
              <Item className="lp-item-title">{item.heading}</Item>
              <Paragraphs text={item.text} className="lp-item-text" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Questions({ block }: { block: LandingBlockOf<'questions'> }) {
  return (
    <section className="lp-section lp-questions">
      <h2 className="lp-title">{block.title}</h2>
      {block.items.map((item, index) => (
        <details key={index} className="lp-question">
          <summary className="lp-question-summary">
            <span className="lp-question-text">{item.question}</span>
            <span className="lp-chevron" aria-hidden="true" />
          </summary>
          <Paragraphs text={item.answer} className="lp-answer" />
        </details>
      ))}
    </section>
  );
}

function Block({ block, ctx }: { block: LandingBlock; ctx: Context }): ReactNode {
  switch (block.kind) {
    case 'hero':
      return <Hero block={block} ctx={ctx} />;
    case 'heading': {
      const main = ctx.main === block.id;
      const Heading = main ? 'h1' : 'h2';
      return (
        <div className="lp-section lp-heading">
          <Heading className={main ? 'lp-display' : 'lp-title'}>{block.text}</Heading>
        </div>
      );
    }
    case 'text':
      return (
        <div className="lp-section lp-text">
          <Paragraphs text={block.text} className="lp-body" />
        </div>
      );
    case 'picture':
      return (
        <div className="lp-section lp-picture-block">
          <Picture picture={block.picture} shape="wide" ctx={ctx} />
        </div>
      );
    case 'button':
      if (goesNowhere(block.link, ctx)) return null;
      return (
        <div className="lp-section lp-actions">
          <LinkButton label={block.label} link={block.link} ctx={ctx} />
        </div>
      );
    case 'columns':
      return <Columns block={block} ctx={ctx} />;
    case 'features':
      return <Features block={block} ctx={ctx} />;
    case 'quote':
      return (
        <div className="lp-section">
          <figure className="lp-quote">
            <blockquote className="lp-quote-text">
              <Paragraphs text={block.text} className="lp-quote-line" />
            </blockquote>
            <figcaption className="lp-quote-who">{block.who}</figcaption>
          </figure>
        </div>
      );
    case 'questions':
      return <Questions block={block} />;
    case 'spacer':
      return <div className="lp-spacer" data-size={block.size} aria-hidden="true" />;
    case 'form': {
      const form = ctx.props.slots?.form?.(block) ?? null;
      // A form the host leaves out (not live, not in the page's language) leaves no empty band for a stranger.
      if (form === null && ctx.props.mode === 'stranger') return null;
      return (
        <section className="lp-band lp-form" id={landingFormAnchor(block.id)}>
          <div className="lp-form-card">{form}</div>
        </section>
      );
    }
  }
}

/** A landing page, drawn from its document. */
export function LandingPageView(props: LandingPageViewProps) {
  const { page, language, dir, mode, slots, words, onEdit } = props;
  const main = mainHeadingOf(page).block;
  const firstForm = page.blocks.find((block) => block.kind === 'form')?.id ?? null;
  const ctx: Context = { props, main, firstForm };
  return (
    <div className="lp" lang={language} dir={dir} data-mode={mode}>
      {/* The banner is read first and drawn docked under the page (the stylesheet moves it). */}
      {slots?.banner === undefined ? null : <div className="lp-banner">{slots.banner()}</div>}
      <div className="lp-page">
        {main === null ? <h1 className="lp-hidden">{page.title}</h1> : null}
        {page.blocks.map((block) =>
          mode === 'canvas' ? (
            <div key={block.id} role="group" className="lp-block" data-block-id={block.id} data-kind={block.kind}>
              <button type="button" className="lp-edit" onClick={() => onEdit?.(block.id)}>
                {words?.edit(block.kind) ?? block.kind}
              </button>
              <Block block={block} ctx={ctx} />
            </div>
          ) : (
            <div key={block.id} className="lp-block" data-kind={block.kind}>
              <Block block={block} ctx={ctx} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
