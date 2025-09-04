// Minimal waterfall view renderer for ImGui
#pragma once

#include <imgui.h>
#include <vector>
#include <deque>
#include "spectrum_plot.hpp"

namespace gui {

class WaterfallView {
public:
    // Options
    static constexpr int default_max_rows = 2000;  // Plenty of historical data
    int max_rows = default_max_rows;
    // Fixed pixel height per waterfall row (prevents resize stretching)
    float row_px = 12.0f;
    bool use_texture = true; // default to texture path for full-height fill
    int color_scheme_idx = 2; // independent color scheme selection

    // Independent line overlays (not tied to SpectrumView)
    bool show_target_line = true;         // 0 cents highlight
    bool show_10_cent_lines = true;
    bool show_20_cent_lines = true;
    bool show_1_cent_lines = false;       // ±1c
    bool show_2_cent_lines = false;       // ±2c
    bool show_5_cent_lines = false;       // ±5c
    ImVec4 color_target = ImVec4(0.47f, 0.78f, 1.00f, 0.90f);
    ImVec4 color_10_cent = ImVec4(0.63f, 0.63f, 0.63f, 0.70f);
    ImVec4 color_20_cent = ImVec4(0.80f, 0.80f, 0.80f, 0.80f);
    ImVec4 color_1_cent = ImVec4(0.90f, 0.20f, 0.20f, 0.85f);
    ImVec4 color_2_cent = ImVec4(0.20f, 0.90f, 0.20f, 0.85f);
    ImVec4 color_5_cent = ImVec4(0.90f, 0.70f, 0.20f, 0.85f);

    WaterfallView();

    // Add new spectrum data to the waterfall history
    void update(const std::vector<float>& spectrum);

    // Draw waterfall within the given canvas
    void draw(ImDrawList* dl,
              const ImVec2& canvas_pos,
              float width,
              float height,
              const SpectrumView& spectrum_view);

    // Clear the waterfall history
    void clear();

    // Get current number of filled rows
    int filled_rows() const { return filled_rows_; }

private:
    std::deque<std::vector<float>> history_;
    int filled_rows_ = 0;
    int current_cols_ = 0; // track consistent spectrum width

    // GPU texture-backed rendering
    unsigned int texture_id_ = 0; // GL texture id (GLuint)
    int tex_w_ = 0;
    int tex_h_ = 0;
    std::vector<unsigned char> tex_rgba_; // tex_w_ * tex_h_ * 4

    // Helper for color interpolation
    static inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
    static float fisheye_transform(float x01, float distortion);
};

} // namespace gui
