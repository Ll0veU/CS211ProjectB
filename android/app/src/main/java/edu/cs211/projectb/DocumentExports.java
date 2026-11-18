package edu.cs211.projectb;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/** Owns document-picker state independently of WebView recreation and marker services. */
final class DocumentExports {
    private final Activity activity;
    private String path;
    private String token;
    private String origin;

    DocumentExports(Activity activity) { this.activity = activity; }

    void restore(Bundle state) {
        path = state.getString("exportPath");
        token = state.getString("exportToken");
        origin = state.getString("exportOrigin");
    }

    void save(Bundle state) {
        state.putString("exportPath", path);
        state.putString("exportToken", token);
        state.putString("exportOrigin", origin);
    }

    void choose(String selectedPath, String selectedToken, String selectedOrigin) {
        if (!selectedPath.matches("runs/[0-9a-f]{32}/(metadata|summary|transactions|edges|timeline|resources|resources_summary)\\.(json|csv)")
                && !selectedPath.matches("runs/[0-9a-f]{32}/capture\\.pftrace")
                && !selectedPath.matches("campaigns/[0-9a-f]{32}/(export\\.(json|csv)|guide\\.(en|zh-CN)\\.md)")
                && !selectedPath.equals("evaluation.json")) return;
        activity.runOnUiThread(() -> {
            path = selectedPath; token = selectedToken; origin = selectedOrigin;
            Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE)
                    .putExtra(Intent.EXTRA_TITLE, path.substring(path.lastIndexOf('/') + 1));
            activity.startActivityForResult(picker, 11);
        });
    }

    void result(int request, int result, Intent data) {
        if (request != 11 || result != Activity.RESULT_OK || data == null || path == null) return;
        String url = origin + "/api/" + path;
        String selectedToken = token;
        new Thread(() -> {
            try {
                MarkerReceiver.download(activity, url, selectedToken, data.getData());
                toast("Export saved.");
            } catch (Exception error) { toast("Export failed: " + error.getMessage()); }
        }).start();
    }

    private void toast(String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
