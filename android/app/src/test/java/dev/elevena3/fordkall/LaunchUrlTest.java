package dev.elevena3.fordkall;

import org.junit.Test;
import static org.junit.Assert.*;

public class LaunchUrlTest {
    @Test public void opensFixedHomeWithoutData() { assertEquals(LaunchUrl.HOME, LaunchUrl.resolve(null)); }
    @Test public void preservesRoomAndInviteLinks() {
        String link = "https://fordkall.11a3.dev/?room=KIWI-123&invite=FK-test";
        assertEquals(link + "&source=android", LaunchUrl.resolve(link));
    }
    @Test public void appLinksRetainEncodedQueriesAndFragmentWithAppContext() {
        assertEquals("https://fordkall.11a3.dev/?source=android", LaunchUrl.resolve("https://fordkall.11a3.dev/"));
        assertEquals("https://fordkall.11a3.dev/?room=KIWI&invite=FK%2Btest&source=android#join", LaunchUrl.resolve("https://fordkall.11a3.dev/?room=KIWI&invite=FK%2Btest#join"));
        assertEquals("https://fordkall.11a3.dev/?source=pwa&source=android", LaunchUrl.resolve("https://fordkall.11a3.dev/?source=pwa"));
    }
    @Test public void mapsDesktopRoomScheme() {
        assertEquals("https://fordkall.11a3.dev/?room=KIWI-123&source=android", LaunchUrl.resolve("fordkall://join/kiwi-123"));
        assertEquals("https://fordkall.11a3.dev/?room=KIWI&source=android", LaunchUrl.resolve("fordkall://KIWI"));
    }
    @Test public void rejectsExternalAndDeceptiveOrigins() {
        for (String link : new String[]{"https://evil.example/?room=X", "http://fordkall.11a3.dev/", "https://fordkall.11a3.dev.evil.example/", "https://evil@fordkall.11a3.dev/", "https://fordkall.11a3.dev:8080/", "javascript:alert(1)", "file:///data/user/0/private", "content://dev.elevena3.fordkall.fileprovider/private", "https://fordkall.11a3.dev/cosmetics/frame.png", "%%%"}) {
            assertEquals(link, LaunchUrl.HOME, LaunchUrl.resolve(link));
        }
    }
    @Test public void rejectsInjectedRoomCodes() {
        assertEquals(LaunchUrl.HOME, LaunchUrl.resolve("fordkall://join/%3Cscript%3E"));
        assertEquals(LaunchUrl.HOME, LaunchUrl.resolve("fordkall://join/?room=https%3A%2F%2Fevil.example"));
    }
}
