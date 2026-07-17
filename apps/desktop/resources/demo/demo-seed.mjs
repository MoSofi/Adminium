#!/usr/bin/env node
/**
 * The demo database — 11-electron.md §6 Step 2 card 4 ("Explore the demo
 * database"), task 11-T08.
 *
 * Ava Reyes runs operations at a small SaaS company (research/BRIEF.md §4). Her
 * team ships a product, staffs a support rota, and bills customers, and this
 * file is that company as a SQLite schema: nine tables sized to trigger every
 * page type in research/ia-mapping.md §3.1 that the generator can key on.
 *
 * ─── WHY A SCRIPT AND NOT A .sqlite FILE ─────────────────────────────────────
 *
 * §6: "Ships as a seed script, not a prebuilt binary — keeps the installer small
 * and the seed reviewable." A checked-in binary would also rot silently: the
 * schema below is a FIXTURE FOR THE GENERATOR, and the only way to know it still
 * earns its pages is to re-seed and re-generate. `demo-seed.test.ts` does exactly
 * that, so a classifier change that stops triggering the kanban breaks a test
 * instead of shipping a boring demo.
 *
 * ─── WHY IT TAKES A `Database` CONSTRUCTOR ───────────────────────────────────
 *
 * Importing `better-sqlite3` by bare specifier from `resources/` would make this
 * file's behaviour depend on where it sits at runtime — inside `app.asar` in a
 * packaged build, in the repo in dev, in a temp dir under test. The caller
 * already holds a working driver (the server depends on `better-sqlite3`
 * directly; so does the test), so it passes one in and this file resolves
 * nothing. The `node demo-seed.mjs <file>` CLI at the bottom is the one place
 * that imports the driver, because that is the one place that has to.
 *
 * ─── DETERMINISM IS A CONSTRAINT, NOT A PREFERENCE ───────────────────────────
 *
 * No `Math.random`, no `Date.now`. Every value derives from {@link DEMO_SEED} and
 * {@link DEMO_EPOCH_MS}, so two machines seeding two files get byte-identical
 * ROWS — which is what lets the generated page set be snapshot-tested at all.
 * Wall-clock dates would also make the demo drift: "due next Tuesday" is only
 * true the week you seed it, and a demo whose calendar is empty because the
 * fixture aged out is a bug report.
 *
 * ─── THE SCHEMA IS LOAD-BEARING; READ THIS BEFORE EDITING IT ─────────────────
 *
 * Column NAMES and DECLARED TYPES here are inputs to the classifier
 * (05-introspection-engine.md §7.1) and the §14 archetype triggers. Three traps,
 * each of which silently costs a page rather than failing loudly:
 *
 *  1. **Enum columns MUST be `VARCHAR(n)` with n ≤ 32, never `TEXT`.** The
 *     `status-workflow` rule (§7.1 row 7) gates on `maxLength <= 32`, and a
 *     SQLite `TEXT` column introspects with `maxLength: null` — which the rule
 *     reads as "unbounded" and skips. `status TEXT CHECK (status IN (…))` is
 *     therefore NOT a kanban trigger; `status VARCHAR(16) CHECK (…)` is.
 *  2. **Enums come from `CHECK (col IN ('a','b'))` and nothing else.** SQLite has
 *     no enum type, so `adapter-sqlite` synthesizes one per column-level CHECK of
 *     exactly that shape. Reformat the CHECK and the enum disappears.
 *  3. **One table earns at most ONE archetype** (04-widget-registry.md §8 H2:
 *     highest-scoring trigger wins). Every table below is shaped so its intended
 *     archetype OUTSCORES the runners-up; the per-table notes record the margin.
 *     Adding a column can flip a winner — e.g. giving `tickets` a messages-shaped
 *     child table would turn its queue into a chat page, because `tickets` is in
 *     the annex §9 conversation-container vocabulary.
 */

/* -------------------------------------------------------------------- rng */

/** The one source of variation. Changing it rewrites every row. */
export const DEMO_SEED = 20260717;

