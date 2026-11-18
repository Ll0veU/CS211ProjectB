import type { Run } from '../types';

export const terminal = (run?: Run) =>
  !!run && ['complete', 'failed'].includes(run.status);
export const resource = (mode?: string) =>
  mode?.startsWith('resource_') ?? false;
export const number = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
