#pragma once

#include <imgui.h>
#include "views/spectrum_view.hpp"
#include "views/concentric_view.hpp"
#include "views/waterfall_view.hpp"

namespace gui {

class SettingsPage {
public:
    // Render settings controls; values are edited in-place
    void render(float& center_frequency_hz,
                int& precise_fft_size,
                int& precise_decimation,
                float& precise_window_seconds,
                int& frontend_decimation,
                SpectrumView& spectrum_view,
                WaterfallView* waterfall_view,
                int& waterfall_stride,
                ConcentricView* concentric_view = nullptr);
};

} // namespace gui


