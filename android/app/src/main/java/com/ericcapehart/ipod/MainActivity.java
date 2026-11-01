package com.ericcapehart.ipod;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A full-screen WebView around the iPod web app, which is bundled in assets/www.
 * The phone's Spotify app still does the playing; this is the remote.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF111111);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // app.js looks for this to hide the browser-only login buttons.
        s.setUserAgentString(s.getUserAgentString() + " IpodApp/1");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                // Everything else (the Spotify app intent, web links) goes to Android.
                try {
                    Intent intent = url.startsWith("intent:")
                            ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                            : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    // Nothing installed can open it.
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Camera for the QR scanner; the manifest permission covers the user-facing grant.
                request.grant(request.getResources());
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else load(getIntent());
    }

    // Opens the app, carrying over the #ipod=... part of a login hand-off link if there is one.
    private void load(Intent intent) {
        String url = START_URL;
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && data.getEncodedFragment() != null) url += "#" + data.getEncodedFragment();
        web.loadUrl(url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) load(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    // Back acts like the MENU button; at the top menu it leaves the app.
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.ipodBack ? window.ipodBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) finish();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }
}
