package edu.cs211.projectb;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

/** The allowlisted JavaScript interface is independent of Activity layout and exports. */
public final class ControllerBridge {
    private final Activity activity;
    private final ControllerSession session;
    private final DocumentExports exports;
    private final LegacyRecordingNotifications alerts;

    ControllerBridge(Activity activity, ControllerSession session, DocumentExports exports,
            LegacyRecordingNotifications alerts) {
        this.activity = activity; this.session = session; this.exports = exports; this.alerts = alerts;
    }

    @JavascriptInterface public int protocolVersion() { return 2; }
    @JavascriptInterface public void setLocale(String value) {
        if ("en".equals(value) || "zh-CN".equals(value)) session.locale = value;
    }
    @JavascriptInterface public String boottimeNsString() { return Long.toString(SystemClock.elapsedRealtimeNanos()); }
    @JavascriptInterface public long boottimeNs() { return SystemClock.elapsedRealtimeNanos(); }
    @JavascriptInterface public String markerStatus() {
        return activity.getSharedPreferences("markers", Activity.MODE_PRIVATE).getString("last_status", "");
    }
    @JavascriptInterface public void armRecording(String run, String workload, String token) {
        if (!run.matches("[0-9a-f]{32}") || !workload.matches("W[012]")) return;
        activity.runOnUiThread(() -> {
            if (!session.visible) { toast(MarkerText.text(session.locale, "Open the controller before arming markers", "请先在前台打开控制器")); return; }
            NotificationManager manager = activity.getSystemService(NotificationManager.class);
            if (!manager.areNotificationsEnabled()) { toast(MarkerText.text(session.locale, "Enable notifications before arming phone markers", "请先允许通知，再启用手机标记")); return; }
            activity.stopService(new Intent(activity, FloatingMarkersService.class));
            manager.cancel(LegacyRecordingNotifications.NOTICE);
            activity.startForegroundService(new Intent(activity, ExperimentMarkerService.class)
                    .putExtra("run", run).putExtra("workload", workload).putExtra("origin", session.origin)
                    .putExtra("token", token).putExtra("locale", session.locale));
        });
    }
    @JavascriptInterface public void resourceProfile() {
        activity.runOnUiThread(() -> {
            activity.stopService(new Intent(activity, ExperimentMarkerService.class));
            activity.stopService(new Intent(activity, FloatingMarkersService.class));
            activity.getSystemService(NotificationManager.class).cancel(LegacyRecordingNotifications.NOTICE);
        });
    }
    @JavascriptInterface public boolean floatingMarkersEnabled() { return android.provider.Settings.canDrawOverlays(activity); }
    @JavascriptInterface public void floatingMarkerSettings() {
        activity.runOnUiThread(() -> {
            try { activity.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + activity.getPackageName()))); }
            catch (Exception error) { toast("Open Android app settings and enable Display over other apps for Project B."); }
        });
    }
    @JavascriptInterface public String appLabels() {
        JSONArray labels = new JSONArray();
        PackageManager manager = activity.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        for (android.content.pm.ResolveInfo info : manager.queryIntentActivities(launcher, 0)) {
            try { labels.put(new JSONObject().put("package", info.activityInfo.packageName).put("name", info.loadLabel(manager).toString())); }
            catch (Exception ignored) { /* Preserve the other visible applications. */ }
        }
        return labels.toString();
    }
    @JavascriptInterface public String loadState(String key) {
        if (!key.matches("token|run|device_label|conditions|locale|campaign")) return "";
        return activity.getPreferences(Activity.MODE_PRIVATE).getString(session.origin + "/" + key, "");
    }
    @JavascriptInterface public void saveState(String key, String value) {
        if (key.matches("token|run|device_label|conditions|locale|campaign") && value.length() <= 2048)
            activity.getPreferences(Activity.MODE_PRIVATE).edit().putString(session.origin + "/" + key, value).apply();
    }
    @JavascriptInterface public void recording(String run, String workload, String token, int duration) {
        if (run.isEmpty() || run.matches("[0-9a-f]{32}"))
            activity.runOnUiThread(() -> alerts.recording(session.origin, run, workload, token, duration));
    }
    @JavascriptInterface public void exportFile(String path, String token) { exports.choose(path, token, session.origin); }

    private void toast(String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
