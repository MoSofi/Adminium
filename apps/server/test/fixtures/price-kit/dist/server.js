// SPDX-License-Identifier: AGPL-3.0-only
/*
 * The test price add-on's deciding code: one classic script, as an add-on
 * ships it. It answers by how much each line of an order is reduced.
 *
 * The reductions, each on what the one before left:
 *
 *   1. a voucher for a thing, or a pack: the dearest matching unit(s)
 *   2. offers, by kind then by id:
 *        bonus_item   of every `buy_qty` matching units, the cheapest is given
 *        percent      on its lines each, or once on the whole order and split
 *        amount       taken off the whole order (or its lines) and split
 *   3. a voucher worth an amount, split over the whole order
 *   4. what staff took off by hand
 *
 * An amount over several lines is split by what each line still costs:
 * shares rounded down, the cents left over to the largest remainders. A
 * percent is rounded half up, once. Money is whole cents throughout.
 *
 * `settings.misbehave` makes it answer wrongly on purpose, one way at a time,
 * so the engine's checks can each be seen to refuse it.
 */
'use strict';

/** A decimal written as text, as a whole number of the smallest unit. */
function units(text, scale) {
  var value = String(text === null || text === undefined || text === '' ? '0' : text);
  var negative = value.charAt(0) === '-';
  var parts = (negative ? value.slice(1) : value).split('.');
  var fraction = (parts[1] || '').slice(0, scale);
  while (fraction.length < scale) fraction += '0';
  var whole = BigInt((parts[0] || '0') + fraction);
  return negative ? -whole : whole;
}

/** The smallest units, as a decimal written as text. */
function decimal(value, scale) {
  var negative = value < 0n;
  var digits = String(negative ? -value : value);
  while (digits.length <= scale) digits = '0' + digits;
  var out = scale === 0 ? digits : digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
  return (negative ? '-' : '') + out;
}

/** A percent of an amount, rounded half up to the unit. */
function percentOf(base, percent) {
  var hundredths = units(percent, 2);
  return (base * hundredths + 5000n) / 10000n;
}

function min(a, b) {
  return a < b ? a : b;
}

