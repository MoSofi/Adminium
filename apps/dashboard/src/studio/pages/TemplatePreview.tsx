/**
 * Schematic preview of a page template — what the page will LOOK like.
 *
 * A name and a sentence still leave the reader guessing at shape: "List &
 * detail" and "Queue" are both lists with something beside them until you see
 * that one is a reading layout and the other is a work queue with actions on
 * every row. The schematic answers that in one glance, before any table is
 * bound and before any data exists.
 *
 * Deliberately abstract — grey blocks, not fake rows of plausible customer
 * names. A preview that looks like real data invites the reader to check the
 * data, and there is none to check yet; a wireframe reads as "this is the
 * arrangement", which is the only claim being made. It is also why this is
 * static markup rather than a live mount of the real template: rendering
 * `PageCrud` here would need a bound table, a query, and a connection, none of
 * which exist while the admin is still deciding what to build.
 *
 * Everything is token-coloured, so it follows light/dark with the rest of the
 * app, and it is pure divs — no per-cell icons — so a 14-way switch costs
 * almost nothing in the entry chunk.
 */

import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

/** A filled block. `tone` picks how much it stands out from the surface. */
function Block({
  className,
  tone = 'muted',
}: {
  className?: string;
  tone?: 'muted' | 'strong' | 'accent';
}) {
  return (
    <div
      className={cn(
        'rounded-sm',
        tone === 'accent' ? 'bg-accent/35' : tone === 'strong' ? 'bg-fg/20' : 'bg-fg/10',
        className,
      )}
    />
  );
}

/** A bordered pane — the outline of a real region (card, column, panel). */
function Pane({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface p-2', className)}>{children}</div>
  );
}

/** The chrome every schematic shares: a toolbar strip above the body. */
function Toolbar() {
  return (
    <div className="flex items-center gap-1.5">
      <Block className="h-2.5 w-16" tone="strong" />
      <Block className="h-2.5 w-10" />
      <div className="flex-1" />
      <Block className="h-2.5 w-12" tone="accent" />
    </div>
  );
}

function rows(count: number, render: (index: number) => ReactNode): ReactNode[] {
  return Array.from({ length: count }, (_, index) => render(index));
}

function TableSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="flex flex-col gap-1.5">
        <div className="flex gap-2 border-b border-border pb-1.5">
          {rows(4, (i) => (
            <Block key={i} className="h-2 flex-1" tone="strong" />
          ))}
        </div>
        {rows(6, (i) => (
          <div key={i} className="flex gap-2">
            {rows(4, (c) => (
              <Block key={c} className="h-2 flex-1" />
            ))}
          </div>
        ))}
      </Pane>
    </div>
  );
}

function DashboardSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-4 gap-2">
        {rows(4, (i) => (
          <Pane key={i} className="flex flex-col gap-1">
            <Block className="h-1.5 w-8" />
            <Block className="h-3 w-12" tone="strong" />
          </Pane>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Pane className="col-span-2 flex h-24 items-end gap-1.5">
          {/* Fixed height classes, not a `style` prop: `adminium/no-style-prop`
              bans inline styles app-wide, and a schematic has no reason to be
              the exception — the bar heights are decoration, not data. */}
          {['h-[35%]', 'h-[60%]', 'h-[28%]', 'h-[80%]', 'h-[50%]', 'h-[92%]', 'h-[42%]'].map(
            (height, i) => (
              <Block key={i} className={cn('flex-1', height)} tone="accent" />
            ),
          )}
        </Pane>
        <Pane className="flex h-24 items-center justify-center">
          <div className="size-14 rounded-full border-[6px] border-accent/35 border-t-fg/20" />
        </Pane>
      </div>
    </div>
  );
}

function BoardSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-3 gap-2">
        {[3, 2, 4].map((cards, column) => (
          <Pane key={column} className="flex flex-col gap-1.5">
            <Block className="h-2 w-12" tone="strong" />
            {rows(cards, (i) => (
              <div key={i} className="rounded-sm border border-border bg-surface-2 p-1.5">
                <Block className="mb-1 h-1.5 w-full" />
                <Block className="h-1.5 w-8" tone="accent" />
              </div>
            ))}
          </Pane>
        ))}
      </div>
    </div>
  );
}

