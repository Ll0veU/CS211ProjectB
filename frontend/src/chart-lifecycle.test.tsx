import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from './i18n';
import { CommunicationCharts } from './CommunicationCharts';
import type { Summary } from './types';

const chartMocks = vi.hoisted(() => ({
  instances: [] as {
    setOption: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => {
    const instance = {
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      getWidth: () => 800,
      getHeight: () => 680,
    };
    chartMocks.instances.push(instance);
    return instance;
  }),
}));

beforeEach(async () => {
  chartMocks.instances.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps the hovered chord chart intact across unrelated parent updates', () => {
  const data = {
    timeline: [],
    markers: [],
    trace_duration_seconds: 30,
    edges: [
      { sender: 'agent [upid 1]', receiver: 'system [upid 2]', count: 10 },
    ],
  } as unknown as Summary;
  const view = render(<CommunicationCharts data={data} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chord diagram' }));
  const chart = chartMocks.instances[1];
  chart.setOption.mockClear();
  for (let update = 0; update < 5; update++)
    view.rerender(<CommunicationCharts data={data} />);
  expect(chart.setOption).not.toHaveBeenCalled();
  expect(chart.dispose).not.toHaveBeenCalled();
  view.rerender(
    <CommunicationCharts
      data={{ ...data, edges: [{ ...data.edges[0], count: 20 }] }}
    />
  );
  expect(chart.setOption).toHaveBeenCalledTimes(1);
});