function yes(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function filled(value) {
  return value !== null && value !== undefined && value !== '';
}

/** What an offer or a voucher is called: a name in each language when it keeps them, else its one name. */
function nameOf(row, fallback) {
  var named = row.public_name;
  if (typeof named === 'string' && named.charAt(0) === '{') {
    try {
      named = JSON.parse(named);
    } catch (e) {
      named = null;
    }
  }
  if (named !== null && typeof named === 'object') return named;
  return filled(row.name) ? String(row.name) : filled(row.public_name) ? String(row.public_name) : fallback;
}

function oneName(name) {
  if (typeof name === 'string') return name;
  return name['en-US'] || name[Object.keys(name)[0]] || '';
}

/** `total` split over lines by what each still costs: shares rounded down, what is left over to the largest remainders, the earlier line on a tie. */
function split(total, lines, left) {
  var sum = 0n;
  for (var i = 0; i < lines.length; i += 1) sum += left[lines[i]];
  var shares = {};
  if (sum === 0n || total === 0n) return shares;
  var given = 0n;
  var rest = [];
  for (var j = 0; j < lines.length; j += 1) {
    var exact = total * left[lines[j]];
    var share = exact / sum;
    shares[lines[j]] = share;
    given += share;
    rest.push({ line: lines[j], remainder: exact % sum, at: j });
  }
  rest.sort(function (a, b) {
    return a.remainder === b.remainder ? a.at - b.at : a.remainder > b.remainder ? -1 : 1;
  });
  for (var k = 0; given < total && k < rest.length; k += 1) {
    shares[rest[k].line] += 1n;
    given += 1n;
  }
  return shares;
}

/** Whether a line sells what an offer or a voucher names. */
function sells(line, as, table, row) {
  for (var i = 0; i < line.what.length; i += 1) {
    var what = line.what[i];
    if (what.as === as && String(what.row) === String(row) && (as === 'tag' || String(what.table) === String(table))) return true;
  }
  return false;
}

/** The rows the order's own open round holds of an offer, a code or a voucher: its own use is not counted against it. */
function ownHeld(input, column, id) {
  var rows = (input.held && input.held.redemptions) || [];
  var n = 0;
  // (A row the round gave back is nobody's any more.)
  for (var i = 0; i < rows.length; i += 1) if (rows[i].state !== 'back' && String(rows[i][column]) === String(id)) n += 1;
  return n;
}

/** Why an offer does not stand for this order now, or null. */
function standing(input, offer, typedFor) {
  if (input.mode === 'refund') return null;
  // An offer the order's own round already holds a use of stands for that order, whatever became of it since: the order has it.
  // (`own-not-kept`: an add-on that does not, and judges the order by its customer's count as Adminium hands it in.)
  if (input.settings.misbehave !== 'own-not-kept' && ownHeld(input, 'offer_id', offer.id) > 0) return typedFor === undefined && offer.trigger === 'code' ? 'no-code-typed' : null;
  if (offer.status === 'draft') return 'draft';
  if (offer.status === 'paused') return 'paused';
  if (offer.status === 'ended') return 'ended';
  if (filled(offer.starts_on) && String(offer.starts_on) > input.today) return 'not-yet';
  if (filled(offer.ends_on) && String(offer.ends_on) < input.today) return 'ended';
  if (filled(offer.weekdays) && String(offer.weekdays).split(',').indexOf(String(input.weekday)) < 0) return 'outside-days';
  if (offer.trigger === 'code' && typedFor === undefined) return 'no-code-typed';
  var personal = yes(offer.first_order_only) || filled(offer.group_id) || filled(offer.max_per_customer);
  if (personal) {
    if (input.customer === null) return input.guest ? 'needs-sign-in' : input.origin === 'staff' ? 'needs-customer' : 'unknown';
    if (filled(offer.group_id) && input.customer.groups.indexOf(String(offer.group_id)) < 0) return 'not-in-group';
    if (yes(offer.first_order_only) && input.customer.orders > 0) return 'not-first-order';
    if (filled(offer.max_per_customer) && (input.customer.uses[String(offer.id)] || 0) >= Number(offer.max_per_customer)) return 'over-limit';
  }
  if (filled(offer.max_uses) && Number(offer.uses) - ownHeld(input, 'offer_id', offer.id) >= Number(offer.max_uses)) return 'used-up';
  return null;
}

/** A reason only staff's "why not" view knows, as a typed code is told it. */
var TYPED_REASON = { draft: 'inactive', paused: 'inactive', ended: 'expired', 'outside-days': 'not-yet', 'not-in-group': 'not-for-these-items', 'not-first-order': 'over-limit', 'no-code-typed': 'unknown' };

var PASS = { bonus_item: 1, percent: 2, amount: 3 };

function adjust(input) {
  var scale = input.scale;
  var wrong = input.settings.misbehave || null;
  if (wrong === 'throw') throw new Error('the kit was told to throw');
  if (wrong === 'hang') for (;;) {}
  if (wrong === 'promise') return Promise.resolve({ lines: [], order: { discount: '0' }, applied: [], uses: [], refused: [] });

  var refused = [];
  var told = [];
  var explain = {};

  // What each line still costs. A line that is being given back, that nothing reduces, or that a code pays for, counts for nothing.
  var goods = [];
  var start = {};
  var byKey = {};
  for (var l = 0; l < input.lines.length; l += 1) {
    var line = input.lines[l];
    byKey[line.key] = line;
    if (line.kept && !line.excluded && line.paidBy === null) {
      goods.push(line.key);
      start[line.key] = units(line.amount, scale);
    }
  }

  // The offers handed in; an offer not saved yet stands in for the stored one of its id, or joins them.
  var offers = (input.offers.offers || []).slice();
  if (input.draft) {
    var draft = {};
    for (var name in input.draft) draft[name] = input.draft[name];
    if (!filled(draft.id)) draft.id = 'draft';
    draft.status = 'active';
    var replaced = false;
    for (var d = 0; d < offers.length; d += 1) {
      if (String(offers[d].id) === String(draft.id)) {
        offers[d] = draft;
        replaced = true;
      }
    }
    if (!replaced) offers.push(draft);
  }

  // The codes typed, in the order typed.
  var typedOffer = {};
  var vouchers = [];
  for (var c = 0; c < input.codes.length; c += 1) {
    var code = input.codes[c];
    if (code.row === null) {
      refused.push({ typed: code.typed, reason: 'unknown' });
      continue;
    }
    if (code.kind === 'code') {
      if (typedOffer[String(code.row.offer_id)] !== undefined) continue;
      if (input.mode !== 'refund' && filled(code.row.valid_until) && String(code.row.valid_until) < input.today) {
        refused.push({ typed: code.typed, reason: 'expired' });
        continue;
      }
      if (wrong !== 'adjust-uncounted' && input.mode !== 'refund' && filled(code.row.max_uses) && Number(code.row.uses) - ownHeld(input, 'code_id', code.row.id) >= Number(code.row.max_uses)) {
        refused.push({ typed: code.typed, reason: 'used-up' });
        continue;
      }
      typedOffer[String(code.row.offer_id)] = { typed: code.typed, row: code.row };
      continue;
    }
    var v = code.row;
    var why = null;
    if (v.status === 'voided') why = 'void';
    else if (v.status === 'expired' || (filled(v.expires_on) && String(v.expires_on) < input.today)) why = 'expired';
    else if (Number(v.uses_left) + ownHeld(input, 'voucher_id', v.id) < 1) why = 'used-up';
    else if (filled(v.holder_key) && (input.customer === null || input.customer.key !== v.holder_key)) why = input.origin === 'staff' && input.customer === null ? 'needs-customer' : 'unknown';
    if (why !== null && input.mode !== 'refund') refused.push({ typed: code.typed, reason: why });
    else vouchers.push({ typed: code.typed, row: v });
  }

  // Which offers stand, and why the others do not.
  var eligible = [];
  for (var o = 0; o < offers.length; o += 1) {
    var offer = offers[o];
    var typedFor = typedOffer[String(offer.id)];
    var reason = standing(input, offer, typedFor);
    if (reason === null) {
      eligible.push(offer);
      continue;
    }
    explain[String(offer.id)] = { offer: String(offer.id), applies: false, reason: reason };
    if (typedFor !== undefined) refused.push({ typed: typedFor.typed, reason: TYPED_REASON[reason] || reason });
  }
  eligible.sort(function (a, b) {
    var pa = PASS[a.kind] || 9;
    var pb = PASS[b.kind] || 9;
    return pa !== pb ? pa - pb : Number(a.id) - Number(b.id);
  });
  // A code whose offer was not handed in (it is not on any more): the code does not stand, and says so.
  for (var known in typedOffer) {
    var handed = false;
    for (var q = 0; q < offers.length; q += 1) if (String(offers[q].id) === known) handed = true;
    if (!handed && input.mode !== 'refund') refused.push({ typed: typedOffer[known].typed, reason: 'inactive' });
  }

  /** One way of taking the reductions: the offers given, on the lines as they stand at the start. */
  function run(chosen) {
    var left = {};
    for (var i = 0; i < goods.length; i += 1) left[goods[i]] = start[goods[i]];
    var out = { left: left, applied: [], uses: [], refused: [], explain: {}, total: 0n };
    function goodsNow() {
      var sum = 0n;
      for (var i = 0; i < goods.length; i += 1) sum += left[goods[i]];
      return sum;
    }
    function take(lineKey, amount, source) {
      if (amount <= 0n) return 0n;
      var taken = min(amount, left[lineKey]);
      if (taken <= 0n) return 0n;
      left[lineKey] -= taken;
      out.total += taken;
      for (var i = 0; i < out.applied.length; i += 1) {
        var entry = out.applied[i];
        if (entry.line === lineKey && entry.source === source.id) {
          entry.amount += taken;
          return taken;
        }
      }
      out.applied.push({ line: lineKey, source: source.id, offer: source.offer || null, code: source.code || null, voucher: source.voucher || null, name: source.name, kind: source.kind, amount: taken, typed: source.typed === true, reason: source.reason });
      return taken;
    }
    function spread(total, lines, source) {
      var shares = split(total, lines, left);
      var taken = 0n;
      for (var i = 0; i < lines.length; i += 1) taken += take(lines[i], shares[lines[i]] || 0n, source);
      return taken;
    }
    /** The lines with something left that sell what is named; every goods line when nothing is. */
    function touched(as, table, row) {
      var lines = [];
      for (var i = 0; i < goods.length; i += 1) {
        if (left[goods[i]] <= 0n) continue;
        if (!filled(as) || sells(byKey[goods[i]], as, table, row)) lines.push(goods[i]);
      }
      return lines;
    }
    /** The units of some lines, dearest first, each with what it still costs: a stay's nights, or a line's quantity. */
    function unitsOf(lines) {
      var all = [];
      for (var i = 0; i < lines.length; i += 1) {
        var line = byKey[lines[i]];
        if (line.nights && line.nights.length > 0) {
          for (var n = 0; n < line.nights.length; n += 1) all.push({ line: line.key, price: units(line.nights[n].price, scale), at: all.length });
          continue;
        }
        var count = Number(line.quantity);
        if (!(count >= 1) || count !== Math.floor(count)) count = 1;
        for (var q = 0; q < count; q += 1) all.push({ line: line.key, price: left[line.key] / BigInt(count), at: all.length });
      }
      all.sort(function (a, b) {
        return a.price === b.price ? a.at - b.at : a.price > b.price ? -1 : 1;
      });
      return all;
    }

    // 1. A voucher for a thing, or a pack, in the order typed.
    for (var i = 0; i < vouchers.length; i += 1) {
      var voucher = vouchers[i].row;
      if (voucher.worth !== 'thing' && voucher.worth !== 'pack') continue;
      var matching = touched('item', voucher.what_table, voucher.what_row);
      if (matching.length === 0) {
        out.refused.push({ typed: vouchers[i].typed, reason: 'not-for-these-items' });
        continue;
      }
      var every = unitsOf(matching);
      var covers = voucher.worth === 'pack' ? Math.min(every.length, Number(voucher.uses_left) + ownHeld(input, 'voucher_id', voucher.id)) : Math.min(every.length, Number(voucher.units) || 1);
      var source = { id: 'v' + String(voucher.id), voucher: String(voucher.id), name: (voucher.worth === 'pack' ? 'Pack · ' : 'Voucher · ') + oneName(nameOf(voucher, 'voucher')), kind: voucher.worth === 'pack' ? 'pack' : 'voucher', typed: true };
      var got = 0n;
      for (var u = 0; u < covers; u += 1) got += take(every[u].line, every[u].price, source);
      if (got > 0n) out.uses.push({ offer: null, code: null, voucher: String(voucher.id), amount: got, units: covers });
    }

    // 2. The offers, each on what is left.
    for (var j = 0; j < chosen.length; j += 1) {
      var offer = chosen[j];
      var typedFor = typedOffer[String(offer.id)];
      var lines = offer.scope === 'lines' ? touched(offer.target_as, offer.target_table, offer.target_row) : touched(null);
      if (filled(offer.min_spend) && goodsNow() < units(offer.min_spend, scale)) {
        out.explain[String(offer.id)] = { offer: String(offer.id), applies: false, reason: 'needs-minimum' };
        if (typedFor !== undefined) out.refused.push({ typed: typedFor.typed, reason: 'needs-minimum', params: { amount: decimal(units(offer.min_spend, scale), scale) } });
        continue;
      }
      var from = { id: 'o' + String(offer.id), offer: String(offer.id), code: typedFor === undefined ? null : String(typedFor.row.id), name: nameOf(offer, 'offer'), kind: typedFor === undefined ? 'offer' : 'code', typed: typedFor !== undefined };
      var gave = 0n;
      if (lines.length === 0) {
        gave = 0n;
      } else if (offer.kind === 'bonus_item') {
        var size = Number(offer.buy_qty) || 2;
        var all = unitsOf(lines);
        for (var g = size - 1; g < all.length; g += size) gave += take(all[g].line, all[g].price, from);
      } else if (offer.kind === 'percent') {
        if (offer.scope === 'lines') {
          for (var p = 0; p < lines.length; p += 1) gave += take(lines[p], percentOf(left[lines[p]], offer.value), from);
        } else {
          var base = 0n;
          for (var b = 0; b < lines.length; b += 1) base += left[lines[b]];
          gave = spread(percentOf(base, offer.value), lines, from);
        }
      } else if (offer.kind === 'amount') {
        var sum = 0n;
        for (var s = 0; s < lines.length; s += 1) sum += left[lines[s]];
        gave = spread(min(units(offer.value, scale), sum), lines, from);
      }
      if (gave > 0n) {
        out.uses.push({ offer: String(offer.id), code: from.code, voucher: null, amount: gave });
        out.explain[String(offer.id)] = { offer: String(offer.id), applies: true, amount: decimal(gave, scale) };
      } else {
        out.explain[String(offer.id)] = { offer: String(offer.id), applies: false, reason: 'not-for-these-items' };
        if (typedFor !== undefined) out.refused.push({ typed: typedFor.typed, reason: 'not-for-these-items' });
      }
    }

    // 3. A voucher worth an amount, on the whole order.
    for (var k = 0; k < vouchers.length; k += 1) {
      var worth = vouchers[k].row;
      if (worth.worth !== 'amount') continue;
      var over = touched(null);
      var total = 0n;
      for (var t = 0; t < over.length; t += 1) total += left[over[t]];
      var paid = spread(min(units(worth.value, scale), total), over, { id: 'v' + String(worth.id), voucher: String(worth.id), name: 'Voucher · ' + oneName(nameOf(worth, 'voucher')), kind: 'voucher', typed: true });
      if (paid > 0n) out.uses.push({ offer: null, code: null, voucher: String(worth.id), amount: paid, units: 1 });
    }

    // 4. What staff took off by hand.
    var staff = input.staff;
    if (staff !== null) {
      var every = touched(null);
      var all = goodsNow();
      var asked = staff.kind === 'amount' ? min(units(staff.value, scale), all) : percentOf(all, staff.kind === 'comp' ? '100' : staff.value);
      var limit = null;
      if (staff.judge && staff.ceiling !== null && wrong !== 'over-ceiling-silent') {
        if (staff.kind !== 'amount' && units(staff.value, 2) > units(staff.ceiling.percent, 2)) limit = staff.ceiling.percent;
        else if (staff.ceiling.amount !== null && staff.ceiling.amount !== undefined && asked > units(staff.ceiling.amount, scale)) limit = staff.ceiling.amount;
      }
      if (limit !== null) out.refused.push({ typed: '', reason: 'over-ceiling', params: { max: String(limit) } });
      else {
        var given = spread(asked, every, { id: 'staff', name: filled(staff.reason) ? 'Staff · ' + String(staff.reason) : 'Staff', kind: 'staff', typed: false, reason: filled(staff.reason) ? String(staff.reason) : undefined });
        if (given > 0n) out.uses.push({ offer: null, code: null, voucher: null, amount: given });
      }
    }
    return out;
  }

  // Offers that do not combine are each tried alone beside the ones that do; the way that takes most off wins, the lower id on a tie.
  var combine = [];
  var alone = [];
  for (var e = 0; e < eligible.length; e += 1) (yes(eligible[e].combinable) || eligible[e].combinable === undefined || eligible[e].combinable === null ? combine : alone).push(eligible[e]);
  var best = null;
  var winner = null;
  if (alone.length === 0) best = run(combine);
  else {
    var ways = [];
    for (var w = 0; w < alone.length; w += 1) ways.push(alone[w]);
    ways.sort(function (a, b) {
      return Number(a.id) - Number(b.id);
    });
    for (var x = 0; x < ways.length; x += 1) {
      var chosen = combine.concat([ways[x]]);
      chosen.sort(function (a, b) {
        var pa = PASS[a.kind] || 9;
        var pb = PASS[b.kind] || 9;
        return pa !== pb ? pa - pb : Number(a.id) - Number(b.id);
      });
      var tried = run(chosen);
      if (best === null || tried.total > best.total) {
        best = tried;
        winner = ways[x];
      }
    }
    var without = run(combine);
    if (without.total >= best.total) {
      best = without;
      winner = null;
    }
    for (var y = 0; y < alone.length; y += 1) {
      if (alone[y] === winner) continue;
      var lost = typedOffer[String(alone[y].id)];
      explain[String(alone[y].id)] = { offer: String(alone[y].id), applies: false, reason: 'not-combinable' };
      if (lost !== undefined) told.push({ typed: lost.typed, note: 'better-offer-applied', name: winner === null ? '' : oneName(nameOf(winner, 'offer')) });
    }
  }
  for (var r = 0; r < best.refused.length; r += 1) refused.push(best.refused[r]);
  for (var id in best.explain) explain[id] = best.explain[id];

  // The answer: one reduction for every line of the question.
  var lines = [];
  var sum = 0n;
  for (var n = 0; n < input.lines.length; n += 1) {
    var key = input.lines[n].key;
    var off = start[key] === undefined ? 0n : start[key] - best.left[key];
    if (wrong === 'over-line' && n === 0) off = units(input.lines[n].amount, scale) + 1n;
    if (wrong === 'reduce-excluded' && input.lines[n].excluded) off = 1n;
    sum += off;
    lines.push({ key: key, discount: wrong === 'negative' && n === 0 ? '-1.00' : decimal(off, scale) });
  }
  if (wrong === 'missing-line') lines.pop();
  if (wrong === 'stray-line') lines.push({ key: 'p0:999999', discount: decimal(0n, scale) });
  var applied = [];
  for (var a = 0; a < best.applied.length; a += 1) {
    var entry = best.applied[a];
    var row = { line: entry.line, offer: entry.offer, code: entry.code, voucher: entry.voucher, name: entry.name, kind: entry.kind, amount: decimal(entry.amount, scale), typed: entry.typed };
    if (entry.reason !== undefined) row.reason = entry.reason;
    applied.push(row);
  }
  if (wrong === 'stray-offer' && applied.length > 0) applied[0].offer = '999999';
  if (wrong === 'applied-short' && applied.length > 0) applied.pop();
  var uses = [];
  if (input.point === 'post' || wrong === 'uses-at-line') {
    for (var z = 0; z < best.uses.length; z += 1) {
      var use = { offer: best.uses[z].offer, code: best.uses[z].code, voucher: best.uses[z].voucher, amount: decimal(best.uses[z].amount, scale) };
      if (best.uses[z].units !== undefined) use.units = best.uses[z].units;
      if (input.customer !== null) use.customer = wrong === 'stray-customer' ? 'somebody-else' : input.customer.key;
      uses.push(use);
    }
    if (wrong === 'stray-use') uses.push({ offer: '999999', code: null, voucher: null, amount: decimal(1n, scale) });
  }
  var answer = { lines: lines, order: { discount: decimal(wrong === 'wrong-sum' ? sum + 1n : sum, scale) }, applied: applied, uses: uses, refused: refused };
  if (told.length > 0) answer.told = told;
  if (wrong === 'sign-in-to-known') answer.refused = refused.concat([{ typed: input.codes.length > 0 ? input.codes[0].typed : '', reason: 'needs-sign-in' }]);
  if (input.explain) {
    answer.explain = [];
    for (var h = 0; h < offers.length; h += 1) answer.explain.push(explain[String(offers[h].id)] || { offer: String(offers[h].id), applies: false, reason: 'not-for-these-items' });
  }
  return answer;
}

/**
 * WHICH ROWS RECORD WHAT AN ORDER USED — the `uses` ledger, action `redeem`.
 *
 *   reserve  one row per use, held; the count beside its offer and its code moved up
 *   post     a use this round held is counted; one it did not hold is written, counted;
 *            one it held and the order no longer has is given back
 *   reverse  every row of the round given back, and the counts moved down again
 *
 * A use past what an offer or a code allows is refused: under the lock of the
 * row it counts on, so the last use is one order's and never two.
 */
function rows(input) {
  var wrong = input.settings.misbehave || null;
  if (wrong === 'rows-throw') throw new Error('the kit was told to throw');
  var out = { rows: [], refusals: [], notes: [] };
  var at = input.lines.length > 0 ? input.lines[0].line : '';
  var mine = (input.reads.mine || []).filter(function (row) { return row.state !== 'back'; });
  var uses = input.phase === 'reverse' ? [] : input.uses || [];
  var same = function (row, use) { return String(row.offer_id === null || row.offer_id === undefined ? '' : row.offer_id) === String(use.offer === null ? '' : use.offer) && String(row.code_id === null || row.code_id === undefined ? '' : row.code_id) === String(use.code === null ? '' : use.code) && String(row.voucher_id === null || row.voucher_id === undefined ? '' : row.voucher_id) === String(use.voucher === null ? '' : use.voucher); };
  // How far each count moves: up for a use newly written, down for a row given back.
  var moved = { offers: {}, codes: {}, vouchers: {} };
  var move = function (table, id, by) { if (id !== null && id !== undefined && id !== '') moved[table][String(id)] = (moved[table][String(id)] || 0) + by; };
  var kept = {};
  for (var u = 0; u < uses.length; u += 1) {
    var use = uses[u];
    var held = null;
    for (var m = 0; m < mine.length; m += 1) if (kept[String(mine[m].id)] !== true && same(mine[m], use)) { held = mine[m]; break; }
    if (held !== null) {
      kept[String(held.id)] = true;
      if (input.phase === 'post' && held.state === 'held') out.rows.push({ op: 'update', table: 'redemptions', line: at, key: { id: held.id }, set: { state: 'counted' } });
      continue;
    }
    out.rows.push({ op: 'insert', table: 'redemptions', line: at, values: { customer: use.customer === undefined ? null : use.customer, offer_id: use.offer === null ? null : Number(use.offer), code_id: use.code === null ? null : Number(use.code), voucher_id: use.voucher === null ? null : Number(use.voucher), state: input.phase === 'reserve' ? 'held' : 'counted', amount: use.amount, source_table: input.source.table, source_row: input.source.row } });
    move('offers', use.offer, 1);
    move('codes', use.code, 1);
    move('vouchers', use.voucher, use.units === undefined ? 1 : use.units);
  }
  // What the round holds and the order no longer has — everything, when the round is given back.
  for (var b = 0; b < mine.length; b += 1) {
    if (kept[String(mine[b].id)] === true) continue;
    out.rows.push({ op: 'update', table: 'redemptions', line: at, key: { id: mine[b].id }, set: { state: 'back' } });
    move('offers', mine[b].offer_id, -1);
    move('codes', mine[b].code_id, -1);
    move('vouchers', mine[b].voucher_id, -1);
  }
  var count = function (table, column, limit, left) {
    var read = input.reads[table] || [];
    for (var id in moved[table]) {
      if (moved[table][id] === 0) continue;
      var row = null;
      for (var r = 0; r < read.length; r += 1) if (String(read[r].id) === id) row = read[r];
      // A use of a row nobody read for this call: the count it moves would be nobody's. Said out loud, never skipped.
      if (row === null) throw new Error('a use of ' + table + ' ' + id + ', which was not read');
      // A voucher counts what is left of it; an offer and a code count what was used.
      var now = left ? Number(row[column]) - moved[table][id] : Number(row[column]) + moved[table][id];
      if (wrong !== 'uses-unlimited' && moved[table][id] > 0 && (left ? now < 0 : row[limit] !== null && row[limit] !== undefined && now > Number(row[limit]))) {
        out.refusals.push({ line: at, reason: 'used-up' });
        continue;
      }
      out.rows.push({ op: 'update', table: table, line: at, key: { id: row.id }, set: (function () { var set = {}; set[column] = now; return set; })() });
    }
  };
  count('offers', 'uses', 'max_uses', false);
  count('codes', 'uses', 'max_uses', false);
  count('vouchers', 'uses_left', null, true);
  if (out.refusals.length > 0) out.rows = [];
  return out;
}

module.exports = { adjust: adjust, rows: rows };
