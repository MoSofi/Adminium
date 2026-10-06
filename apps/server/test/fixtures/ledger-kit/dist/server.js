// SPDX-License-Identifier: AGPL-3.0-only
/*
 * The test ledger's deciding code: one classic script, as an add-on ships it.
 * It answers which rows a posting into the `units` ledger makes.
 *
 *   use    reserve  one hold per line
 *          post     one entry per line; a hold of this round becomes taken
 *          reverse  the opposite of what the round wrote
 *   count  post     one entry per line; reverse as above
 *   tidy   post     the line's request moved to the state it names
 *   pay    post     one entry per line, for the amount it decides: what is due, as far as the account goes
 *
 * A reserve, and any take a customer makes, is refused when the account has
 * too little and does not allow going below. Staff may take what is not
 * there: the cap on the account, not this file, is what holds then.
 *
 * `settings.misbehave` makes it answer wrongly on purpose, one way at a time,
 * so the engine's checks can each be seen to refuse it.
 */
'use strict';

var PLACES = 3;

/** A decimal written as text, as a whole number of thousandths. */
function units(text) {
  var value = String(text === null || text === undefined ? '0' : text);
  var negative = value.charAt(0) === '-';
  var parts = (negative ? value.slice(1) : value).split('.');
  var fraction = (parts[1] || '').slice(0, PLACES);
  while (fraction.length < PLACES) fraction += '0';
  var whole = BigInt((parts[0] || '0') + fraction);
  return negative ? -whole : whole;
}

/** Thousandths, as a decimal written as text. */
function decimal(value) {
  var negative = value < 0n;
  var digits = String(negative ? -value : value);
  while (digits.length <= PLACES) digits = '0' + digits;
  return (negative ? '-' : '') + digits.slice(0, digits.length - PLACES) + '.' + digits.slice(digits.length - PLACES);
}

function accountOf(input, line) {
  var wanted = line.inputs.account;
  var rows = input.reads.accounts || [];
  for (var i = 0; i < rows.length; i += 1) if (String(rows[i].id) === String(wanted)) return rows[i];
  return null;
}

/** The opposite of everything the round wrote: entries given back, holds let go. */
function reverse(input) {
  var rows = [];
  var entries = input.written.entries || [];
  for (var e = 0; e < entries.length; e += 1) {
    rows.push({ op: 'insert', table: 'entries', line: '', values: { account_id: entries[e].account_id, amount: decimal(-units(entries[e].amount)), kind: 'back', note: null } });
  }
  var holds = input.written.holds || [];
  for (var h = 0; h < holds.length; h += 1) {
    if (holds[h].state === 'held') rows.push({ op: 'update', table: 'holds', line: '', key: { id: holds[h].id }, set: { state: 'released' } });
  }
  return { rows: rows };
}

/** What is left of each account a line asks of, in words a page may show. */
function words(input) {
  var out = [];
  for (var i = 0; i < input.lines.length; i += 1) {
    var line = input.lines[i];
    var account = accountOf(input, line);
    var left = account === null ? 0n : units(account.balance);
    var state = left <= 0n ? 'out' : left <= units(account.reorder_at) ? 'low' : 'in';
    out.push({ line: line.line, state: state, left: decimal(left) });
  }
  return { rows: [], words: out };
}

/** Each line's request, moved to the state the line asks for. */
function tidy(input) {
  var out = { rows: [] };
  var requests = input.reads.requests || [];
  for (var i = 0; i < input.lines.length; i += 1) {
    var line = input.lines[i];
    for (var r = 0; r < requests.length; r += 1) {
      if (String(requests[r].id) === String(line.inputs.request)) out.rows.push({ op: 'update', table: 'requests', line: line.line, key: { id: requests[r].id }, set: { status: line.inputs.to } });
    }
  }
  return out;
}

/** Each line pays what is due from its account, as far as the account goes. */
function pay(input, wrong) {
  var out = { rows: [], decides: [] };
  for (var i = 0; i < input.lines.length; i += 1) {
    var line = input.lines[i];
    var account = accountOf(input, line);
    if (account === null) continue;
    var due = units(line.inputs.due);
    var has = units(account.balance);
    var amount = due < has ? due : has;
    if (wrong === 'negative') amount = -1000n;
    if (wrong === 'over-due') amount = due + 1n;
    if (amount > 0n) out.rows.push({ op: 'insert', table: 'entries', line: line.line, values: { account_id: account.id, amount: decimal(amount), kind: 'pay', note: null } });
    out.decides.push({ line: wrong === 'decide-other-row' ? 'another' : line.line, input: wrong === 'decide-undeclared' ? 'due' : 'amount', value: decimal(amount) });
  }
  return out;
}

function rows(input) {
  var wrong = input.settings.misbehave || null;
  if (wrong === 'throw') throw new Error('the kit was told to throw');
  if (wrong === 'hang') for (;;) {}
  if (wrong === 'promise') return Promise.resolve({ rows: [] });
  // Reaching for a module system: spelled so that this file itself names none.
  if (wrong === 'require') return globalThis['req' + 'uire']('node:fs');
  if (input.mode === 'words') return words(input);
  if (input.phase === 'reverse') return reverse(input);
  if (input.action === 'tidy') return tidy(input);
  if (input.action === 'pay') return pay(input, wrong);

  var out = { rows: [], refusals: [], notes: [] };
  // A hold this round already made is taken by the post that follows it.
  var held = input.written.holds || [];
  for (var h = 0; h < held.length; h += 1) {
    if (input.phase === 'post' && held[h].state === 'held') out.rows.push({ op: 'update', table: 'holds', line: '', key: { id: held[h].id }, set: { state: 'taken' } });
  }
  for (var i = 0; i < input.lines.length; i += 1) {
    var line = input.lines[i];
    var account = accountOf(input, line);
    if (account === null) {
      out.notes.push({ line: line.line, note: 'not-linked' });
      continue;
    }
    var quantity = units(line.inputs.quantity);
    var guarded = input.phase === 'reserve' || input.origin === 'public';
    if (guarded && account.allow_below !== true && units(account.balance) < quantity) {
      out.refusals.push({ line: line.line, reason: 'out-of-stock', left: decimal(units(account.balance)), item: String(account.name) });
      continue;
    }
    if (input.phase === 'reserve') {
      out.rows.push({ op: 'insert', table: 'holds', line: line.line, values: { account_id: account.id, amount: decimal(quantity), state: 'held' } });
      continue;
    }
    var amount = wrong === 'negative' ? -quantity : wrong === 'too-much' ? units('100001') : quantity;
    var into = wrong === 'second-account' ? Number(account.id) + 1000 : account.id;
    out.rows.push({
      op: 'insert',
      table: wrong === 'outside-table' ? 'accounts' : 'entries',
      line: line.line,
      values: wrong === 'outside-table' ? { name: 'made by the kit' } : { account_id: into, amount: decimal(amount), kind: input.action === 'count' ? 'count' : 'use', note: line.inputs.note === undefined ? null : line.inputs.note },
    });
    if (wrong === 'update-total') out.rows.push({ op: 'update', table: 'accounts', line: line.line, key: { id: account.id }, set: { taken: '0.000' } });
  }
  // What kind of value a json setting arrives as: told back, so a test can read it.
  if (input.settings.note !== undefined && input.lines.length > 0) out.notes.push({ line: input.lines[0].line, note: 'to-check', item: typeof input.settings.note });
  return out;
}

module.exports = { rows: rows };