/**
 * The demo's "today" — 2026-06-01T00:00:00Z. Every date is an offset from it, so
 * the calendar/gantt/rota land in a fixed window around a fixed centre.
 */
export const DEMO_EPOCH_MS = Date.UTC(2026, 5, 1);

/**
 * mulberry32 — 32 bits of state, uniform enough for fixture data and, unlike
 * `Math.random`, reproducible. Not for anything that needs real entropy.
 */
export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, values) => values[Math.floor(rng() * values.length)];
const between = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

const DAY_MS = 86400000;

/** `2026-06-03` — the storage format for a declared `DATE` column. */
function isoDate(offsetDays) {
  return new Date(DEMO_EPOCH_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** `2026-06-03 14:30:00` — the storage format for a declared `TIMESTAMP`. */
function isoTimestamp(offsetDays, minuteOfDay = 0) {
  const at = DEMO_EPOCH_MS + offsetDays * DAY_MS + minuteOfDay * 60000;
  return new Date(at).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * An initials avatar as a self-contained `data:` URI.
 *
 * §7 IS WHY. "The desktop build must be fully functional with the network cable
 * unplugged, forever" — and `contacts.avatar_url` is not decoration here, it is
 * the signal that earns the table its `card-gallery` directory page. A plausible
 * `https://…/avatars/001.png` would therefore put SIXTY network requests on the
 * first page of the demo: sixty broken images offline, and sixty entries in the
 * offline smoke test's blocked-request log, which §7 requires to be empty. A
 * demo that only looks right online is not a demo of THIS product.
 *
 * `hsl()` rather than hex because the repo does not write raw hex colours, and
 * the hue is derived from the row so the gallery is stable and varied at once.
 */
function avatarDataUri(initials, hue) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">` +
    `<rect width="80" height="80" rx="40" fill="hsl(${String(hue)} 58% 45%)"/>` +
    `<text x="40" y="52" text-anchor="middle" font-family="sans-serif" font-size="30"` +
    ` font-weight="600" fill="hsl(0 0% 100%)">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ----------------------------------------------------------------- schema */

/**
 * The DDL. Per-table comments record which §3.1 page type the table exists to
 * trigger and what it beats — the margins are the reason the columns are what
 * they are.
 */
export const DEMO_SCHEMA_SQL = `
-- §3.1 row 11 (directory) + row 12 (org chart). people shape + self-FK
-- "manager_id" ⇒ page-directory @0.935 filled by org-chart @0.9 (which outscores
-- card-gallery @0.825 — hence no avatar column here; contacts carries that).
CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  department VARCHAR(24) NOT NULL
    CHECK (department IN ('engineering','design','support','sales','marketing')),
  presence VARCHAR(16) NOT NULL
    CHECK (presence IN ('online','away','busy','offline')),
  manager_id INTEGER REFERENCES employees(id),
  hired_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- §3.1 row 11 (directory cards) + row 15 (segment builder: plan / lifecycle /
-- country / mrr are the filterable attributes) + row 5 (mrr_amount x signed_up_at
-- is the numeric x timestamp pair the dashboard KPIs and charts bind to).
-- avatar_url ⇒ card-gallery fills the directory slot; no self-FK, so no org-chart
-- competes. lifecycle_stage classifies as status-workflow (trial/churned are
-- workflow words) but NONE of its values are kanban-shaped, so no board fires.
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  avatar_url TEXT,
  company TEXT NOT NULL,
  country VARCHAR(2) NOT NULL,
  plan VARCHAR(16) NOT NULL
    CHECK (plan IN ('free','pro','business','enterprise')),
  lifecycle_stage VARCHAR(16) NOT NULL
    CHECK (lifecycle_stage IN ('lead','trial','customer','churned')),
  mrr_amount DECIMAL(10,2) NOT NULL,
  health_score INTEGER NOT NULL,
  signed_up_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- §3.1 row 4 (record overview): the hub record. Four inbound FKs — phases,
-- tasks, allocations, and expenses-by-proxy — are what give its CRUD detail page
-- its related-record tabs. It also earns a board of its own (@0.798) off its
-- status enum, which is Project Board.dc.html and welcome.
-- updated_at is deliberate: without it, created_at + the owner FK would match the
-- append-only LOG shape, which is checked BEFORE every trigger this table wants.
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('planning','active','paused','completed')),
  owner_id INTEGER NOT NULL REFERENCES employees(id),
  budget_amount DECIMAL(12,2) NOT NULL,
  health_score INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- §3.1 row 8 (gantt). start_date/end_date pair + progress_pct + project_id ⇒
-- page-master-detail @0.8, whose detail slot takes gantt-chart @0.935 over
-- detail-key-value @0.7. Carries NO person FK and NO status enum on purpose:
-- either would let the scheduler or the board outscore the gantt.
CREATE TABLE project_phases (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  progress_pct INTEGER NOT NULL CHECK (progress_pct BETWEEN 0 AND 100),
  notes TEXT
);

-- §3.1 row 6 (kanban + swimlanes). All five status values are kanban-shaped
-- (⇒ the full name-match bonus) and workstream is the second categorical column
-- that turns the board into a swimlane grid: page-board @0.924, clear of the
-- scheduler (@0.779), calendar (@0.75), queue (@0.741) and master-detail (@0.6).
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('backlog','todo','in_progress','review','done')),
  workstream VARCHAR(16) NOT NULL
    CHECK (workstream IN ('platform','mobile','billing','growth')),
  priority VARCHAR(8) NOT NULL
    CHECK (priority IN ('low','medium','high','urgent')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  assignee_id INTEGER REFERENCES employees(id),
  progress_pct INTEGER NOT NULL CHECK (progress_pct BETWEEN 0 AND 100),
  due_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- §3.1 row 7 (calendar). "releases" is in the events-table vocabulary but NOT in
-- the audit/log vocabulary — a table named *_events would classify as a LOG and
-- take page-log-viewer @0.88 instead, which is why this table is not called that.
-- environment is the category enum (Release Calendar.dc.html's env filter) and is
-- deliberately not workflow-shaped: a status enum here would cost the events
-- shape and with it the calendar's name-match bonus. page-calendar @0.863.
CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version VARCHAR(24) NOT NULL,
  environment VARCHAR(16) NOT NULL
    CHECK (environment IN ('production','staging','canary')),
  release_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL
);

-- §3.1 row 9 (matrix scheduler). person FK x date x shift-type ⇒ page-scheduler
-- @0.902 filled by schedule-matrix, just clear of the calendar (@0.863) which
-- fires on the same date column. No created_at: with the employee FK present it
-- would put this table one verb-ish column away from the log shape.
CREATE TABLE shifts (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  shift_date DATE NOT NULL,
  shift_type VARCHAR(16) NOT NULL
    CHECK (shift_type IN ('morning','evening','night','on_call')),
  coverage_zone VARCHAR(16) NOT NULL
    CHECK (coverage_zone IN ('emea','amer','apac')),
  notes TEXT
);

-- §3.1 row 10 (ticket queue). Every status value is approval-vocabulary and NONE
-- is kanban-vocabulary — that is what makes this a queue (@0.858) and not a board
-- (which would not fire at all). Has no messages-shaped child table on purpose:
-- "tickets" is a conversation-container name, so a comments table would trigger
-- page-chat @0.95 and take the queue's place.
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('submitted','pending','escalated','approved','rejected')),
  priority VARCHAR(8) NOT NULL
    CHECK (priority IN ('low','medium','high','urgent')),
  channel VARCHAR(16) NOT NULL
    CHECK (channel IN ('email','chat','phone','portal')),
  requester_id INTEGER NOT NULL REFERENCES contacts(id),
  assignee_id INTEGER REFERENCES employees(id),
  first_response_minutes INTEGER,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- §3.1 row 13 (capacity/allocation). person + hours + project ⇒ page-scheduler
-- @0.82 filled by capacity-board. Carries no date and no enum so the shift-matrix
-- branch cannot claim it, and four non-FK columns so it is not read as a join
-- table (which would strip it of pages entirely).
CREATE TABLE allocations (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  allocated_hours DECIMAL(5,2) NOT NULL,
  billable BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL
);
`;

/* ------------------------------------------------------------------- data */

/** The persona (BRIEF §4) — employee 1, and the root of the org chart. */
export const DEMO_PERSONA = { name: 'Ava Reyes', email: 'ava@adminium.io' };

const FIRST_NAMES = [
  'Ava', 'Noor', 'Diego', 'Mei', 'Tomas', 'Priya', 'Jonas', 'Selin', 'Kwame', 'Lucia',
  'Ivan', 'Hana', 'Omar', 'Freya', 'Rafael', 'Yuki', 'Nadia', 'Piotr', 'Amara', 'Ben',
  'Sofia', 'Milan', 'Zara', 'Elias',
];
const LAST_NAMES = [
  'Reyes', 'Haddad', 'Marquez', 'Chen', 'Novak', 'Sharma', 'Lindqvist', 'Demir', 'Mensah',
  'Ferrari', 'Petrov', 'Sato', 'Aziz', 'Olsen', 'Costa', 'Tanaka', 'Rahman', 'Kowalski',
  'Okafor', 'Fischer', 'Rossi', 'Horvat', 'Malik', 'Weber',
];
const DEPARTMENTS = ['engineering', 'design', 'support', 'sales', 'marketing'];
const PRESENCE = ['online', 'away', 'busy', 'offline'];
const TITLES_BY_DEPT = {
  engineering: ['Staff Engineer', 'Backend Engineer', 'Platform Engineer', 'QA Engineer'],
  design: ['Product Designer', 'Design Lead', 'UX Researcher'],
  support: ['Support Engineer', 'Support Lead', 'Success Manager'],
  sales: ['Account Executive', 'Sales Engineer', 'SDR'],
  marketing: ['Content Lead', 'Growth Marketer', 'Brand Designer'],
};
const COMPANIES = [
  'Northwind Robotics', 'Blue Harbor Health', 'Cedar & Vine', 'Lumen Analytics', 'Fjord Logistics',
  'Atlas Fintech', 'Verdant Farms', 'Kite Studios', 'Ironwood Legal', 'Solstice Media',
  'Harbor Freight Co', 'Pinnacle Dental', 'Riverstone Ed', 'Aster Biotech', 'Copperline Travel',
];
const COUNTRIES = ['US', 'DE', 'GB', 'BR', 'JP', 'CA', 'FR', 'IN', 'AU', 'NL'];
const PLANS = ['free', 'pro', 'business', 'enterprise'];
const LIFECYCLE = ['lead', 'trial', 'customer', 'churned'];
const PROJECT_NAMES = [
  'Billing v2', 'Mobile Companion', 'Realtime Sync', 'Onboarding Revamp', 'Data Residency',
  'Partner API',
];
const PROJECT_STATUS = ['planning', 'active', 'paused', 'completed'];
const PHASE_NAMES = ['Discovery', 'Design', 'Build', 'Beta', 'Launch'];
const TASK_STATUS = ['backlog', 'todo', 'in_progress', 'review', 'done'];
const WORKSTREAMS = ['platform', 'mobile', 'billing', 'growth'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_VERBS = [
  'Ship', 'Fix', 'Refactor', 'Document', 'Instrument', 'Migrate', 'Harden', 'Polish',
  'Benchmark', 'Audit',
];
const TASK_NOUNS = [
  'the invoice exporter', 'the webhook retry loop', 'the seat picker', 'the trial banner',
  'the SSO callback', 'the usage meter', 'the CSV importer', 'the audit trail',
  'the rate limiter', 'the email digest', 'the search index', 'the session store',
];
const RELEASE_ENVS = ['production', 'staging', 'canary'];
const SHIFT_TYPES = ['morning', 'evening', 'night', 'on_call'];
const ZONES = ['emea', 'amer', 'apac'];
const TICKET_STATUS = ['submitted', 'pending', 'escalated', 'approved', 'rejected'];
const CHANNELS = ['email', 'chat', 'phone', 'portal'];
const TICKET_SUBJECTS = [
  'Cannot export invoices to CSV', 'SSO login loops on Safari', 'Seat count not updating',
  'Webhook deliveries stuck retrying', 'Request: SOC2 report', 'Billing address rejected',
  'API returns 429 unexpectedly', 'Trial extension request', 'Duplicate charge on renewal',
  'Data residency question', 'Slack integration disconnected', 'Password reset never arrives',
];

/**
 * Every row of the demo, as plain arrays. Pure: same seed ⇒ same rows, so the
 * snapshot test can assert the page set without touching a database twice.
 */
export function buildDemoRows() {
  const rng = createRng(DEMO_SEED);

  // -- employees: Ava at the root, 4 leads under her, everyone else under a lead.
  const employees = [];
  const headcount = 24;
  for (let i = 1; i <= headcount; i += 1) {
    const isPersona = i === 1;
    const department = isPersona ? 'support' : DEPARTMENTS[(i - 2) % DEPARTMENTS.length];
    const first = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const last = LAST_NAMES[(i - 1) % LAST_NAMES.length];
    const fullName = isPersona ? DEMO_PERSONA.name : `${first} ${last}`;
    const email = isPersona
      ? DEMO_PERSONA.email
      : `${first.toLowerCase()}.${last.toLowerCase()}${i}@adminium.io`;
    // 1 → root; 2..5 → the leads, reporting to Ava; 6+ → their department's lead.
    const managerId = isPersona ? null : i <= 5 ? 1 : 2 + ((i - 2) % 4);
    employees.push({
      id: i,
      full_name: fullName,
      job_title: isPersona ? 'Head of Operations' : pick(rng, TITLES_BY_DEPT[department]),
      email,
      department,
      presence: isPersona ? 'online' : pick(rng, PRESENCE),
      manager_id: managerId,
      hired_on: isoDate(-between(rng, 120, 1400)),
      created_at: isoTimestamp(-between(rng, 120, 1400), between(rng, 0, 1439)),
      updated_at: isoTimestamp(-between(rng, 1, 60), between(rng, 0, 1439)),
    });
  }

  // -- contacts: the customer base the dashboard aggregates.
  const contacts = [];
  for (let i = 1; i <= 60; i += 1) {
    const first = FIRST_NAMES[(i * 7) % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 5) % LAST_NAMES.length];
    const lifecycle = pick(rng, LIFECYCLE);
    const plan = pick(rng, PLANS);
    const signedUpDay = -between(rng, 10, 900);
    contacts.push({
      id: i,
      full_name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      avatar_url: avatarDataUri(`${first[0] ?? ''}${last[0] ?? ''}`, (i * 47) % 360),
      company: COMPANIES[(i - 1) % COMPANIES.length],
      country: pick(rng, COUNTRIES),
      plan,
      lifecycle_stage: lifecycle,
      // Churned and lead accounts pay nothing — the donut/KPI split reads as real.
      mrr_amount:
        lifecycle === 'churned' || lifecycle === 'lead'
          ? 0
          : Number((between(rng, 2900, 480000) / 100).toFixed(2)),
      health_score: between(rng, 12, 99),
      signed_up_at: isoTimestamp(signedUpDay, between(rng, 0, 1439)),
      created_at: isoTimestamp(signedUpDay, between(rng, 0, 1439)),
      updated_at: isoTimestamp(-between(rng, 1, 30), between(rng, 0, 1439)),
    });
  }

  // -- projects: the hub records.
  const projects = PROJECT_NAMES.map((name, index) => ({
    id: index + 1,
    name,
    description: `${name} — tracked by the ${pick(rng, WORKSTREAMS)} workstream.`,
    status: PROJECT_STATUS[index % PROJECT_STATUS.length],
    owner_id: 2 + (index % 4),
    budget_amount: Number((between(rng, 1500000, 22000000) / 100).toFixed(2)),
    health_score: between(rng, 40, 98),
    created_at: isoTimestamp(-between(rng, 200, 700), between(rng, 0, 1439)),
    updated_at: isoTimestamp(-between(rng, 1, 40), between(rng, 0, 1439)),
  }));

  // -- phases: contiguous, non-overlapping bars per project (the gantt).
  const projectPhases = [];
  let phaseId = 1;
  for (const project of projects) {
    let cursor = -between(rng, 90, 160);
    for (const phaseName of PHASE_NAMES) {
      const length = between(rng, 9, 28);
      projectPhases.push({
        id: phaseId,
        name: `${project.name} — ${phaseName}`,
        project_id: project.id,
        start_date: isoDate(cursor),
        end_date: isoDate(cursor + length),
        // Phases already in the past read as finished; the current one is partial.
        progress_pct: cursor + length < 0 ? 100 : cursor < 0 ? between(rng, 15, 85) : 0,
        notes: `${phaseName} phase for ${project.name}.`,
      });
      phaseId += 1;
      cursor += length + between(rng, 0, 3);
    }
  }

  // -- tasks: the swimlane board.
  const tasks = [];
  for (let i = 1; i <= 120; i += 1) {
    const status = pick(rng, TASK_STATUS);
    const createdDay = -between(rng, 5, 120);
    tasks.push({
      id: i,
      title: `${pick(rng, TASK_VERBS)} ${pick(rng, TASK_NOUNS)}`,
      description: 'Captured from the weekly ops review.',
      status,
      workstream: pick(rng, WORKSTREAMS),
      priority: pick(rng, PRIORITIES),
      project_id: between(rng, 1, projects.length),
      assignee_id: between(rng, 1, headcount),
      progress_pct: status === 'done' ? 100 : status === 'backlog' ? 0 : between(rng, 5, 90),
      due_at: isoTimestamp(between(rng, -20, 45), between(rng, 480, 1080)),
      created_at: isoTimestamp(createdDay, between(rng, 0, 1439)),
      updated_at: isoTimestamp(createdDay + between(rng, 0, 5), between(rng, 0, 1439)),
    });
  }

  // -- releases: the calendar, spread either side of the epoch.
  const releases = [];
  for (let i = 1; i <= 18; i += 1) {
    const day = -60 + i * 5 + between(rng, 0, 2);
    releases.push({
      id: i,
      name: `Release ${String(i).padStart(2, '0')}`,
      version: `2.${Math.floor(i / 4)}.${i % 4}`,
      environment: pick(rng, RELEASE_ENVS),
      release_date: isoDate(day),
      notes: 'Rollout window: 30 minutes, canary first.',
      created_at: isoTimestamp(day - between(rng, 2, 10), between(rng, 0, 1439)),
    });
  }

  // -- shifts: 5 weeks of rota for the support team (the matrix scheduler).
  const shifts = [];
  let shiftId = 1;
  const rotaTeam = employees.filter((e) => e.department === 'support').map((e) => e.id);
  for (let day = -14; day < 21; day += 1) {
    for (const employeeId of rotaTeam) {
      // Not everyone works every day — gaps are what the coverage bars measure.
      if (rng() < 0.25) continue;
      shifts.push({
        id: shiftId,
        employee_id: employeeId,
        shift_date: isoDate(day),
        shift_type: pick(rng, SHIFT_TYPES),
        coverage_zone: pick(rng, ZONES),
        notes: null,
      });
      shiftId += 1;
    }
  }

  // -- tickets: the approval-style queue.
  const tickets = [];
  for (let i = 1; i <= 80; i += 1) {
    const status = pick(rng, TICKET_STATUS);
    const createdDay = -between(rng, 1, 60);
    const settled = status === 'approved' || status === 'rejected';
    tickets.push({
      id: i,
      subject: TICKET_SUBJECTS[(i - 1) % TICKET_SUBJECTS.length],
      description: 'Reported by the customer via the support portal.',
      status,
      priority: pick(rng, PRIORITIES),
      channel: pick(rng, CHANNELS),
      requester_id: between(rng, 1, contacts.length),
      assignee_id: rotaTeam[between(rng, 0, rotaTeam.length - 1)] ?? 1,
      first_response_minutes: between(rng, 3, 720),
      resolved_at: settled ? isoTimestamp(createdDay + between(rng, 1, 9), between(rng, 0, 1439)) : null,
      created_at: isoTimestamp(createdDay, between(rng, 0, 1439)),
      updated_at: isoTimestamp(createdDay + between(rng, 0, 9), between(rng, 0, 1439)),
    });
  }

  // -- allocations: hours per person per project (the capacity board).
  const allocations = [];
  let allocationId = 1;
  for (const employee of employees) {
    const projectCount = between(rng, 1, 3);
    for (let n = 0; n < projectCount; n += 1) {
      allocations.push({
        id: allocationId,
        employee_id: employee.id,
        project_id: 1 + ((employee.id + n) % projects.length),
        allocated_hours: Number((between(rng, 400, 3200) / 100).toFixed(2)),
        billable: employee.department === 'sales' || employee.department === 'marketing' ? 0 : 1,
        created_at: isoTimestamp(-between(rng, 10, 90), between(rng, 0, 1439)),
      });
      allocationId += 1;
    }
  }

  return { employees, contacts, projects, project_phases: projectPhases, tasks, releases, shifts, tickets, allocations };
}

/* ------------------------------------------------------------------- seed */

/**
 * §9's durability settings. `journal_mode = WAL` persists in the file; the other
 * three are per-connection and are re-applied by `adapter-sqlite` when the server
 * opens the database for real. They are set here anyway because this script also
 * runs standalone, and a seed that crashed halfway through a non-WAL write is
 * exactly the corruption §9 exists to prevent.
 */
function applyDemoPragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

const INSERT_ORDER = [
  'employees',
  'contacts',
  'projects',
  'project_phases',
  'tasks',
  'releases',
  'shifts',
  'tickets',
  'allocations',
];

/**
 * Seed an OPEN better-sqlite3 handle. The caller owns the handle's lifetime —
 * this function neither opens nor closes it, so the server can seed inside its
 * own connection bookkeeping and the test can seed a temp file.
 *
 * Everything runs in ONE transaction: a demo database that half-exists is worse
 * than one that does not exist, because the first is registered as a connection
 * and generates a broken page set.
 */
export function seedDemoDatabase(db) {
  applyDemoPragmas(db);
  db.exec(DEMO_SCHEMA_SQL);

  const rows = buildDemoRows();
  const insertAll = db.transaction(() => {
    for (const table of INSERT_ORDER) {
      const list = rows[table];
      if (list.length === 0) continue;
      const columns = Object.keys(list[0]);
      const statement = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      );
      for (const row of list) statement.run(columns.map((column) => row[column]));
    }
  });
  insertAll();

  // §9: leave the file self-contained at rest rather than trailing a -wal the
  // caller would have to know to checkpoint.
  db.pragma('wal_checkpoint(TRUNCATE)');
  return Object.fromEntries(INSERT_ORDER.map((table) => [table, rows[table].length]));
}

/**
 * Create `file` and seed it. `Database` is better-sqlite3's constructor, injected
 * — see the module header for why this file will not import it itself.
 */
export function createDemoDatabase({ file, Database }) {
  const db = new Database(file);
  try {
    return seedDemoDatabase(db);
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------- cli */

// `node demo-seed.mjs <file>` — the standalone path (regenerating a fixture by
// hand, eyeballing the schema). The only place the driver is imported.
if (process.argv[1] !== undefined) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const file = process.argv[2];
    if (file === undefined) {
      process.stderr.write('usage: node demo-seed.mjs <path-to-demo.sqlite>\n');
      process.exit(2);
    }
    const { default: Database } = await import('better-sqlite3');
    const counts = createDemoDatabase({ file, Database });
    process.stdout.write(`seeded ${file}\n${JSON.stringify(counts, null, 2)}\n`);
  }
}
