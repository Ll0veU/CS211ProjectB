import type { EChartsCoreOption } from 'echarts/core';
import type { Summary } from '../types';
import { imageTool, type Translate } from './shared';

export function chordOption(
  edges: Summary['edges'],
  translate: Translate,
  size = { width: 800, height: 680 }
): EChartsCoreOption {
  const identities = [
    ...new Set(edges.flatMap((edge) => [edge.sender, edge.receiver])),
  ];
  const radius = Math.max(
    35,
    Math.min((size.width - 180) / 2, (size.height - 100) / 2)
  );
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
        if (item.dataType === 'edge')
          return `${item.data.source} →\n${item.data.target}\n${translate('count')}: ${item.data.value}`;
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
      feature: { saveAsImage: imageTool(translate, 'binder-chord') },
    },
    series: [
      {
        type: 'chord',
        center: [size.width / 2, size.height / 2],
        radius: [Math.max(10, radius - 18), radius],
        startAngle: 90,
        clockwise: true,
        padAngle: 6,
        data: identities.map((name) => ({ name })),
        // Opposite directions remain independent; ribbon color belongs to the sender.
        links: edges.map((edge) => ({
          source: edge.sender,
          target: edge.receiver,
          value: edge.count,
        })),
        label: {
          show: true,
          position: 'outside',
          distance: 10,
          fontSize: 11,
          lineHeight: 14,
          color: '#173c36',
          formatter: (item: { name: string }) => {
            const upid = item.name.match(/\[upid (\d+)\]$/)?.[1];
            return upid ? `UPID ${upid}` : translate('unavailable');
          },
        },
        labelLayout: { hideOverlap: true },
        lineStyle: { color: 'source', opacity: 0.4 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.85 } },
      },
    ],
  };
}
