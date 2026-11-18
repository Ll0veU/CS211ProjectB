export type Locale = 'en' | 'zh-CN';
export type Workload = 'W0' | 'W1' | 'W2';
export type Mode =
  | 'trace'
  | 'baseline'
  | 'resource_agent'
  | 'resource_controller'
  | 'resource_trace';
export interface Marker {
  label: string;
  boottime_ns: string | number;
  source: string;
  received_at: string;
  event_id?: string;
  offset_seconds?: number;
  inside_trace?: boolean;
}
export interface Ground {
  outcome: string;
  browser_package: string;
  recognized_text: string;
  actual_response: string;
  notes: string;
  actual_url: string;
  deviations: string;
  conditions_confirmed: boolean;
  page_verified: boolean;
  idle_undisturbed: boolean;
  recognized_text_available: boolean;
  confirmation_status: string;
}
export interface Run extends Partial<Ground> {
  id: string;
  status: string;
  target_package: string;
  target_packages?: string[];
  agent_id?: string;
  workload: Workload;
  mode: Mode;
  repetition: number;
  attempt?: number;
  created_at: string;
  finished_at?: string;
  recording_at?: string;
  resource_started_at?: number;
  settling_until?: number;
  markers: Marker[];
  duration_seconds: number;
  device_label: string;
  serial: string;
  campaign_id?: string;
  trial_id?: string;
  protocol_version?: string;
  phase?: string;
  error?: string;
  scope_confirmed?: boolean;
  browser_detection?: { status: string; package?: string; reason?: string };
}
export interface Trial {
  id: string;
  phase: string;
  mode: Mode;
  workload: Workload;
  repetition: number;
  duration_seconds: number;
  attempt: number;
  run_ids: string[];
  superseded: boolean;
  retry_reason?: string;
}
export interface Config {
  device_label: string;
  target_packages: string[];
  browser_package: string;
  account_label: string;
  gemini_mode: string;
  network: string;
  brightness: string;
  volume: string;
  read_aloud: string;
  resource_seconds: number;
  prompt?: string;
  voice_mode?: string;
  scope?: 'tasks_only' | 'tasks_and_resources';
  agent_id?: string;
}
export interface Spec {
  version: string;
  prompt: string;
  target_packages: string[];
  checklist: Record<Locale, string[]>;
  workloads: Record<
    Workload,
    {
      capture_seconds: number;
      markers: string[];
      sequence: string[];
      instructions: Record<Locale, string>;
      required_fields: string[];
    }
  >;
}
export interface Campaign {
  id: string;
  name: string;
  state: 'draft' | 'frozen';
  protocol_version: string;
  config: Config;
  protocol: Spec;
  trials: Trial[];
  scope_confirmed?: boolean;
  temperature_baseline_c?: number;
}
export interface Metric {
  median: number | null;
  peak: number | null;
  samples: number;
  reason?: string | null;
}
export interface Quality {
  valid: boolean;
  protocol_valid: boolean;
  attribution_status: string;
  issues: string[];
  details: { code: string; params: Record<string, string>; detail: string }[];
  task_duration_seconds?: number | null;
  voice_duration_seconds?: number | null;
  response_wait_seconds?: number | null;
  metric_availability?: Record<string, Metric>;
  energy?: Record<string, unknown>;
}
export interface Summary {
  transaction_count: number;
  trace_duration_seconds: number;
  peer_process_count: number;
  direction_counts: Record<string, number>;
  rates_per_second: Record<string, number>;
  sync_latency_ms: { median: number | null; p95: number | null };
  matched_sync_calls: number;
  unidentified_interface_count: number;
  unresolved_endpoint_requests: number;
  warnings: string[];
  timeline: {
    second: number;
    incoming: number;
    outgoing: number;
    internal: number;
  }[];
  markers: Marker[];
  edges: { sender: string; receiver: string; count: number }[];
  top_peers: [string, number][];
  interfaces: {
    interface: string;
    method: string;
    direction: string;
    count: number;
  }[];
  candidate_paths: { processes: string[]; status: string }[];
  per_package?: Record<
    string,
    Pick<
      Summary,
      'transaction_count' | 'peer_process_count' | 'direction_counts'
    >
  >;
  task_window?: Summary | null;
}
export interface SamplingQuality {
  sample_count: number;
  cpu_valid_intervals: Record<string, number>;
  cpu_rejected_samples: number;
  raw_command_error_count: number;
  temperature_c: { min: number; max: number } | null;
  battery_level_percent: { min: number; max: number } | null;
  battery_window_seconds: number | null;
  observer_wall_seconds: number | null;
  trace_bytes: number | null;
  observer?: string;
}
export interface ResourceSummary {
  metrics: Record<string, Metric>;
  per_package?: Record<string, Record<string, Metric>>;
  issues: string[];
  battery: Record<string, number | string | null>;
  sample_count: number;
  elapsed_seconds: number;
  observer?: string;
  sampling_quality?: SamplingQuality;
}
export interface ReportReference {
  available: boolean;
  source?: string;
  sha256?: string;
  period?: string;
  platform?: string;
  observer?: string;
  raw_data_verified: boolean;
  runs: {
    repetition: number;
    arm: string;
    short_id: string;
    local_start: string;
    metrics: Record<string, number>;
  }[];
  quality: {
    trial: string;
    snapshots: number;
    valid_cpu_intervals: string;
    cpu_rejected: number;
    raw_command_errors: number;
    temperature_c: string;
    battery_level_percent: string;
    battery_window_seconds: number;
    observer_wall_seconds: number;
    trace_bytes: number;
  }[];
  differences: {
    repetition: number | string;
    comparison: string;
    metrics: Record<string, number>;
  }[];
  limitations?: string[];
}
export interface Evaluation {
  descriptive_groups: {
    agent: string;
    workload: string;
    valid_successful_runs: number;
    features: Record<
      string,
      { median: number; min: number; max: number; n: number }
    >;
  }[];
  classification_available: boolean;
  accuracy_when_classified: number | null;
  run_comparisons: {
    id: string;
    agent: string;
    workload: string;
    outcome: string;
    phase?: string;
    repetition: number;
    capture_status: string;
    metrics: Partial<Summary> | null;
  }[];
  excluded_runs: { id: string; reason: string }[];
  resource_overhead: {
    triplets: {
      repetition: number;
      observer?: string;
      comparability?: {
        start_gap_seconds: number | null;
        temperature_span_c: number | null;
        warnings: string[];
      };
      differences: Record<
        string,
        Record<
          string,
          {
            delta: number | null;
            relative_percent: number | null;
            reason: string | null;
          }
        >
      >;
    }[];
    excluded: unknown[];
  };
}
export interface NativeBridge {
  loadState(key: string): string;
  saveState(key: string, value: string): void;
  protocolVersion?(): number;
  setLocale?(value: string): void;
  armRecording?(run: string, workload: string, token: string): void;
  resourceProfile?(): void;
  markerStatus?(): string;
  floatingMarkersEnabled?(): boolean;
  floatingMarkerSettings?(): void;
  exportFile?(path: string, token: string): void;
}
declare global {
  interface Window {
    ProjectB?: NativeBridge;
  }
}
