// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project's site templates on the Designer's home: one, several (one to rename, more past
 * the list), and why a folder was not copied in. Dark, right-to-left and density come from the
 * Storybook globals and the VRT matrix.
 */
import { HomeTemplatesView } from './homeTemplates.js';

const noop = (): void => undefined;
const frame = (node: React.ReactNode) => <div className="w-[700px] max-w-full bg-bg p-5">{node}</div>;

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Site templates on Home' };
export default meta;

export const One = {
  tags: ['vrt'],
  render: () => frame(<HomeTemplatesView listing={{ templates: [{ name: 'harbor-bakery', usable: true }], more: 0, note: null }} started={null} onStart={noop} onDismiss={noop} />),
};

export const Several = {
  tags: ['vrt'],
  render: () =>
    frame(
      <HomeTemplatesView
        listing={{
          templates: [
            { name: 'harbor bakery!', usable: false },
            { name: 'lantern-books', usable: true },
            { name: 'tidewater-yoga', usable: true },
          ],
          more: 2,
          note: null,
        }}
        started={null}
        onStart={noop}
        onDismiss={noop}
      />,
    ),
};

export const NotCopied = {
  tags: ['vrt'],
  render: () => frame(<HomeTemplatesView listing={{ templates: [], more: 0, note: { name: 'Downloads', why: 'Downloads holds more than 1,000 files and folders, so it is not copied in as a site template.' } }} started={null} onStart={noop} onDismiss={noop} />),
};
