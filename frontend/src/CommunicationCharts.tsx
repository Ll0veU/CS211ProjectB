import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import { BarChart, ChordChart, GraphChart, SankeyChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import type { Summary } from './types';

use([
  BarChart,
  GraphChart,
  SankeyChart,
  ChordChart,
  LabelLayout,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  SVGRenderer,
]);

type Translate = (key: string) => string;
const colors = ['#236a5c', '#598fc2', '#c18a45'];
export const trafficBands = [
  { minimum: 1, maximum: 9, label: '1–9', color: '#8296a6' },
  { minimum: 10, maximum: 99, label: '10–99', color: '#3a9c8a' },
  { minimum: 100, maximum: 999, label: '100–999', color: '#d09330' },
  { minimum: 1000, maximum: Infinity, label: '≥1000', color: '#c1534b' },
];

export function processLabel(name: string) {
  const [process, identity] = name.split(' [upid ');
  const lines: string[] = [];
  let current = '';
  for (const segment of process.split(/(?<=[./:])/)) {
    if (current && current.length + segment.length > 18) {
      lines.push(current);
      current = '';
    }
    for (const chunk of segment.match(/.{1,18}/g) || []) {
      if (current.length + chunk.length > 18) {
        lines.push(current);
        current = '';
      }
      current += chunk;
    }
  }
  if (current) lines.push(current);
  if (identity) lines.push(`[upid ${identity}`);
  return lines.join('\n');
}

export function timelineOption(
  data: Summary,
  translate: Translate
): EChartsCoreOption {
  const directions = ['incoming', 'outgoing', 'internal'] as const;
  return {
    animation: false,
    aria: { enabled: true, label: { description: translate('timelineHelp') } },
    color: colors,
    grid: { top: 54, left: 58, right: 25, bottom: 85 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      axisPointer: { type: 'shadow' },
    },
    legend: { top: 10, left: 12, data: directions.map(translate) },
    toolbox: {
      right: 10,
      feature: {
        saveAsImage: {
          type: 'svg',
          title: translate('saveChart'),
          name: 'binder-timeline',
          backgroundColor: '#fffefa',
        },
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: data.trace_duration_seconds,
      name: 's',
      minInterval: 1,
      axisLabel: {
        color: '#667b73',
        formatter: (value: number) => String(Number(value.toFixed(2))),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      name: translate('count'),
      axisLabel: { color: '#667b73' },
      splitLine: { lineStyle: { color: '#dce6e1' } },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none' },
      {
        type: 'slider',
        bottom: 16,
        height: 22,
        filterMode: 'none',
        borderColor: '#d8e0d6',
      },
    ],
    series: directions.map((direction, index) => ({
      name: translate(direction),
      type: 'bar',
      stack: 'requests',
      barMaxWidth: 22,
      // Bins stay in seconds; marker positions must not be rounded to category indexes.
      data: data.timeline.map((bin) => [
        (bin.second + Math.min(bin.second + 1, data.trace_duration_seconds)) /
          2,
        bin[direction],
      ]),
      emphasis: { focus: 'series' },
      markLine:
        index === 0
          ? {
              symbol: 'none',
              silent: false,
              lineStyle: { color: '#b75d31', type: 'dashed', width: 1.5 },
              label: { show: false },
              data: data.markers
                .filter(
                  (marker) =>
                    marker.inside_trace && marker.offset_seconds != null
                )
                .map((marker) => ({
                  name: translate(marker.label),
                  xAxis: marker.offset_seconds,
                  tooltip: {
                    formatter: `${translate(marker.label)}: ${marker.offset_seconds?.toFixed(3)} s`,
                  },
                })),
            }
          : undefined,
    })),
  };
}

export function sankeyOption(
  edges: Summary['edges'],
  translate: Translate
): EChartsCoreOption {
  const senders = [...new Set(edges.map((edge) => edge.sender))];
  const receivers = [...new Set(edges.map((edge) => edge.receiver))];
  const identities = [...new Set([...senders, ...receivers])];
  const palette = [
    '#236a5c',
    '#598fc2',
    '#b98a4e',
    '#8a79ad',
    '#6a9b8a',
    '#a96964',
  ];
  const color = (name: string) =>
    palette[identities.indexOf(name) % palette.length];
  const names = new Map<string, string>();
  const nodes = [
    ...senders.map((name) => {
      const id = `sender:${name}`;
      names.set(id, name);
      return {
        name: id,
        depth: 0,
        itemStyle: { color: color(name) },
        label: { position: 'left' },
      };
    }),
    ...receivers.map((name) => {
      const id = `receiver:${name}`;
      names.set(id, name);
      return {
        name: id,
        depth: 1,
        itemStyle: { color: color(name) },
        label: { position: 'right' },
      };
    }),
  ];
  return {
    animation: false,
    aria: { enabled: true, label: { description: translate('sankeyHelp') } },
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      formatter: (item: {
        name: string;
        dataType?: string;
        value?: number;
        data: { source?: string; target?: string; value?: number };
      }) => {
        if (item.dataType === 'edge') {
          return `${names.get(item.data.source || '')} →\n${names.get(item.data.target || '')}\n${translate('count')}: ${item.data.value}`;
        }
        return `${item.name.startsWith('sender:') ? translate('sender') : translate('receiver')}\n${names.get(item.name) || item.name}\n${translate('count')}: ${item.value ?? ''}`;
      },
    },
    toolbox: {
      right: 10,
      feature: {
        saveAsImage: {
          type: 'svg',
          title: translate('saveChart'),
          name: 'binder-directed-flows',
          backgroundColor: '#fffefa',
        },
      },
    },
    series: [
      {
        type: 'sankey',
        top: 45,
        bottom: 25,
        left: '25%',
        right: '25%',
        nodeWidth: 12,
        nodeGap: 42,
        nodeAlign: 'justify',
        draggable: false,
        data: nodes,
        // Split sender/receiver roles to represent cycles without inventing multi-hop flows.
        links: edges.map((edge) => ({
          source: `sender:${edge.sender}`,
          target: `receiver:${edge.receiver}`,
          value: edge.count,
        })),
        label: {
          color: '#173c36',
          fontSize: 10,
          width: 120,
          lineHeight: 14,
          formatter: (item: { name: string }) =>
            processLabel(names.get(item.name) || item.name),
        },
        lineStyle: { color: 'source', opacity: 0.38, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.8 } },
      },
    ],
  };
}

export function chordOption(
  edges: Summary['edges'],
  translate: Translate
): EChartsCoreOption {
  const identities = [
    ...new Set(edges.flatMap((edge) => [edge.sender, edge.receiver])),
  ];
  return {
    animation: false,
    aria: { enabled: true, label: { description: translate('chordHelp') } },
    color: ['#236a5c', '#598fc2', '#b98a4e', '#8a79ad', '#6a9b8a', '#a96964'],
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      formatter: (item: {
        name: string;
        dataType?: string;
        data: { source?: string; target?: string; value?: number };
      }) => {
        if (item.dataType === 'edge') {
          return `${item.data.source} →\n${item.data.target}\n${translate('count')}: ${item.data.value}`;
        }
        const outgoing = edges
          .filter((edge) => edge.sender === item.name)
          .reduce((sum, edge) => sum + edge.count, 0);
        const incoming = edges
          .filter((edge) => edge.receiver === item.name)
          .reduce((sum, edge) => sum + edge.count, 0);
        return `${item.name}\n${translate('outgoing')}: ${outgoing}\n${translate('incoming')}: ${incoming}`;
      },
    },
    toolbox: {
      right: 10,
      feature: {
        saveAsImage: {
          type: 'svg',
          title: translate('saveChart'),
          name: 'binder-chord',
          backgroundColor: '#fffefa',
        },
      },
    },
    series: [
      {
        type: 'chord',
        radius: ['58%', '65%'],
        padAngle: 4,
        data: identities.map((name) => ({ name })),
        // Retain directed links separately; do not collapse reciprocal requests into a sum.
        links: edges.map((edge) => ({
          source: edge.sender,
          target: edge.receiver,
          value: edge.count,
        })),
        label: {
          show: true,
          position: 'outside',
          fontSize: 10,
          lineHeight: 14,
          color: '#173c36',
          formatter: (item: { name: string }) => processLabel(item.name),
        },
        labelLayout: { moveOverlap: 'shiftY', hideOverlap: true },
        lineStyle: { color: 'source', opacity: 0.4 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.85 } },
      },
    ],
  };
}

