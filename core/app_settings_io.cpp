#include "app_settings.hpp"
#include "app_settings_io.hpp"
#include <string>
#include <cstdlib>
#include <cstdio>
#include <cstring>

namespace tuner {

// Minimal JSON (hand-rolled) to avoid deps. Expects well-formed file we wrote.
static bool parse_key_value(const char* s, const char* key, float& out) {
    const char* p = std::strstr(s, key);
    if (!p) return false;
    p = std::strchr(p, ':'); if (!p) return false; ++p;
    out = std::strtof(p, nullptr);
    return true;
}
static bool parse_key_value(const char* s, const char* key, int& out) {
    const char* p = std::strstr(s, key);
    if (!p) return false;
    p = std::strchr(p, ':'); if (!p) return false; ++p;
    out = std::strtol(p, nullptr, 10);
    return true;
}
static bool parse_key_value(const char* s, const char* key, bool& out) {
    const char* p = std::strstr(s, key);
    if (!p) return false;
    p = std::strchr(p, ':'); if (!p) return false; ++p;
    if (std::strncmp(p, "true", 4) == 0) { out = true; return true; }
    if (std::strncmp(p, "false", 5) == 0) { out = false; return true; }
    return false;
}

bool load_settings(const char* path, AppSettings& st) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long sz = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (sz <= 0 || sz > 1<<20) { std::fclose(f); return false; }
    std::string buf; buf.resize((size_t)sz);
    size_t n = std::fread(buf.data(), 1, (size_t)sz, f);
    std::fclose(f);
    if (n != (size_t)sz) return false;

    parse_key_value(buf.c_str(), "\"center_frequency_hz\"", st.center_frequency_hz);
    parse_key_value(buf.c_str(), "\"precise_fft_size\"", st.precise_fft_size);
    parse_key_value(buf.c_str(), "\"precise_decimation\"", st.precise_decimation);
    parse_key_value(buf.c_str(), "\"precise_window_seconds\"", st.precise_window_seconds);
    parse_key_value(buf.c_str(), "\"show_frequency_lines\"", st.show_frequency_lines);
    parse_key_value(buf.c_str(), "\"show_peak_line\"", st.show_peak_line);
    parse_key_value(buf.c_str(), "\"bell_curve_width\"", st.bell_curve_width);
    parse_key_value(buf.c_str(), "\"color_scheme_idx\"", st.color_scheme_idx);
    parse_key_value(buf.c_str(), "\"waterfall_color_scheme_idx\"", st.waterfall_color_scheme_idx);
    parse_key_value(buf.c_str(), "\"concentric_color_scheme_idx\"", st.concentric_color_scheme_idx);
    parse_key_value(buf.c_str(), "\"show_cent_labels\"", st.show_cent_labels);
    parse_key_value(buf.c_str(), "\"cent_label_size\"", st.cent_label_size);
    parse_key_value(buf.c_str(), "\"ui_mode\"", st.ui_mode);
    // last_session_path: very small and simple extraction between quotes
    const char* p = std::strstr(buf.c_str(), "\"last_session_path\"");
    if (p) {
        p = std::strchr(p, ':');
        if (p) {
            ++p;
            while (*p == ' ' || *p == '\t' || *p == '"') ++p; // skip spaces and opening quote
            const char* start = p;
            while (*p && *p != '"' && *p != '\n' && *p != '\r') ++p;
            st.last_session_path.assign(start, p - start);
        }
    }
    return true;
}

bool save_settings(const char* path, const AppSettings& st) {
    FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    std::fprintf(f,
        "{\n"
        "  \"center_frequency_hz\": %.3f,\n"
        "  \"precise_fft_size\": %d,\n"
        "  \"precise_decimation\": %d,\n"
        "  \"precise_window_seconds\": %.3f,\n"
        
        "  \"show_frequency_lines\": %s,\n"
        "  \"show_peak_line\": %s,\n"
        "  \"bell_curve_width\": %.3f,\n"
        "  \"color_scheme_idx\": %d,\n"
        "  \"waterfall_color_scheme_idx\": %d,\n"
        "  \"concentric_color_scheme_idx\": %d,\n"
        "  \"show_cent_labels\": %s,\n"
        "  \"cent_label_size\": %d,\n"
        "  \"ui_mode\": %d,\n"
        "  \"last_session_path\": \"%s\"\n"
        "}\n",
        st.center_frequency_hz,
        st.precise_fft_size,
        st.precise_decimation,
        st.precise_window_seconds,
        st.show_frequency_lines ? "true" : "false",
        st.show_peak_line ? "true" : "false",
        st.bell_curve_width,
        st.color_scheme_idx,
        st.waterfall_color_scheme_idx,
        st.concentric_color_scheme_idx,
        st.show_cent_labels ? "true" : "false",
        st.cent_label_size,
        st.ui_mode,
        st.last_session_path.c_str());
    std::fclose(f);
    return true;
}

} // namespace tuner


