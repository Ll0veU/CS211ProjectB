package edu.cs211.projectb;

import android.app.*;
import android.content.*;
import android.graphics.PixelFormat;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** An explicitly armed foreground service owns device-clock markers and timers. */
public final class ExperimentMarkerService extends Service {
    private static final int NOTICE = 213;
    private static final String CHANNEL = "protocol_v2_markers";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Set<String> completed = new HashSet<>();
    private final List<Button> buttons = new ArrayList<>();
    private String run = "", origin = "", token = "", workload = "", locale = "en", state = "awaiting_controller";
    private WindowManager windows;
    private LinearLayout overlay;
    private TextView status;
    private JSONObject pending;
    private boolean destroyed, sending, polling;
    private long timerDeadline;
    private String timerMarker;
    private int idleSeconds = 30, waitSeconds = 60;
    private long serviceDeadline;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("mark".equals(intent.getAction())) {
            String marker = intent.getStringExtra("marker");
            if ("retry".equals(marker)) uploadPending(); else mark(marker, false);
            return START_NOT_STICKY;
        }
        String selected = intent.getStringExtra("run");
        if (selected == null || !selected.matches("[0-9a-f]{32}")) { stopSelf(); return START_NOT_STICKY; }
        if (!run.isEmpty() && !run.equals(selected)) { stopSelf(); return START_NOT_STICKY; }
        if (run.equals(selected)) return START_NOT_STICKY;
        run = selected; origin = intent.getStringExtra("origin"); token = intent.getStringExtra("token");
        serviceDeadline = SystemClock.elapsedRealtime() + 360_000L;
        workload = intent.getStringExtra("workload"); locale = intent.getStringExtra("locale");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, tr("Experiment markers", "实验事件标记"), NotificationManager.IMPORTANCE_LOW));
        startForeground(NOTICE, notification(tr("Preparing phone markers", "正在准备手机标记")));
        if (Settings.canDrawOverlays(this)) showOverlay();
        String stored = getSharedPreferences("markers", MODE_PRIVATE).getString(run + "/pending", "");
        if (!stored.isEmpty()) {
            try { pending = new JSONObject(stored); } catch (JSONException ignored) { }
        }
        network.execute(() -> {
            try {
                request("/controller-ready", new JSONObject().put("native", true).put("version", 2));
                main.post(() -> updateStatus(tr("Phone ready; waiting for recording", "手机已就绪，等待开始采集")));
            } catch (Exception error) {
                main.post(() -> updateStatus(tr("Could not arm: ", "启用失败：") + error.getMessage()));
            }
        });
        main.post(tick);
        return START_NOT_STICKY;
    }

    private String tr(String english, String chinese) { return MarkerText.text(locale, english, chinese); }

    private String[] markers() {
        if ("W0".equals(workload)) return new String[]{"idle_start", "unexpected_activity"};
        if ("W1".equals(workload)) return new String[]{"prompt_submitted", "confirmation", "browser_launched"};
        return new String[]{"voice_start", "voice_end", "response_complete"};
    }

    private boolean allowed(String marker) {
        if (!"recording".equals(state) || pending != null || marker == null) return false;
        if (completed.contains(marker) && !"confirmation".equals(marker)) return false;
        if ("browser_launched".equals(marker) || "confirmation".equals(marker)) return completed.contains("prompt_submitted");
        if ("voice_end".equals(marker)) return completed.contains("voice_start");
        if ("response_complete".equals(marker)) return completed.contains("voice_end");
        return true;
    }

    private Notification notification(String message) {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle(tr("Project B · phone markers", "Project B · 手机标记"))
            .setContentText(message).setOnlyAlertOnce(true).setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this, NOTICE, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        String[] actions = pending != null ? new String[]{"retry"} : markers();
        for (int index = 0; index < actions.length; index++) {
            String marker = actions[index];
            if (!"retry".equals(marker) && !allowed(marker)) continue;
            Intent action = new Intent(this, ExperimentMarkerService.class).setAction("mark").putExtra("marker", marker);
            PendingIntent pendingIntent = PendingIntent.getService(this, NOTICE + index, action, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new Notification.Action.Builder(null, "retry".equals(marker) ? tr("Retry upload", "重试发送") : MarkerText.label(locale, marker), pendingIntent).build());
        }
        return builder.build();
    }

    private void showOverlay() {
        windows = getSystemService(WindowManager.class);
        overlay = new LinearLayout(this); overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setPadding(12, 8, 12, 8); overlay.setBackgroundColor(0xf5eff7f5);
        Button toggle = new Button(this); toggle.setText("B · " + tr("Markers", "标记")); overlay.addView(toggle);
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        status = new TextView(this); status.setMaxWidth(dp(220)); panel.addView(status);
        for (String marker : markers()) {
            Button button = new Button(this); button.setText(MarkerText.label(locale, marker)); button.setTag(marker);
            button.setAllCaps(false); button.setOnClickListener(view -> { mark(marker, false); panel.setVisibility(View.GONE); });
            panel.addView(button); buttons.add(button);
        }
        Button retry = new Button(this); retry.setText(tr("Retry upload", "重试发送")); retry.setTag("retry");
        retry.setOnClickListener(view -> uploadPending()); panel.addView(retry); buttons.add(retry);
        overlay.addView(panel); panel.setVisibility(View.GONE);
        toggle.setOnClickListener(view -> panel.setVisibility(panel.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
        WindowManager.LayoutParams position = new WindowManager.LayoutParams(dp(240), -2, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        position.gravity = Gravity.RIGHT | Gravity.CENTER_VERTICAL;
        try { windows.addView(overlay, position); } catch (RuntimeException error) { overlay = null; }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void mark(String marker, boolean automatic) {
        if (!allowed(marker)) return;
        try {
            // Capture the event before any network work; retries reuse this exact ID/time.
            pending = new JSONObject().put("label", marker).put("event_id", UUID.randomUUID().toString())
                .put("boottime_ns", Long.toString(SystemClock.elapsedRealtimeNanos()))
                .put("source", automatic ? "android_timer" : "android_elapsed_realtime");
            getSharedPreferences("markers", MODE_PRIVATE).edit().putString(run + "/pending", pending.toString()).apply();
            uploadPending();
        } catch (JSONException error) { updateStatus(error.getMessage()); }
    }

    private void uploadPending() {
        if (pending == null || sending) return;
        sending = true;
        JSONObject payload = pending;
        updateStatus(tr("Sending marker…", "正在保存标记…"));
        network.execute(() -> {
            try {
                request("/markers", payload);
                main.post(() -> {
                    if (destroyed) return;
                    sending = false; pending = null;
                    String label = payload.optString("label"); completed.add(label);
                    getSharedPreferences("markers", MODE_PRIVATE).edit().remove(run + "/pending")
                        .putString("last_status", MarkerText.label(locale, label) + " · " + tr("saved", "已保存")).apply();
                    schedule(label, Long.parseLong(payload.optString("boottime_ns")));
                    updateStatus(MarkerText.label(locale, label) + " · " + tr("saved", "已保存"));
                });
            } catch (Exception error) {
                main.post(() -> { sending = false; updateStatus(tr("Not saved; retry: ", "未保存，请重试：") + error.getMessage()); });
            }
        });
    }

    private void schedule(String label, long nanoseconds) {
        if ("idle_start".equals(label)) { timerDeadline = nanoseconds + idleSeconds * 1_000_000_000L; timerMarker = "idle_end"; }
        if ("prompt_submitted".equals(label) || "voice_end".equals(label)) {
            timerDeadline = nanoseconds + waitSeconds * 1_000_000_000L; timerMarker = "task_timeout";
        }
        if ("idle_end".equals(label) || "browser_launched".equals(label) || "response_complete".equals(label) || "task_timeout".equals(label)) {
            timerDeadline = 0; timerMarker = null;
        }
    }

    private JSONObject request(String suffix, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + "/api/runs/" + run + suffix).openConnection();
        try {
            connection.setConnectTimeout(3000); connection.setReadTimeout(3000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (var output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new java.io.IOException("HTTP " + code);
            try (var input = connection.getInputStream()) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { connection.disconnect(); }
    }

    private void updateStatus(String message) {
        if (destroyed) return;
        if (status != null) status.setText(message);
        for (Button button : buttons) {
            String marker = (String) button.getTag();
            button.setEnabled("retry".equals(marker) ? pending != null && !sending : allowed(marker));
        }
        getSystemService(NotificationManager.class).notify(NOTICE, notification(message));
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            if (SystemClock.elapsedRealtime() >= serviceDeadline) {
                getSharedPreferences("markers", MODE_PRIVATE).edit().putString("last_status",
                    tr("Marker session expired; review capture and pending events.", "标记会话已到期，请审核采集和未保存事件。")).apply();
                stopSelf(); return;
            }
            if (timerDeadline > 0 && SystemClock.elapsedRealtimeNanos() >= timerDeadline && pending == null) {
                String marker = timerMarker; timerDeadline = 0; mark(marker, true);
            }
            if (!polling) {
                polling = true;
                network.execute(() -> {
                    try {
                        JSONObject record = request("", null);
                        main.post(() -> {
                            polling = false; if (destroyed) return;
                            state = record.optString("status");
                            JSONObject definition = record.optJSONObject("protocol_snapshot");
                            if (definition != null) {
                                JSONObject workloads = definition.optJSONObject("workloads");
                                if (workloads != null) {
                                    idleSeconds = workloads.optJSONObject("W0").optInt("window_seconds", 30);
                                    JSONObject currentWorkload = workloads.optJSONObject(workload);
                                    waitSeconds = currentWorkload.optInt("timeout_seconds", 60);
                                }
                            }
                            JSONArray events = record.optJSONArray("markers");
                            if (events != null) for (int index = 0; index < events.length(); index++) {
                                JSONObject event = events.optJSONObject(index);
                                String label = event.optString("label");
                                if (completed.add(label)) schedule(label, Long.parseLong(event.optString("boottime_ns")));
                            }
                            if (Arrays.asList("collecting", "analyzing", "complete", "failed").contains(state)) {
                                if (pending != null) getSharedPreferences("markers", MODE_PRIVATE).edit()
                                    .putString("last_status", tr("An event was not saved. Review this trial.", "存在未保存标记，请检查本次实验。")).apply();
                                stopSelf(); return;
                            }
                            long remaining = timerDeadline > 0 ? Math.max(0, (timerDeadline - SystemClock.elapsedRealtimeNanos() + 999_999_999L) / 1_000_000_000L) : -1;
                            if (!sending && pending == null) updateStatus("recording".equals(state)
                                ? tr("Recording", "正在录制") + (remaining >= 0 ? " · " + remaining + " s" : "")
                                : tr("Waiting for recording", "等待开始录制"));
                        });
                    } catch (Exception error) {
                        main.post(() -> { polling = false; updateStatus(tr("Connection unavailable; markers stay pending", "连接不可用，未保存标记将保留")); });
                    }
                });
            }
            main.postDelayed(this, 500);
        }
    };

    @Override public void onDestroy() {
        destroyed = true; main.removeCallbacksAndMessages(null); network.shutdownNow();
        if (overlay != null && windows != null) try { windows.removeView(overlay); } catch (RuntimeException ignored) { }
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
