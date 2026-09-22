// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { Braces } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { CodePane, CodePaneButton } from './CodePane.js';

function pane(over: Partial<Parameters<typeof CodePane>[0]> = {}) {
  return (
    <CodePane
      icon={<Braces />}
      title="Route definition"
      dirty={false}
      stateLabel="synced with form"
      value={'{\n  "path": "/orders"\n}'}
      onValueChange={() => undefined}
      textareaLabel="Route definition JSON"
      action={<CodePaneButton variant="format">Format</CodePaneButton>}
      footer={
        <>
          <CodePaneButton variant="apply" disabled>
            Apply to form
          </CodePaneButton>
          <CodePaneButton variant="revert">Revert</CodePaneButton>
        </>
      }
      {...over}
    />
  );
}

describe('CodePane', () => {
  it('is the dark island, with a labelled textarea that stays LTR and skips spell-check', () => {
    const { container } = render(pane());
    expect((container.firstChild as HTMLElement).className).toContain('adm-always-dark');
    const box = screen.getByRole('textbox', { name: 'Route definition JSON' });
    expect(box.getAttribute('dir')).toBe('ltr');
    expect(box.getAttribute('spellcheck')).toBe('false');
    expect(box.className).toContain('leading-[1.65]');
    expect(box.className).toContain('[tab-size:2]');
  });

  it('shows the state badge in both states, and the error strip only when there is one', () => {
    const { rerender } = render(pane());
    expect(screen.getByText('synced with form').getAttribute('data-state')).toBe('synced');
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(pane({ dirty: true, stateLabel: 'edited — not applied', error: 'Unexpected token }' }));
    expect(screen.getByText('edited — not applied').className).toContain('text-warn');
    expect(screen.getByRole('alert').textContent).toContain('Unexpected token');
  });

  it('reports every edit', () => {
    const onValueChange = vi.fn();
    render(pane({ onValueChange }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{}' } });
    expect(onValueChange).toHaveBeenCalledWith('{}');
  });

  it('draws Apply disabled the way the comp does, and enabled on the light accent', () => {
    render(
      <>
        <CodePaneButton variant="apply" disabled>
          Off
        </CodePaneButton>
        <CodePaneButton variant="apply">On</CodePaneButton>
      </>,
    );
    expect(screen.getByText('Off').className).toContain('disabled:bg-surface-3');
    expect(screen.getByText('On').className).toContain('bg-[var(--accent-light)]');
  });
});
