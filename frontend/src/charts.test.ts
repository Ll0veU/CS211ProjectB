import { describe, expect, it } from 'vitest';
import {
  graphOption,
  sankeyOption,
  timelineOption,
} from './CommunicationCharts';
import type { Summary } from './types';

describe('communication chart evidence', () => {
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