function CalendarSchematic() {
  const filled = new Set([3, 4, 9, 11, 12, 17, 20, 23, 24, 30]);
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="grid grid-cols-7 gap-1">
        {rows(7, (i) => (
          <Block key={`h${i}`} className="h-1.5" tone="strong" />
        ))}
        {rows(28, (i) => (
          <div key={i} className="flex h-6 flex-col justify-end rounded-sm bg-surface-2 p-0.5">
            {filled.has(i) ? <Block className="h-1.5 w-full" tone="accent" /> : null}
          </div>
        ))}
      </Pane>
    </div>
  );
}

function SchedulerSchematic() {
  const bars = [
    [1, 3],
    [0, 2],
    [3, 5],
    [2, 4],
  ];
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="flex flex-col gap-1.5">
        <div className="flex gap-1 ps-16">
          {rows(6, (i) => (
            <Block key={i} className="h-1.5 flex-1" tone="strong" />
          ))}
        </div>
        {bars.map(([start, span], row) => (
          <div key={row} className="flex items-center gap-1">
            <Block className="h-2 w-14 shrink-0" />
            <div className="flex flex-1 gap-1">
              {rows(6, (cell) => (
                <div key={cell} className="h-4 flex-1 rounded-sm bg-surface-2">
                  {cell >= (start ?? 0) && cell < (start ?? 0) + (span ?? 0) ? (
                    <Block className="h-full w-full" tone="accent" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Pane>
    </div>
  );
}

function DirectorySchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="flex flex-col items-center gap-2 py-2">
        <div className="flex w-20 flex-col items-center gap-1 rounded-sm border border-accent/40 bg-surface-2 p-1.5">
          <div className="size-4 rounded-full bg-accent/35" />
          <Block className="h-1.5 w-12" />
        </div>
        <div className="h-2 w-px bg-border" />
        <div className="flex gap-2">
          {rows(3, (i) => (
            <div
              key={i}
              className="flex w-16 flex-col items-center gap-1 rounded-sm border border-border bg-surface-2 p-1.5"
            >
              <div className="size-3.5 rounded-full bg-fg/20" />
              <Block className="h-1.5 w-10" />
            </div>
          ))}
        </div>
      </Pane>
    </div>
  );
}

function MasterDetailSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-3 gap-2">
        <Pane className="flex flex-col gap-1.5">
          {rows(6, (i) => (
            <div
              key={i}
              className={cn('rounded-sm p-1', i === 1 ? 'bg-accent/20' : 'bg-surface-2')}
            >
              <Block className="h-1.5 w-full" tone={i === 1 ? 'accent' : 'muted'} />
            </div>
          ))}
        </Pane>
        <Pane className="col-span-2 flex flex-col gap-2">
          <Block className="h-2.5 w-24" tone="strong" />
          <div className="grid grid-cols-2 gap-2">
            {rows(6, (i) => (
              <div key={i} className="flex flex-col gap-1">
                <Block className="h-1.5 w-10" />
                <Block className="h-2 w-full" tone="strong" />
              </div>
            ))}
          </div>
        </Pane>
      </div>
    </div>
  );
}

function QueueSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-4 gap-2">
        {rows(4, (i) => (
          <Pane key={i} className="flex flex-col gap-1">
            <Block className="h-1.5 w-8" />
            <Block className="h-2.5 w-10" tone="strong" />
          </Pane>
        ))}
      </div>
      <Pane className="flex flex-col gap-1.5">
        {rows(4, (i) => (
          <div key={i} className="flex items-center gap-2 rounded-sm bg-surface-2 p-1.5">
            <Block className="h-2 flex-1" />
            <Block className="h-2 w-8" tone="accent" />
            <Block className="h-2 w-8" tone="strong" />
          </div>
        ))}
      </Pane>
    </div>
  );
}

function LogSchematic() {
  const widths = ['w-[85%]', 'w-[60%]', 'w-[92%]', 'w-[45%]', 'w-[78%]', 'w-[66%]', 'w-[88%]'];
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="flex flex-col gap-1">
        {widths.map((w, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Block className="h-1.5 w-6" tone={i % 3 === 0 ? 'accent' : 'muted'} />
            <Block className={cn('h-1.5', w)} />
          </div>
        ))}
      </Pane>
    </div>
  );
}

function FilesSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-4 gap-2">
        {rows(8, (i) => (
          <Pane key={i} className="flex flex-col items-center gap-1 py-2">
            <div className={cn('h-6 w-8 rounded-sm', i < 3 ? 'bg-accent/30' : 'bg-fg/15')} />
            <Block className="h-1.5 w-10" />
          </Pane>
        ))}
      </div>
    </div>
  );
}

function ChatSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-3 gap-2">
        <Pane className="flex flex-col gap-1.5">
          {rows(5, (i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="size-3 shrink-0 rounded-full bg-fg/20" />
              <Block className="h-1.5 flex-1" />
            </div>
          ))}
        </Pane>
        <Pane className="col-span-2 flex flex-col gap-2">
          {[false, true, false, true].map((mine, i) => (
            <div key={i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <Block
                className={cn('h-5', i % 2 === 0 ? 'w-2/3' : 'w-1/2')}
                tone={mine ? 'accent' : 'muted'}
              />
            </div>
          ))}
        </Pane>
      </div>
    </div>
  );
}

function BuilderSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <div className="grid grid-cols-4 gap-2">
        <Pane className="flex flex-col gap-1.5">
          {rows(5, (i) => (
            <Block key={i} className="h-3 w-full" />
          ))}
        </Pane>
        <Pane className="col-span-3 flex flex-col gap-2 border-dashed">
          <Block className="h-3 w-20" tone="strong" />
          <Block className="h-8 w-full" tone="accent" />
          <Block className="h-3 w-2/3" />
          <Block className="h-3 w-1/2" />
        </Pane>
      </div>
    </div>
  );
}

function WizardSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {rows(4, (i) => (
          <div key={i} className="flex flex-1 items-center gap-1.5">
            <div
              className={cn('size-3 rounded-full', i <= 1 ? 'bg-accent/50' : 'bg-fg/15')}
            />
            <Block className="h-1 flex-1" tone={i === 0 ? 'accent' : 'muted'} />
          </div>
        ))}
      </div>
      <Pane className="flex flex-col gap-2 py-3">
        <Block className="h-2.5 w-28" tone="strong" />
        {rows(3, (i) => (
          <div key={i} className="flex flex-col gap-1">
            <Block className="h-1.5 w-14" />
            <Block className="h-4 w-full" />
          </div>
        ))}
        <div className="flex justify-end gap-1.5">
          <Block className="h-3 w-12" />
          <Block className="h-3 w-14" tone="accent" />
        </div>
      </Pane>
    </div>
  );
}

function SettingsSchematic() {
  return (
    <div className="flex flex-col gap-2">
      <Toolbar />
      <Pane className="flex flex-col gap-2">
        {rows(2, (section) => (
          <div key={section} className="flex flex-col gap-1.5">
            <Block className="h-2 w-16" tone="strong" />
            {rows(2, (i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Block className="h-1.5 w-24" />
                  <Block className="h-1 w-32" />
                </div>
                <div className="h-3 w-6 rounded-full bg-accent/35" />
              </div>
            ))}
          </div>
        ))}
      </Pane>
    </div>
  );
}

const SCHEMATICS: Record<string, () => ReactNode> = {
  'page-crud': TableSchematic,
  'page-dashboard': DashboardSchematic,
  'page-board': BoardSchematic,
  'page-calendar': CalendarSchematic,
  'page-scheduler': SchedulerSchematic,
  'page-directory': DirectorySchematic,
  'page-master-detail': MasterDetailSchematic,
  'page-queue-inbox': QueueSchematic,
  'page-log-viewer': LogSchematic,
  'page-files': FilesSchematic,
  'page-chat': ChatSchematic,
  'page-builder': BuilderSchematic,
  'page-wizard': WizardSchematic,
  'page-settings': SettingsSchematic,
};

/** True when a schematic exists — the picker only offers ids that have one. */
export function hasSchematic(template: string): boolean {
  return Object.hasOwn(SCHEMATICS, template);
}

export function TemplateSchematic({ template }: { template: string }) {
  const Schematic = SCHEMATICS[template] ?? TableSchematic;
  return (
    <div aria-hidden className="select-none">
      <Schematic />
    </div>
  );
}
