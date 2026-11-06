// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHECK STEP'S LIST.
 *
 * Everything that cannot travel as it is, said once:
 *  - `choice`: the person must answer before the file is written (a type with
 *    no form, a personal view, a required cycle, a hit of the secret scan);
 *  - `after`: what the owner fills in after installing (passwords, keys,
 *    webhook addresses, fixed addresses, senders, payment keys, `system:`
 *    grants);
 *  - `info`: for their information (a wildcard narrowed, a built-in role's
 *    change not carried, the minimum Adminium version).
 *
 * An item names the kind, the item and the field. It NEVER holds a value it
 * describes: a secret named in the Check list would be in the reply, the log
 * and the browser.
 */

export type CheckGroup = 'choice' | 'after' | 'info';

/** An answer and the `SaveChoices` list it is recorded in: `carryAsText`, `leaveOut`, `shareViews`, `clear`, `keep`. */
export type CheckAnswerChoice = 'carry-as-text' | 'leave-out' | 'make-shared' | 'clear' | 'keep';

export interface CheckItem {
  group: CheckGroup;
  /** A stable code the wizard words and groups by: `TYPE_NO_FORM`, `PERSONAL_VIEW`, `SECRET_FOUND`… */
  code: string;
  /** What kind of thing: `table`, `column`, `page`, `view`, `role`, `automation`, `email`, `document`, `report`, `invoice`, `schedule`, `public`, `payments`, `add-on`, `rows`. */
  kind: string;
  /** Its name as the person knows it (a table's name, a page's title). */
  item: string;
  field?: string;
  /** One sentence, plain words. */
  message: string;
  /**
   * For `choice`: the key the answer is recorded under in `SaveChoices`
   * (`carryAsText`, `shareViews`, `clear`, `leaveOut`…), and the value that
   * records it there (`<tableId>.<column>`, a view id, `<kind>:<item>:<field>`).
   */
  answer?: {
    choices: readonly CheckAnswerChoice[];
    target: string;
    /** Where one choice records another value than `target` (a leave-out names the whole entry): that choice records this. */
    targets?: Partial<Record<CheckAnswerChoice, string>>;
  };
  /** For `after`: the after-install kind the install records (`webhook`, `address`, `sender`, `system-grant`…). */
  afterKind?: string;
}

export class CheckList {
  readonly #items: CheckItem[] = [];
  readonly #seen = new Set<string>();

  add(item: CheckItem): void {
    const key = `${item.group}\u0000${item.code}\u0000${item.kind}\u0000${item.item}\u0000${item.field ?? ''}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#items.push(item);
  }

  items(): readonly CheckItem[] {
    return this.#items;
  }

  /** The choices not answered yet: a save with any is refused (the wizard shows them). */
  unanswered(): readonly CheckItem[] {
    return this.#items.filter((item) => item.group === 'choice');
  }
}
