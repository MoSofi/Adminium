// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a refused answer says, by the forms vocabulary's code: loaded at the
 * first Send (`FormBody.tsx`), never in the page's first load, since a form
 * says none of it until an answer has been checked.
 */
import type { useT } from '@adminium/i18n/react';
import type { FormQuestion } from '@adminium/add-on-contracts/forms';

type Translate = ReturnType<typeof useT>;

export function refusalWords(t: Translate, tag: string, question: FormQuestion | undefined, code: string): string {
  const numbers = new Intl.NumberFormat(tag, { numberingSystem: 'latn', maximumFractionDigits: 6 });
  const n = (value: number | undefined): string => (value === undefined ? '' : numbers.format(value));
  switch (code) {
    case 'required':
    case 'text':
      if (question?.kind === 'short' && question.role === 'name') return t('x:error.name', 'Enter your name');
      if (question?.kind === 'short' && question.check === 'email') return t('x:error.email', 'Enter an e-mail address like name@company.com');
      return t('x:error.required', 'Answer this question.');
    case 'too-long':
      return t('x:error.tooLong', 'Keep this to {max, plural, one {# character} other {# characters}}.', { max: question !== undefined && 'maxLength' in question ? question.maxLength : 0 });
    case 'email':
      return t('x:error.email', 'Enter an e-mail address like name@company.com');
    case 'phone':
      return t('x:error.phone', 'Enter a phone number with 6 to 15 digits.');
    case 'choice':
      return t('x:error.choice', 'Pick one of the choices.');
    case 'too-few':
      return t('x:error.tooFew', 'Pick at least {min}.', { min: n(question?.kind === 'several' ? question.min : undefined) });
    case 'too-many':
      return t('x:error.tooMany', 'Pick at most {max}.', { max: n(question?.kind === 'several' ? question.max : undefined) });
    case 'date':
      return t('x:error.date', 'Enter a day.');
    case 'too-early':
      return question?.kind === 'date' && question.from === 'today' ? t('x:error.fromToday', 'Pick a day from today on') : t('x:error.fromTomorrow', 'Pick a day from tomorrow on');
    case 'number':
      return t('x:error.number', 'Enter a number.');
    case 'whole':
      return t('x:error.whole', 'Enter a whole number.');
    case 'too-small':
      return t('x:error.tooSmall', 'Enter {min} or more.', { min: n(question?.kind === 'number' ? question.min : undefined) });
    case 'too-large':
      return t('x:error.tooLarge', 'Enter {max} or less.', { max: n(question?.kind === 'number' ? question.max : undefined) });
    case 'score':
      return t('x:error.score', 'Pick a score from 0 to 10.');
    case 'stars':
      return t('x:error.stars', 'Pick from 1 to 5 stars.');
    case 'file':
      return t('x:error.file', 'This file can’t be taken.');
    case 'tick':
      return t('x:error.tick', 'Tick the box, or leave it empty.');
    default:
      return t('x:error.answer', 'Something in the answers was not taken. Check them and send again.');
  }
}
