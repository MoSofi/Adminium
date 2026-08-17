// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Empty-states gallery — the exemplar port of Empty States.dc.html
 * (M1-T05). All six designed states compose the `EmptyState` component (and
 * its presets) and demonstrate the anatomy rule verbatim: every empty view
 * shares "an icon, a headline, a line of guidance, and a primary action".
 * Calm states (no results, all caught up) get outline CTAs per the comp; only
 * urgent states earn a filled primary (accent) or destructive (danger) button.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckCheck, CloudOff, Lock, Plus, RefreshCw, Sparkles, UploadCloud } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../components/button/index.js';
import { Card } from '../components/card/index.js';
import { EmptyState } from '../components/empty-state/index.js';
import { cn } from '../lib/cn.js';
import type { Tone } from '../lib/tones.js';

/** Tone → header-dot utility (soft/strong pairs come from the tone system). */
const toneDotClasses: Record<Tone, string> = {
  neutral: 'bg-fg-muted',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Comp's specimen frame: tag header on surface-2 + centered empty state. */
function StateCard({ tag, tone, children }: { tag: string; tone: Tone; children: ReactNode }) {
  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-3">
        <span aria-hidden="true" className={cn('size-2 rounded-full', toneDotClasses[tone])} />
        <span className="text-caption font-bold text-fg-muted">{tag}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-7 py-4">{children}</div>
    </Card>
  );
}

function EmptyStatesPage() {
  return (
    <div className="mx-auto max-w-[1120px] text-fg">
      <header className="mb-6">
        <h1 className="text-title">Empty states</h1>
        <p className="mt-2 max-w-[60ch] text-body text-fg-muted">
          Every empty view shares one anatomy: an icon, a headline, a line of guidance, and a
          primary action. Reuse these across the product — calm states get outline CTAs.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1 — First run: the empty state doubles as onboarding. Filled accent CTA. */}
        <StateCard tag="First run · no data yet" tone="accent">
          <EmptyState
            icon={<Sparkles />}
            tone="accent"
            title="Build your first dashboard"
            body="Connect a data source and Adminium will generate charts and tables automatically."
            actions={
              <>
                <Button iconLeft={<Plus />}>Connect a database</Button>
                <Button variant="secondary">Watch demo</Button>
              </>
            }
          />
        </StateCard>

        {/* 2 — No results: calm state → outline CTA; the query is echoed back. */}
        <StateCard tag="Search · no results" tone="neutral">
          <EmptyState
            preset="no-matches"
            title="No results found"
            body={
              <>
                We couldn’t find anything matching <span className="font-bold text-fg">“coastal xyz”</span>.
                Try a different term or clear your filters.
              </>
            }
            actions={<Button variant="outline">Clear filters</Button>}
          />
        </StateCard>

        {/* 3 — Upload drop zone: the anatomy inside a dashed, hover-tinted target. */}
        <StateCard tag="Upload · drop zone" tone="accent">
          <div
            role="button"
            tabIndex={0}
            className={cn(
              'w-full cursor-pointer rounded-lg border-[1.5px] border-dashed border-border-strong',
              'transition-colors duration-150 hover:border-accent hover:bg-accent-soft',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <EmptyState
              compact
              icon={<UploadCloud />}
              tone="accent"
              title="Drop files to upload"
              body="Drag and drop here, or click to browse. PDF, PNG, CSV up to 50MB."
            >
              <div className="mt-3 text-caption font-bold text-accent">or browse files</div>
            </EmptyState>
          </div>
        </StateCard>

        {/* 4 — All caught up: calm success → outline CTA. */}
        <StateCard tag="Success · all caught up" tone="pos">
          <EmptyState
            preset="all-caught-up"
            icon={<CheckCheck />}
            title="You’re all caught up"
            body="No pending tasks or notifications. Enjoy the quiet — we’ll let you know when something needs you."
            actions={<Button variant="outline">View archive</Button>}
          />
        </StateCard>

        {/* 5 — Failed to load: danger tone, destructive retry + secondary escape. */}
        <StateCard tag="Error · failed to load" tone="danger">
          <EmptyState
            icon={<CloudOff />}
            tone="danger"
            title="Couldn’t load this view"
            body="Something went wrong fetching your data. Check your connection and try again."
            actions={
              <>
                <Button variant="destructive" iconLeft={<RefreshCw />}>
                  Retry
                </Button>
                <Button variant="secondary">Report issue</Button>
              </>
            }
          />
        </StateCard>

        {/* 6 — No permission: warn tone, filled primary to request access. */}
        <StateCard tag="Access · no permission" tone="warn">
          <EmptyState
            icon={<Lock />}
            tone="warn"
            title="You don’t have access"
            body="This workspace is restricted. Ask an admin to grant you access to continue."
            actions={
              <>
                <Button>Request access</Button>
                <Button variant="secondary">Go back</Button>
              </>
            }
          />
        </StateCard>
      </div>
    </div>
  );
}

const meta = {
  title: 'DesignSystem/Empty States',
  parameters: { layout: 'padded', a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = { render: () => <EmptyStatesPage /> };
