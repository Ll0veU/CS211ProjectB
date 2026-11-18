import type { EChartsCoreOption } from 'echarts/core';
import type { Summary } from '../types';
import {
  imageTool,
  processLabel,
  trafficBands,
  type Translate,
} from './shared';

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
        saveAsImage: imageTool(translate, 'binder-processes'),
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
