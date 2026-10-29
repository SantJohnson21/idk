# R8 rules for release builds (minifyEnabled true, shrinkResources true).
#
# Capacitor plugins are discovered through reflection from the generated
# capacitor.plugins.json and called over the WebView bridge, so the bridge and
# every @CapacitorPlugin class have to survive shrinking.

-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# WebView JavaScript interface methods are called by name from the page.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep annotations and line numbers so store crash reports stay readable.
-keepattributes *Annotation*, Signature, SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# Cordova compatibility layer (unused here, but shipped by Capacitor).
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**
