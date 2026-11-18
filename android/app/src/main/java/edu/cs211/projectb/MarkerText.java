package edu.cs211.projectb;

import java.util.Locale;

/** Native controls use the same stable marker IDs as the web protocol. */
final class MarkerText {
    static String text(String locale, String english, String chinese) {
        return locale != null && locale.startsWith("zh") ? chinese : english;
    }

    static String label(String locale, String marker) {
        switch (marker) {
            case "idle_start": return text(locale, "Idle start", "空闲开始");
            case "idle_end": return text(locale, "Idle complete", "空闲计时完成");
            case "unexpected_activity": return text(locale, "Unexpected activity", "发生意外活动");
            case "prompt_submitted": return text(locale, "Prompt submitted", "提示词已提交");
            case "confirmation": return text(locale, "Confirmation performed", "已执行确认操作");
            case "browser_launched": return text(locale, "Page visible", "网页已显示");
            case "voice_start": return text(locale, "Voice start", "语音开始");
            case "voice_end": return text(locale, "Voice end", "语音结束");
            case "response_complete": return text(locale, "Response complete", "响应已完成");
            case "task_timeout": return text(locale, "Time limit reached", "已到等待时间上限");
            default: return marker;
        }
    }

    static String defaultLocale() {
        return Locale.getDefault().getLanguage().equals("zh") ? "zh-CN" : "en";
    }
}
