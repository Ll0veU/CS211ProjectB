import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import i18n, { chinese, english } from './i18n';
import { GroundForm } from './features/runs/GroundForm';
import { RunPanel } from './features/runs/RunPanel';
import { ReferenceReport } from './features/analysis/ReferenceReport';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { Run, ReportReference } from './types';

const run: Run = {
  id: 'test-run',
  status: 'complete',
  target_package: 'com.agent',
  workload: 'W1',
  mode: 'trace',
  repetition: 1,
  created_at: '2026-11-10T00:00:00Z',
  markers: [],
  duration_seconds: 90,
  device_label: 'phone',
  serial: 'device',
  outcome: 'success',
  browser_package: 'com.browser',
};
beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('resource countdown', () => {
  it.each(['resource_agent', 'resource_controller', 'resource_trace'] as const)(
    'advances the %s recording timer after preparation ends',
    async (mode) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (path: string) => ({
          ok: true,
          json: async () =>
            path.endsWith('/artifacts')
              ? []
              : {
                  valid: false,
                  protocol_valid: false,
                  details: [],
                  issues: [],
                },
        }))
      );
      const started = Date.parse('2026-11-18T12:00:00Z');
      const props = {
        run: {
          ...run,
          mode,
          workload: 'W0' as const,
          status: 'settling',
          duration_seconds: 300,
          settling_until: started / 1000,
        },
        clock: started - 15000,
        token: 'test',
        refresh: async () => {},
        perform: async (work: () => Promise<void>) => {
          await work();
        },
        working: false,
        reportError: vi.fn(),
        exportFile: vi.fn(),
      };
      const view = render(<RunPanel {...props} />);
      await waitFor(() =>
        expect(view.container.querySelector('.timer')).toHaveTextContent('15s')
      );
      const recordingRun = {
        ...props.run,
        status: 'recording',
        resource_started_at: started / 1000,
      };
      view.rerender(
        <RunPanel {...props} run={recordingRun} clock={started + 30000} />
      );
      expect(view.container.querySelector('.timer')).toHaveTextContent('270s');
      view.rerender(
        <RunPanel {...props} run={recordingRun} clock={started + 31000} />
      );
      expect(view.container.querySelector('.timer')).toHaveTextContent('269s');
    }
  );
});

describe('language picker', () => {
  it('switches languages without losing an unsaved observation', async () => {
    render(
      <>
        <LanguageSwitcher />
        <GroundForm run={run} token="test" saved={async () => {}} />
      </>
    );
    fireEvent.change(screen.getByLabelText('Observation notes'), {
      target: { value: 'Keep this draft while changing language' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Interface language' }));
    expect(
      screen.getByRole('menuitemradio', { name: 'English (United States)' })
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: '中文（中国）' })
    );
    await waitFor(() =>
      expect(screen.getByLabelText('观察笔记')).toHaveValue(
        'Keep this draft while changing language'
      )
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '界面语言' }));
    expect(
      screen.getByRole('menuitemradio', { name: '中文（中国）' })
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: 'English (United States)' })
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Observation notes')).toHaveValue(
        'Keep this draft while changing language'
      )
    );
  });

  it('supports arrow navigation, Escape and outside dismissal', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Interface language' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const englishOption = screen.getByRole('menuitemradio', {
      name: 'English (United States)',
    });
    expect(englishOption).toHaveFocus();
    fireEvent.keyDown(englishOption, { key: 'ArrowUp' });
    const chineseOption = screen.getByRole('menuitemradio', {
      name: '中文（中国）',
    });
    expect(chineseOption).toHaveFocus();
    fireEvent.keyDown(chineseOption, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('operator evidence', () => {
  it('keeps dirty drafts through polling, language changes and remounts', async () => {
    const view = render(
      <GroundForm run={run} token="test" saved={async () => {}} />
    );
    fireEvent.change(screen.getByLabelText('Observation notes'), {
      target: { value: 'Observed Wikipedia after confirmation' },
    });
    view.rerender(
      <GroundForm
        run={{
          ...run,
          notes: 'stale server text',
          browser_package: 'com.other',
        }}
        token="test"
        saved={async () => {}}
      />
    );
    expect(screen.getByLabelText('Observation notes')).toHaveValue(
      'Observed Wikipedia after confirmation'
    );
    await i18n.changeLanguage('zh-CN');
    await waitFor(() =>
      expect(screen.getByLabelText('观察笔记')).toHaveValue(
        'Observed Wikipedia after confirmation'
      )
    );
    view.unmount();
    render(<GroundForm run={run} token="test" saved={async () => {}} />);
    expect(screen.getByLabelText('观察笔记')).toHaveValue(
      'Observed Wikipedia after confirmation'
    );
  });

  it('retains the draft when a save fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<GroundForm run={run} token="test" saved={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Observation notes'), {
      target: { value: 'Keep this observation' },
    });
    fireEvent.click(screen.getByText('Save observations'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(localStorage.getItem('projectb.ground.test-run')).toContain(
      'Keep this observation'
    );
  });

  it('only clears a draft after a matching backend readback', async () => {
    let posted: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, options: RequestInit) => {
        if (options.method === 'POST')
          posted = JSON.parse(options.body as string) as Record<
            string,
            unknown
          >;
        return { ok: true, json: async () => ({ ...run, ...posted }) };
      })
    );
    render(<GroundForm run={run} token="test" saved={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Observation notes'), {
      target: { value: 'Verified observation' },
    });
    fireEvent.click(screen.getByText('Save observations'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved and verified')
    );
    expect(localStorage.getItem('projectb.ground.test-run')).toBeNull();
    expect(screen.getByLabelText('Observation notes')).toHaveValue(
      'Verified observation'
    );
  });

  it('does not clear a draft when readback differs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => run }))
    );
    render(<GroundForm run={run} token="test" saved={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Actual webpage URL'), {
      target: { value: 'https://www.wikipedia.org/' },
    });
    fireEvent.click(screen.getByText('Save observations'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(localStorage.getItem('projectb.ground.test-run')).toContain(
      'https://www.wikipedia.org/'
    );
  });

  it('provides identical English and Chinese translation keys', () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(chinese).every((value) => value.length > 0)).toBe(
      true
    );
  });

  it('labels reported power deltas as a reference and retains negative signs', async () => {
    const reference: ReportReference = {
      available: true,
      raw_data_verified: false,
      platform: 'OPPO Find X7',
      runs: [
        {
          repetition: 1,
          arm: 'C',
          short_id: 'reported',
          local_start: '11-17',
          metrics: { estimated_mean_power_mw: 827.723 },
        },
      ],
      quality: [],
      differences: [
        {
          repetition: 'median',
          comparison: 'C−B',
          metrics: { estimated_mean_power_mw: -105.207 },
        },
      ],
    };
    render(<ReferenceReport reference={reference} />);
    expect(
      screen.getByText('Report values, not locally reproduced measurements')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Signed differences'));
    expect(screen.getByText('-105.207')).toBeInTheDocument();
    await i18n.changeLanguage('zh-CN');
    await waitFor(() =>
      expect(screen.getByText('报告引用值，尚未在本机复现')).toBeInTheDocument()
    );
  });
});
