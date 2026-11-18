import type { EChartsCoreOption } from 'echarts/core';
import type { Summary } from '../types';
import { imageTool, type Translate } from './shared';

export function timelineOption(
  data: Summary,
  translate: Translate
): EChartsCoreOption {
  const directions = ['incoming', 'outgoing', 'internal'] as const;
  return {
    animation: false,
    aria: { enabled: true, label: { description: translate('timelineHelp') } },
    color: ['#236a5c', '#598fc2', '#c18a45'],
    grid: { top: 65, left: 66, right: 25, bottom: 85 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      axisPointer: { type: 'shadow' },
    },
    legend: {
      top: 12,
      left: 16,
      right: 45,
      itemWidth: 16,
      itemHeight: 10,
      itemGap: 24,
      textStyle: { fontSize: 12 },
      data: directions.map(translate),
    },
    toolbox: {
      right: 10,
      feature: { saveAsImage: imageTool(translate, 'binder-timeline') },
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
      nameLocation: 'middle',
      nameGap: 48,
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
      // Real second coordinates preserve fractional event positions in either analysis window.
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
