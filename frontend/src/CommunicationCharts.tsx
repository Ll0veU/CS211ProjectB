import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Summary } from './types';
import { Chart } from './charts/Chart';
import { timelineOption } from './charts/timeline';
import { graphOption } from './charts/network';
import { sankeyOption } from './charts/sankey';
import { chordOption } from './charts/chord';
import { trafficBands } from './charts/shared';

export function CommunicationCharts({ data }: { data: Summary }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<'sankey' | 'network' | 'chord'>('sankey');
  const processCount = new Set(
    data.edges.flatMap((edge) => [edge.sender, edge.receiver])
  ).size;
  const largestRole = Math.max(
    new Set(data.edges.map((edge) => edge.sender)).size,
    new Set(data.edges.map((edge) => edge.receiver)).size
  );
  const graphHeight =
    view === 'sankey'
      ? Math.max(480, largestRole * 86 + 70)
      : view === 'chord'
        ? Math.max(680, processCount * 45 + 100)
        : Math.max(520, processCount * 55);
  const timeline = useMemo(
    () => timelineOption(data, (key) => t(key)),
    [data, t, i18n.language]
  );
  const graph = useMemo(
    () =>
      (view === 'sankey'
        ? sankeyOption
        : view === 'chord'
          ? chordOption
          : graphOption)(data.edges, (key) => t(key)),
    [data.edges, view, t, i18n.language]
  );
  // Parent clock/polling renders must not reset a stationary pointer's tooltip.
  const fitChord = useCallback(
    (width: number, height: number) =>
      chordOption(data.edges, (key) => t(key), { width, height }),
    [data.edges, t, i18n.language]
  );
  return (
    <>
      <h3>{t('timeline')}</h3>
      <p className="muted">{t('timelineHelp')}</p>
      <Chart option={timeline} label={t('timeline')} />
      <h3>{t('graph')}</h3>
      <div className="segmented" role="group" aria-label={t('graph')}>
        <button
          className={view === 'sankey' ? 'active' : ''}
          aria-pressed={view === 'sankey'}
          onClick={() => setView('sankey')}
        >
          {t('sankey')}
        </button>
        <button
          className={view === 'network' ? 'active' : ''}
          aria-pressed={view === 'network'}
          onClick={() => setView('network')}
        >
          {t('networkGraph')}
        </button>
        <button
          className={view === 'chord' ? 'active' : ''}
          aria-pressed={view === 'chord'}
          onClick={() => setView('chord')}
        >
          {t('chord')}
        </button>
      </div>
      <p className="muted chart-description">
        {t(
          view === 'sankey'
            ? 'sankeyHelp'
            : view === 'chord'
              ? 'chordHelp'
              : 'graphHelp'
        )}
      </p>
      {view === 'network' && (
        <ul className="traffic-legend" aria-label={t('edgeTraffic')}>
          {trafficBands.map((band) => (
            <li key={band.minimum}>
              <span
                className="traffic-swatch"
                style={{ backgroundColor: band.color }}
                aria-hidden="true"
              />
              {band.label} {t('requests')}
            </li>
          ))}
        </ul>
      )}
      {view === 'sankey' && (
        <div className="flow-columns">
          <span>{t('sender')} →</span>
          <span>→ {t('receiver')}</span>
        </div>
      )}
      <Chart
        option={graph}
        label={t(
          view === 'sankey'
            ? 'sankey'
            : view === 'chord'
              ? 'chord'
              : 'networkGraph'
        )}
        graph
        height={graphHeight}
        fitOption={view === 'chord' ? fitChord : undefined}
      />
    </>
  );
}
