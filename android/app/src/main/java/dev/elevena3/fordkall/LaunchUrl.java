package dev.elevena3.fordkall;

import java.net.URI;
import java.net.URLEncoder;
import java.net.URLDecoder;
import java.util.Locale;

/** Inbound intents are untrusted: only the production origin and room-code scheme are allowed. */
public final class LaunchUrl {
    public static final String HOME = "https://fordkall.11a3.dev/?source=android";
    private LaunchUrl() {}

    public static String resolve(String value) {
        if (value == null) return HOME;
        try {
            URI uri = new URI(value);
            if ("https".equalsIgnoreCase(uri.getScheme())
                    && "fordkall.11a3.dev".equalsIgnoreCase(uri.getHost())
                    && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                    && (uri.getPath().isEmpty() || "/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()))) {
                return uri.toASCIIString();
            }
            if ("fordkall".equalsIgnoreCase(uri.getScheme())) {
                String room = null;
                String query = uri.getRawQuery();
                if (query != null) for (String part : query.split("&")) {
                    if (part.startsWith("room=")) room = URLDecoder.decode(part.substring(5), "UTF-8");
                }
                if (room == null) room = "join".equalsIgnoreCase(uri.getHost()) ? uri.getPath().replaceFirst("^/+", "") : uri.getHost();
                if (room != null && room.matches("[a-zA-Z0-9_-]{1,64}")) {
                    return "https://fordkall.11a3.dev/?room=" + URLEncoder.encode(room.toUpperCase(Locale.ROOT), "UTF-8") + "&source=android";
                }
            }
        } catch (Exception ignored) { /* Malformed or external links open only the fixed home URL. */ }
        return HOME;
    }
}
