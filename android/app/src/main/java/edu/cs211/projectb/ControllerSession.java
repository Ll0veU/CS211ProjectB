package edu.cs211.projectb;

/** Activity-visible state shared with WebView bridge callbacks. */
final class ControllerSession {
    String origin;
    volatile boolean visible;
    volatile String locale = MarkerText.defaultLocale();
}
