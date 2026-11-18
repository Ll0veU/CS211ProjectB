package edu.cs211.projectb;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.provider.Settings;

/** Legacy recording alerts remain separate from the protocol-v2 marker service. */
final class LegacyRecordingNotifications {
    static final int NOTICE = 211;
    private static final String CHANNEL = "experiment_alerts_v2";
    private final Activity activity;
    private String notificationRun = "";

    LegacyRecordingNotifications(Activity activity) { this.activity = activity; }

    void configureChannel() {
        // Android retains channel importance, so the existing v2 channel ID stays stable.
        NotificationChannel channel = new NotificationChannel(CHANNEL,
                "Experiment marker alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Recording alerts and task-marker action buttons");
        channel.enableVibration(true);
        activity.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    void recording(String origin, String run, String workload, String token, int duration) {
        NotificationManager manager = activity.getSystemService(NotificationManager.class);
        if (run.isEmpty()) {
            activity.stopService(new Intent(activity, FloatingMarkersService.class));
            manager.cancel(NOTICE); notificationRun = ""; return;
        }
        if (Settings.canDrawOverlays(activity)) {
            try {
                if (!FloatingMarkersService.runningFor(run)) {
                    activity.startForegroundService(new Intent(activity, FloatingMarkersService.class)
                            .putExtra("run", run).putExtra("workload", workload).putExtra("origin", origin)
                            .putExtra("token", token).putExtra("duration", duration));
                }
                manager.cancel(NOTICE); notificationRun = ""; return;
            } catch (RuntimeException error) {
                // Preserve notification fallback under Android background-start restrictions.
            }
        }
        if (run.equals(notificationRun) || !manager.areNotificationsEnabled()) return;
        String[] labels;
        switch (workload) {
            case "W0": labels = new String[]{"idle_start", "idle_end", "unexpected_activity"}; break;
            case "W1": labels = new String[]{"prompt_submitted", "confirmation", "browser_launched"}; break;
            case "W2": labels = new String[]{"voice_start", "voice_end", "response_complete"}; break;
            default: return;
        }
        configureChannel();
        Notification.Builder builder = new Notification.Builder(activity, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_recent_history).setContentTitle("Project B experiment active")
                .setContentText("Recording started. Expand for task-marker buttons.")
                .setStyle(new Notification.BigTextStyle().bigText("Use the buttons below when each event happens. Browser launched also detects the browser package."))
                .setOnlyAlertOnce(true).setTimeoutAfter(1000L * Math.max(5, Math.min(180, duration))).setOngoing(true);
        for (int index = 0; index < labels.length; index++) {
            Intent intent = new Intent(activity, MarkerReceiver.class).putExtra("url", origin + "/api/runs/" + run + "/markers")
                    .putExtra("token", token).putExtra("label", labels[index]);
            PendingIntent pending = PendingIntent.getBroadcast(activity, index, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new Notification.Action.Builder(null, labels[index].replace('_', ' '), pending).build());
        }
        manager.notify(NOTICE, builder.build()); notificationRun = run;
    }
}
