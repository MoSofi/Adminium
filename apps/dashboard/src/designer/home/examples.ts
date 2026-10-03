// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The example requests on the Designer's home page: twelve, four shown at
 * a time. Each fills the prompt box with a sentence a person could have
 * written; the words are ours, and in eight languages.
 */
import {
  Bike,
  CalendarCheck,
  DoorOpen,
  Dog,
  GraduationCap,
  HandHeart,
  Package,
  Search,
  ShoppingBasket,
  Sprout,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { t } from '../../i18n/t.js';

export interface Example {
  key: string;
  icon: LucideIcon;
  label: () => string;
  text: () => string;
}

export const EXAMPLES: readonly Example[] = [
  { key: 'repair', icon: Wrench, label: () => t('designer:examples.repair.label', 'Repair shop'), text: () => t('designer:examples.repair.text', 'A repair shop: customers drop off an item, staff log the job and the parts, and the customer gets a message when it is ready to collect.') },
  { key: 'classes', icon: CalendarCheck, label: () => t('designer:examples.classes.label', 'Class sign-ups'), text: () => t('designer:examples.classes.text', 'Class sign-ups for a small studio: a weekly timetable, places per class, a waiting list and a reminder the day before.') },
  { key: 'loans', icon: Package, label: () => t('designer:examples.loans.label', 'Equipment loans'), text: () => t('designer:examples.loans.text', 'Equipment loans for a team: who has which item, when it is due back, and a reminder when it is late.') },
  { key: 'catering', icon: UtensilsCrossed, label: () => t('designer:examples.catering.label', 'Catering orders'), text: () => t('designer:examples.catering.text', 'Catering orders: customers pick a menu and a date, staff confirm, and the kitchen sees what to prepare each day.') },
  { key: 'volunteers', icon: HandHeart, label: () => t('designer:examples.volunteers.label', 'Volunteer rota'), text: () => t('designer:examples.volunteers.text', 'A volunteer rota for a community kitchen: shifts each week, who signed up for which, and a list of the shifts still open.') },
  { key: 'nursery', icon: Sprout, label: () => t('designer:examples.nursery.label', 'Plant nursery stock'), text: () => t('designer:examples.nursery.text', 'Stock for a plant nursery: plants, their sizes and prices, how many are on each bench, and what to repot this week.') },
  { key: 'grooming', icon: Dog, label: () => t('designer:examples.grooming.label', 'Dog grooming'), text: () => t('designer:examples.grooming.text', 'Dog grooming bookings: owners book a slot online for their dog, staff see the day, and each visit keeps its notes.') },
  { key: 'tutoring', icon: GraduationCap, label: () => t('designer:examples.tutoring.label', 'Tutoring sessions'), text: () => t('designer:examples.tutoring.text', 'Tutoring sessions: students, tutors and subjects, the sessions booked each week, and what was covered in each one.') },
  { key: 'bikes', icon: Bike, label: () => t('designer:examples.bikes.label', 'Bike rentals'), text: () => t('designer:examples.bikes.text', 'Bike rentals: the bikes and their condition, rentals by the hour or the day, and which bikes are out right now.') },
  { key: 'lost', icon: Search, label: () => t('designer:examples.lost.label', 'Lost and found'), text: () => t('designer:examples.lost.text', 'A lost and found desk: items handed in with where and when, and a public page where people can describe what they lost.') },
  { key: 'foodbank', icon: ShoppingBasket, label: () => t('designer:examples.foodbank.label', 'Food bank pickups'), text: () => t('designer:examples.foodbank.text', 'Food bank pickups: households register, book a pickup time, and staff mark each parcel as handed out.') },
  { key: 'rooms', icon: DoorOpen, label: () => t('designer:examples.rooms.label', 'Room bookings'), text: () => t('designer:examples.rooms.text', 'Room bookings for a shared studio: rooms, who booked which one and when, and no two bookings at the same time.') },
];

/** How many examples show at once. */
export const SHOWN = 4;

/** The examples shown for a turn of the refresh button: the next four, round and round. */
export function examplesAt(turn: number): Example[] {
  return Array.from({ length: SHOWN }, (_value, index) => EXAMPLES[(turn * SHOWN + index) % EXAMPLES.length] as Example);
}

/** How a request opens: the asking, which says nothing about the app. "Design" only where it is the verb. */
const ASKING = /^(please|can you|could you|i want|i need|i would like|i'd like|we want|we need|make|build|create|give|design(?=\s+(me|us|a|an|the)\b)|me|us)\s+/i;
/** Then the words between the asking and the thing itself: an article, "an app for", "a small". */
const FILLER = /^(a|an|the|my|our|small|simple|little|adminium|(app|application|system|tool)\s+(for|to|that|which))\s+/i;
/** Words a name cannot end on. */
const DANGLING = /\s+(a|an|the|for|of|my|our|with|and|to|in|on|at|that|where|which|who)$/i;

/** Take `pattern` off the front until it no longer matches. */
function strip(text: string, pattern: RegExp): string {
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(pattern, '');
  }
  return text;
}

/** A name for a new app, from what was asked: "Create an app for a small bike repair shop. …" → "Bike repair shop". */
export function nameFromRequest(text: string): string {
  const head = strip(strip((text.split(/[:!?\n(—–，。！？：]|\.(\s|$)| - /)[0] ?? '').trim(), ASKING), FILLER);
  let name = head
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 5)
    .join(' ')
    .replace(/[^\p{L}\p{N} &'’-]/gu, '')
    .trim();
  name = strip(name, DANGLING);
  if (name === '' || /^(app|application|system|tool)$/i.test(name) || FILLER.test(`${name} `)) return 'My app';
  // By whole characters: a name is never cut through one.
  const marks = [...name];
  return [(marks[0] ?? '').toUpperCase(), ...marks.slice(1)].join('').slice(0, 60).replace(/[\uD800-\uDBFF]$/, '');
}
