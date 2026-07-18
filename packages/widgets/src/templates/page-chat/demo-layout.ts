/**
 * The default `page-chat` demo layout — the manifest's slot areas
 * (templates/page-chat.json) filled the way the §14 archetype pass fills them
 * on a conversation+message pair: the required `inbox` (`conversation-inbox`)
 * and `thread` (`chat-thread`) slots plus the optional `attachments` rail.
 * No bindings → every widget renders `demoData(hash(instanceId))` (04 §5.3
 * demo mode). Used by Storybook, tests and first-run states.
 */

import type { PageLayout } from '../../page-config/index.js';

export const demoChatLayout: PageLayout = {
  version: 1,
  items: [
    {
      i: 'inbox',
      widget: 'conversation-inbox',
      x: 0,
      y: 0,
      w: 3,
      h: 16,
      config: { title: 'Conversations' },
    },
    {
      i: 'thread',
      widget: 'chat-thread',
      x: 3,
      y: 0,
      w: 6,
      h: 16,
      config: { title: 'Thread' },
    },
    {
      i: 'attachments',
      widget: 'attachment-list',
      x: 9,
      y: 0,
      w: 3,
      h: 10,
      config: { title: 'Attachments' },
    },
  ],
};