export function graphOption(
  edges: Summary['edges'],
  translate: Translate
): EChartsCoreOption {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    weights.set(edge.sender, (weights.get(edge.sender) || 0) + edge.count);
    weights.set(edge.receiver, (weights.get(edge.receiver) || 0) + edge.count);
  }
  const maximum = Math.max(1, ...weights.values());
  return {
    animation: false,
    aria: { enabled: true, label: { description: translate('graphHelp') } },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    toolbox: {
      right: 10,
      feature: {
        restore: { title: translate('resetChart') },
        saveAsImage: {
          type: 'svg',
          title: translate('saveChart'),
          name: 'binder-processes',
          backgroundColor: '#fffefa',
        },
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'circular',
        roam: true,
        draggable: true,
        left: '25%',
        right: '25%',
        top: 75,
        bottom: 75,
        scaleLimit: { min: 0.4, max: 4 },
        data: [...weights].map(([name, value], index) => ({
          id: name,
          name,
          value,
          label: {
            position:
              Math.cos((2 * Math.PI * index) / weights.size) >= 0
                ? 'right'
                : 'left',
          },
          symbolSize: 16 + 30 * Math.sqrt(value / maximum),
          itemStyle: {
            color: value === maximum ? '#236a5c' : '#8daf9e',
            borderColor: '#fffefa',
            borderWidth: 2,
          },
        })),
        // Keep all directed edges and their original weights, including reciprocal links.
        links: edges.map((edge) => ({
          source: edge.sender,
          target: edge.receiver,
          name: `${edge.sender} → ${edge.receiver}`,
          value: edge.count,
          lineStyle: {
            color: trafficBands.find((band) => edge.count <= band.maximum)
              ?.color,
            width: Math.min(6, 1 + Math.log2(Math.max(1, edge.count)) / 2),
          },
        })),
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        labelLayout: { moveOverlap: 'shiftY' },
        label: {
          show: true,
          position: 'right',
          color: '#173c36',
          fontSize: 10,
          width: 110,
          lineHeight: 14,
          formatter: (item: { name: string }) => processLabel(item.name),
        },
        lineStyle: { opacity: 0.8, curveness: 0.18 },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { opacity: 1 },
          label: { fontWeight: 'bold' },
        },
      },
    ],
  };
}

function Chart({
  option,
  label,
  graph = false,
  height,
}: {
  option: EChartsCoreOption;
  label: string;
  graph?: boolean;
  height?: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const instance = init(element.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [expanded]);
  return (
    <div className={`chart-frame ${expanded ? 'chart-expanded' : ''}`}>
      {graph && (
        <button
          type="button"
          className="secondary chart-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'collapseChart' : 'expandChart')}
        </button>
      )}
      <div
        ref={element}
        className={`echart ${graph ? 'echart-graph' : 'echart-timeline'}`}
        style={expanded ? { height: '100%' } : height ? { height } : undefined}
        role="img"
        aria-label={label}
      />
    </div>
  );
}

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
      : Math.max(view === 'chord' ? 680 : 520, processCount * 55);
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
      />
    </>
  );
}
