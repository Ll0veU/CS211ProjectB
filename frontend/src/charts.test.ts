import { describe, expect, it } from 'vitest';
import {
  graphOption,
  chordOption,
  processLabel,
  sankeyOption,
  timelineOption,
} from './CommunicationCharts';
import type { Summary } from './types';

describe('communication chart evidence', () => {
  it('labels chord nodes only by trace-local UPID and preserves full hover identities', () => {
    const edges = [
      {
        sender: 'com.example.agent [upid 949]',
        receiver: 'system_server [upid 788]',
        count: 10,
      },
    ];
    const option = chordOption(edges, (key) => key, {
      width: 1000,
      height: 680,
    });
    const graphics = option.graphic as {
      id: string;
      style: { text?: string };
    }[];
    expect(
      graphics
        .filter((item) => item.id.startsWith('chord-label-'))
        .map((item) => item.style.text)
        .sort()
    ).toEqual(['UPID 788', 'UPID 949']);
    expect(option).toMatchObject({
      series: [
        {
          data: [{ name: edges[0].sender }, { name: edges[0].receiver }],
          label: { show: false },
        },
      ],
    });
    const tooltip = option.tooltip as {
      formatter: (item: {
        name: string;
        dataType: string;
        data: { source?: string; target?: string; value?: number };
      }) => string;
    };
    expect(
      tooltip.formatter({ name: edges[0].sender, dataType: 'node', data: {} })
    ).toContain('com.example.agent [upid 949]');
    expect(
      tooltip.formatter({
        name: '',
        dataType: 'edge',
        data: { source: edges[0].sender, target: edges[0].receiver, value: 10 },
      })
    ).toContain('com.example.agent [upid 949] →\nsystem_server [upid 788]');
  });
  it('keeps reciprocal counts separate in chord ribbons', () => {
    const edges = [
      { sender: 'agent', receiver: 'system', count: 10 },
      { sender: 'system', receiver: 'agent', count: 4 },
    ];
    expect(chordOption(edges, (key) => key)).toMatchObject({
      series: [
        {
          type: 'chord',
          lineStyle: { color: 'source' },
          data: [{ name: 'agent' }, { name: 'system' }],
          links: [
            { source: 'agent', target: 'system', value: 10 },
            { source: 'system', target: 'agent', value: 4 },
          ],
        },
      ],
    });
  });
  it('wraps long labels without losing process identity or UPID', () => {
    const process = 'com.google.android.googlequicksearchbox:interactor';
    const label = processLabel(`${process} [upid 1222]`);
    const lines = label.split('\n');
    expect(lines.at(-1)).toBe('[upid 1222]');
    expect(lines.slice(0, -1).join('')).toBe(process);
    expect(lines.every((line) => line.length <= 18)).toBe(true);
  });
  it('colors directed edges at each request-count boundary', () => {
    const counts = [1, 9, 10, 99, 100, 999, 1000];
    const expectedColors = [
      '#8296a6',
      '#8296a6',
      '#3a9c8a',
      '#3a9c8a',
      '#d09330',
      '#d09330',
      '#c1534b',
    ];
    const edges = counts.map((count, index) => ({
      sender: 'agent',
      receiver: `peer-${index}`,
      count,
    }));
    expect(graphOption(edges, (key) => key)).toMatchObject({
      series: [
        {
          links: counts.map((count, index) => ({
            value: count,
            lineStyle: { color: expectedColors[index] },
          })),
        },
      ],
    });
  });
  it('represents reciprocal and self requests as separate sender/receiver flows', () => {
    const edges = [
      { sender: 'agent', receiver: 'system', count: 10 },
      { sender: 'system', receiver: 'agent', count: 4 },
      { sender: 'agent', receiver: 'agent', count: 2 },
    ];
    expect(sankeyOption(edges, (key) => key)).toMatchObject({
      series: [
        {
          type: 'sankey',
          data: [
            { name: 'sender:agent', depth: 0 },
            { name: 'sender:system', depth: 0 },
            { name: 'receiver:system', depth: 1 },
            { name: 'receiver:agent', depth: 1 },
          ],
          links: [
            { source: 'sender:agent', target: 'receiver:system', value: 10 },
            { source: 'sender:system', target: 'receiver:agent', value: 4 },
            { source: 'sender:agent', target: 'receiver:agent', value: 2 },
          ],
        },
      ],
    });
  });
  it('keeps fractional event times and request directions when changing windows', () => {
    const data = {
      trace_duration_seconds: 1.7,
      timeline: [
        { second: 0, incoming: 2, outgoing: 3, internal: 1 },
        { second: 1, incoming: 4, outgoing: 5, internal: 0 },
      ],
      markers: [
        { label: 'idle_end', offset_seconds: 1.65, inside_trace: true },
        { label: 'outside', offset_seconds: 2, inside_trace: false },
      ],
    } as Summary;
    const snapshot = JSON.stringify(data);
    expect(timelineOption(data, (key) => key)).toMatchObject({
      xAxis: { min: 0, max: 1.7 },
      series: [
        {
          name: 'incoming',
          data: [
            [0.5, 2],
            [1.35, 4],
          ],
          markLine: { data: [{ name: 'idle_end', xAxis: 1.65 }] },
        },
        {
          name: 'outgoing',
          data: [
            [0.5, 3],
            [1.35, 5],
          ],
        },
        {
          name: 'internal',
          data: [
            [0.5, 1],
            [1.35, 0],
          ],
        },
      ],
    });
    expect(
      timelineOption(
        {
          ...data,
          trace_duration_seconds: 0.5,
          timeline: [data.timeline[0]],
          markers: [],
        },
        (key) => key
      )
    ).toMatchObject({
      xAxis: { max: 0.5 },
      series: [
        { data: [[0.25, 2]], markLine: { data: [] } },
        { data: [[0.25, 3]] },
        { data: [[0.25, 1]] },
      ],
    });
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it('retains all directed edges, weights and full identities beyond twelve edges', () => {
    const edges = Array.from({ length: 20 }, (_, index) => ({
      sender: 'com.example.agent [upid 1]',
      receiver: `peer-${index} [upid ${index + 2}]`,
      count: index + 1,
    }));
    edges.push({
      sender: edges[0].receiver,
      receiver: edges[0].sender,
      count: 7,
    });
    const snapshot = JSON.stringify(edges);
    const option = graphOption(edges, (key) => key);
    expect(option).toMatchObject({
      series: [
        {
          links: edges.map((edge) => ({
            source: edge.sender,
            target: edge.receiver,
            value: edge.count,
          })),
        },
      ],
    });
    expect(JSON.stringify(edges)).toBe(snapshot);
  });
});
