package edu.cs211.projectb;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;
import java.net.URI;

/** Owns Activity and WebView lifetimes; native protocol operations live in the bridge. */
public final class MainActivity extends Activity {
    private final ControllerSession session = new ControllerSession();
    private WebView web;
    private DocumentExports exports;
    private LegacyRecordingNotifications alerts;

    @Override protected void onResume() { super.onResume(); session.visible = true; }
    @Override protected void onPause() { session.visible = false; super.onPause(); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        exports = new DocumentExports(this);
        alerts = new LegacyRecordingNotifications(this);
        if (state != null && state.getString("origin") != null) {
            exports.restore(state); open(state.getString("origin"));
        } else { showConnect(); }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (web != null) state.putString("origin", session.origin);
        exports.save(state);
        super.onSaveInstanceState(state);
    }

    private void closeWebView() {
        if (web == null) return;
        web.removeJavascriptInterface("ProjectB"); web.destroy(); web = null;
    }

    @Override protected void onDestroy() { closeWebView(); super.onDestroy(); }

    private void showConnect() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(24, 32, 24, 16);
        EditText address = new EditText(this);
        address.setSingleLine(); address.setHint("http://192.168.1.10:8765");
        address.setText(getPreferences(MODE_PRIVATE).getString("origin", ""));
        Button connect = new Button(this); connect.setText("Open laptop backend");
        layout.addView(address); layout.addView(connect); setContentView(layout);
        connect.setOnClickListener(view -> {
            try {
                URI url = URI.create(address.getText().toString().trim());
                if (!("http".equals(url.getScheme()) || "https".equals(url.getScheme())) || url.getHost() == null
                        || url.getUserInfo() != null || url.getQuery() != null || url.getFragment() != null
                        || !url.getPath().matches("/?")) throw new IllegalArgumentException();
                open(url.getScheme() + "://" + url.getRawAuthority());
            } catch (IllegalArgumentException error) {
                Toast.makeText(this, "Enter the laptop address, including http:// and the port.", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void open(String address) {
        session.origin = address;
        alerts.configureChannel();
        getPreferences(MODE_PRIVATE).edit().putString("origin", address).apply();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new ControllerBridge(this, session, exports, alerts), "ProjectB");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().equals(session.origin + "/");
            }
        });
        web.setLayoutParams(new ViewGroup.LayoutParams(-1, -1)); setContentView(web); web.loadUrl(session.origin + "/");
    }

    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        closeWebView(); showConnect();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); exports.result(request, result, data);
    }
}
