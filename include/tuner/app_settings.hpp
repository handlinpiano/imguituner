#pragma once

#include <string>

namespace tuner {

struct AppSettings {
    float center_frequency_hz = 440.0f;
    int precise_fft_size = 16384; // fixed for now
    int precise_decimation = 16;
    float precise_window_seconds = 0.35f;

    // Spectrum view
    bool show_frequency_lines = true;
    bool show_peak_line = true;
    float bell_curve_width = 0.35f;
    int color_scheme_idx = 2; // Viridis
    int waterfall_color_scheme_idx = 2;
    int concentric_color_scheme_idx = 2;
    // Spectrum labels
    bool show_cent_labels = true;
    int cent_label_size = 2; // 0:tiny,1:small,2:medium,3:large
    // UI mode: 0 = Desktop (Docking), 1 = Kiosk (single window)
    int ui_mode = 0;

    // General settings: last opened session path for Resume action
    std::string last_session_path;
};

} // namespace tuner


