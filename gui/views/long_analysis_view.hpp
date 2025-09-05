#pragma once

#include <imgui.h>
#include <vector>

#include "analysis/long_analysis_engine.hpp"
#include "spectrum_plot.hpp"

namespace gui {

class LongAnalysisView {
public:
    bool show_window = false;
    bool show_settings = false;
    float capture_seconds = 3.0f;
    int num_segments = 4;   // 1..8
    int num_harmonics = 8;  // 1..8

    void render(LongAnalysisEngine& engine,
                SpectrumView& spectrum_view,
                float center_frequency_hz,
                unsigned int effective_sample_rate,
                int precise_fft_size,
                int precise_decimation);
};

} // namespace gui


