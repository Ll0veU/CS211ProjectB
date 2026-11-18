import type { EChartsCoreOption } from 'echarts/core';
import type { Summary } from '../types';
import { imageTool, processLabel, type Translate } from './shared';

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
        if (item.dataType === 'edge')
          return `${names.get(item.data.source || '')} →\n${names.get(item.data.target || '')}\n${translate('count')}: ${item.data.value}`;
        return `${item.name.startsWith('sender:') ? translate('sender') : translate('receiver')}\n${names.get(item.name) || item.name}\n${translate('count')}: ${item.value ?? ''}`;
      },
    },
    toolbox: {
      right: 10,
      feature: { saveAsImage: imageTool(translate, 'binder-directed-flows') },
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
        // Separate roles represent cycles without inventing a multi-hop flow.
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
