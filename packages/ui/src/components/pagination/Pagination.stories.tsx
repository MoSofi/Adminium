import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Pagination } from './Pagination.js';

const meta = {
  title: 'Tier3/Pagination',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ pageCount }: { pageCount: number }) {
  const [page, setPage] = useState(1);
  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      label="Pagination"
      previousLabel="Previous page"
      nextLabel="Next page"
      pageLabel={(n) => `Page ${n}`}
    />
  );
}

export const Playground: Story = { render: () => <Demo pageCount={8} /> };
export const LongRange: Story = { tags: ['vrt'], render: () => <Demo pageCount={42} /> };
