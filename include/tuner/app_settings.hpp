#pragma once

namespace tuner {

struct AppSettings {
    float center_frequency_hz = 440.0f;
    int precise_fft_size = 16384; // fixed for now
    int precise_decimation = 16;
    float precise_window_seconds = 0.35f;
    int frontend_decimation = 2;

    // Spectrum view
    bool show_frequency_lines = true;
    bool show_peak_line = true;
    float bell_curve_width = 0.35f;
    int color_scheme_idx = 2; // Viridis
};

} // namespace tuner


