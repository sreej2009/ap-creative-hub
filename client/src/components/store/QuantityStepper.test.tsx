import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { QuantityStepper } from './QuantityStepper';

function Harness({ max }: { max: number }) {
  const [v, setV] = useState(1);
  return <QuantityStepper value={v} onChange={setV} max={max} label="Pearl Drops" />;
}

describe('QuantityStepper', () => {
  it('never exceeds available stock or drops below one', async () => {
    const user = userEvent.setup();
    render(<Harness max={3} />);
    const inc = screen.getByRole('button', { name: 'Increase quantity' });
    const dec = screen.getByRole('button', { name: 'Decrease quantity' });
    expect(dec).toBeDisabled();
    await user.click(inc);
    await user.click(inc);
    await user.click(inc);
    expect(screen.getByRole('group', { name: 'Quantity for Pearl Drops' })).toHaveTextContent('3');
    expect(inc).toBeDisabled();
  });
});
