import { useTranslation } from 'react-i18next';
import type { Run } from '../../types';
import { resource, terminal } from '../../shared/format';

export function RunTimer({ run, clock }: { run: Run; clock: number }) {
  const { t } = useTranslation();
  if (terminal(run)) return null;
  // Preparation metadata persists after recording starts; only its own stage uses it.
  const boundary =
    run.status === 'settling' && run.settling_until
      ? run.settling_until * 1000
      : run.resource_started_at
        ? (run.resource_started_at + run.duration_seconds) * 1000
        : undefined;
  const last = [...run.markers]
    .reverse()
    .find((marker) =>
      ['idle_start', 'prompt_submitted', 'voice_end'].includes(marker.label)
    );
  const countdown = last
    ? Math.max(
        0,
        (last.label === 'idle_start' ? 30 : 60) -
          (clock - Date.parse(last.received_at)) / 1000
      )
    : null;
  const seconds =
    countdown ??
    (boundary
      ? Math.max(0, (boundary - clock) / 1000)
      : (clock - Date.parse(run.recording_at || run.created_at)) / 1000);
  return (
    <>
      <div className="timer">
        {Math.ceil(seconds)}
        <small>s</small>
      </div>
      <p className="muted">
        {t(resource(run.mode) ? 'resourceTimerEstimate' : 'timerEstimate')}
      </p>
    </>
  );
}
