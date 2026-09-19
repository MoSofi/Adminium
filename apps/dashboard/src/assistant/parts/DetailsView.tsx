// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where the draft came from: the format it is in, the variables it uses, the
 * tables that were read, the checks the model says it made, and what the turn
 * cost.
 *
 * SOURCES READ IS THE ROW THAT MATTERS. It lists, verbatim, every table this
 * turn actually touched — not what it was allowed to touch. Settings → AI
 * promises that; this is where the promise is kept.
 *
 * CHECKS ARE THE MODEL'S OWN CLAIM and are labelled as such. It is useful to
 * see what it thought it verified, and misleading to show that beside facts
 * without saying which is which. Anything else the model added keeps its own
 * words too, below the page's rows.
 *
 * EVERY ROW IS WORDED HERE. The server sends a KIND and the numbers it reads;
 * the label and the sentence are this app's, because a sentence composed on
 * the server is English on the wire and no locale can translate it. A kind
 * this build does not know renders as nothing — better than a raw key.
 */
import { t } from '../../i18n/t.js';
import type { AssistantDetail, AssistantResult } from '../api.js';

export interface DetailsViewProps {
  result: AssistantResult;
  tokensIn: number;
  tokensOut: number;
}

interface Row {
  label: string;
  value: string;
}

/** One page-supplied row, worded. `null` for a kind this build does not know. */
function rowFor(detail: AssistantDetail): Row | null {
  const args = detail.args;
  switch (detail.kind) {
    case 'formatEmail':
      return {
        label: t('assistant:details.format', 'Format'),
        value: t(
          'assistant:details.formatEmailValue',
          'Adminium email · {blocks, plural, one {# block} other {# blocks}}',
          args,
        ),
      };
    case 'variables':
      return {
        label: t('assistant:details.variables', 'Variables'),
        value:
          args.variables === '' || args.variables === undefined
            ? t('assistant:details.none', 'none')
            : String(args.variables),
      };
    case 'formatInvoice':
      return {
        label: t('assistant:details.format', 'Format'),
        value: t(
          'assistant:details.formatInvoiceValue',
          'Adminium invoice template · {sections, plural, one {# section on} other {# sections on}}',
          args,
        ),
      };
    case 'taxLines':
      return {
        label: t('assistant:details.taxLines', 'Tax lines'),
        value:
          args.rate === '' || args.rate === undefined
            ? t('assistant:details.none', 'none')
            : t('assistant:details.taxLinesValue', '{rate}%', args),
      };
    case 'record':
      return {
        label: t('assistant:details.record', 'Record'),
        value: t('assistant:details.recordValue', 'invoice document · 1 new row · status draft'),
      };
    case 'lines':
      return {
        label: t('assistant:details.lines', 'Lines'),
        value: t('assistant:details.linesValue', '{lines, plural, one {# line} other {# lines}} · {total}', args),
      };
    case 'notTouched':
      return {
        label: t('assistant:details.notTouched', 'Not touched'),
        value: t('assistant:details.notTouchedValue', 'no customer rows are changed, no email is sent'),
      };
    case 'sourcesChosen':
      return {
        label: t('assistant:details.sourcesChosen', 'Sources chosen'),
        value:
          args.sources === '' || args.sources === undefined
            ? t('assistant:details.noChecks', 'none declared')
            : String(args.sources),
      };
    case 'figures':
      return {
        label: t('assistant:details.figures', 'Figures'),
        value: t(
          'assistant:details.figuresValue',
          '{blocks, plural, one {# block with figures} other {# blocks with figures}}',
          args,
        ),
      };
    case 'notPublished':
      return {
        label: t('assistant:details.notPublished', 'Not published'),
        value: t('assistant:details.notPublishedValue', 'saved as a draft'),
      };
    default:
      return null;
  }
}

export function DetailsView({ result, tokensIn, tokensOut }: DetailsViewProps) {
  const rows: Row[] = [
    ...result.details.map(rowFor).filter((row): row is Row => row !== null),
    ...result.modelDetails,
    {
      label: t('assistant:details.sources', 'Sources read'),
      value:
        result.sources.length === 0 ? t('assistant:details.none', 'none') : result.sources.join(', '),
    },
    {
      label: t('assistant:details.checks', 'Checks'),
      value:
        result.checks.length === 0
          ? t('assistant:details.noChecks', 'none declared')
          : result.checks.join(' · '),
    },
    {
      label: t('assistant:details.tokens', 'Tokens'),
      value: t('assistant:details.tokensValue', '{in} in · {out} out', { in: tokensIn, out: tokensOut }),
    },
  ];
  return (
    <dl className="flex flex-col gap-px px-[18px] pb-[18px] pt-3.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-3.5 border-b border-border py-2.5">
          <dt className="w-[150px] shrink-0 text-caption font-bold text-fg-muted">{row.label}</dt>
          <dd className="min-w-0 flex-1 text-body-sm leading-[1.55] text-pretty text-fg">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
