import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import { BarChart, GraphChart, SankeyChart } from 'echarts/charts';
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
import type { Summary } from './types';

use([
  BarChart,
  GraphChart,
  SankeyChart,
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
        nodeGap: 14,
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
          fontSize: 11,
          width: 120,
          overflow: 'truncate',
          formatter: (item: { name: string }) =>
            names.get(item.name) || item.name,
        },
        lineStyle: { color: 'source', opacity: 0.38, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.8 } },
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
            width: Math.min(6, 1 + Math.log2(Math.max(1, edge.count)) / 2),
          },
        })),
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        label: {
          show: true,
          position: 'right',
          color: '#173c36',
          fontSize: 11,
          width: 110,
          overflow: 'truncate',
          formatter: (item: { name: string }) => {
            const [process, identity] = item.name.split(' [upid ');
            const shortName = process.includes('/')
              ? process.split('/').at(-1)
              : process.split('.').slice(-2).join('.');
            return identity
              ? `${shortName} [${identity}`
              : shortName || item.name;
          },
        },
        lineStyle: { color: '#78a491', opacity: 0.5, curveness: 0.18 },
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
}: {
  option: EChartsCoreOption;
  label: string;
  graph?: boolean;
}) {
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
  return (
    <div
      ref={element}
      className={`echart ${graph ? 'echart-graph' : 'echart-timeline'}`}
      role="img"
      aria-label={label}
    />
  );
}

export function CommunicationCharts({ data }: { data: Summary }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<'sankey' | 'network'>('sankey');
  const timeline = useMemo(
    () => timelineOption(data, (key) => t(key)),
    [data, t, i18n.language]
  );
  const graph = useMemo(
    () =>
      (view === 'sankey' ? sankeyOption : graphOption)(data.edges, (key) =>
        t(key)
      ),
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
      </div>
      <p className="muted">
        {t(view === 'sankey' ? 'sankeyHelp' : 'graphHelp')}
      </p>
      {view === 'sankey' && (
        <div className="flow-columns">
          <span>{t('sender')} →</span>
          <span>→ {t('receiver')}</span>
        </div>
      )}
      <Chart
        option={graph}
        label={t(view === 'sankey' ? 'sankey' : 'networkGraph')}
        graph
      />
    </>
  );
}
