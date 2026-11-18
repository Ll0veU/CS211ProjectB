import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import i18n from '../i18n';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => ({
      ok: true,
      json: async () => (path.endsWith('/protocol') ? { version: '2.0' } : []),
    }))
  );
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shares connection state across feature routes and restores the plan draft', async () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText('Backend access code'), {
    target: { value: 'fixture' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect & refresh' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Connected')
  );
  fireEvent.click(screen.getByRole('link', { name: 'Experiment plans' }));
  fireEvent.change(screen.getByLabelText('Plan name'), {
    target: { value: 'Retained plan draft' },
  });
  fireEvent.click(screen.getByRole('link', { name: 'Run archive' }));
  expect(
    screen.getByRole('heading', { name: 'Run archive' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Experiment plans' }));
  expect(screen.getByLabelText('Plan name')).toHaveValue('Retained plan draft');
  expect(sessionStorage.getItem('projectb.token')).toBe('fixture');
});
