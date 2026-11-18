package edu.cs211.projectb;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Stateless transport; event IDs and device timestamps are owned by the marker service. */
final class MarkerApiClient {
    private MarkerApiClient() { }

    static JSONObject request(String origin, String run, String token, String suffix, JSONObject body) throws Exception {
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
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (var input = connection.getInputStream()) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { connection.disconnect(); }
    }
}
