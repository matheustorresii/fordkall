package dev.elevena3.fordkall;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

public class FordKallActivity extends LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Intent intent = getIntent();
        Uri data = intent.getData();
        if (data != null) intent.setData(Uri.parse(LaunchUrl.resolve(data.toString())));
        // This app has no file/share receiver. Do not forward arbitrary payloads or URI grants.
        intent.replaceExtras((Bundle) null);
        intent.setClipData(null);
        intent.setFlags(intent.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri data = getIntent().getData();
        return Uri.parse(LaunchUrl.resolve(data == null ? null : data.toString()));
    }
}
