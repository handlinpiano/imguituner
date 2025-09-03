#include "waterfall_view.hpp"
#include <algorithm>
#include <cmath>
#include <GLES3/gl3.h>

namespace gui {

WaterfallView::WaterfallView() {
    // Initialize with empty history
    history_.clear();
    filled_rows_ = 0;
    current_cols_ = 0;
}

void WaterfallView::update(const std::vector<float>& spectrum) {
    if (spectrum.empty()) return;

    // Add new row to history
    const int cols = static_cast<int>(spectrum.size());
    if (current_cols_ != 0 && cols != current_cols_) {
        // Spectrum width changed; reset history to keep geometry consistent
        history_.clear();
        filled_rows_ = 0;
    }
    current_cols_ = cols;
    history_.push_back(spectrum);

    // Maintain maximum history size
    while (static_cast<int>(history_.size()) > max_rows) {
        history_.pop_front();
    }

    // Update filled rows count
    filled_rows_ = std::min(static_cast<int>(history_.size()), max_rows);
}

void WaterfallView::draw(ImDrawList* dl,
                        const ImVec2& canvas_pos,
                        float width,
                        float height,
                        const SpectrumView& spectrum_view) {
    if (!dl || width <= 0 || height <= 0 || history_.empty()) return;

    const ImVec2 p0 = canvas_pos;
    const ImVec2 p1 = ImVec2(canvas_pos.x + width, canvas_pos.y + height);

    // Background
    dl->AddRectFilled(p0, p1, IM_COL32(15,15,18,255));
    dl->AddRect(p0, p1, IM_COL32(60,60,60,255));

    // Draw waterfall using a GPU texture to avoid resize artifacts
    ImGui::PushClipRect(p0, p1, true);

    if (use_texture && current_cols_ > 0) {
        const int cols = current_cols_;

        // Determine desired number of rows based on row_px density
        float row_height = std::max(1.0f, row_px);
        int rows_fit = std::max(1, static_cast<int>(height / row_height));
        // Always fill height: if we have fewer rows than fit, stretch rows
        if (filled_rows_ < rows_fit) rows_fit = filled_rows_ > 0 ? filled_rows_ : 1;
        const int draw_rows = std::max(1, std::min(rows_fit, max_rows));

        // Ensure texture exists and matches [cols x draw_rows]
        if (texture_id_ == 0 || tex_w_ != cols || tex_h_ != draw_rows) {
            if (texture_id_ != 0) {
                glDeleteTextures(1, &texture_id_);
                texture_id_ = 0;
            }
            tex_w_ = cols;
            tex_h_ = draw_rows;
            tex_rgba_.assign(static_cast<size_t>(tex_w_ * tex_h_ * 4), 0);
            glGenTextures(1, &texture_id_);
            glBindTexture(GL_TEXTURE_2D, texture_id_);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, tex_w_, tex_h_, 0, GL_RGBA, GL_UNSIGNED_BYTE, tex_rgba_.data());
        } else {
            glBindTexture(GL_TEXTURE_2D, texture_id_);
        }

        // Fill software buffer from history (bottom-aligned)
        const auto& schemes = spectrum_view.schemes();
        const auto& scheme = schemes[std::max(0, std::min(static_cast<int>(schemes.size())-1, spectrum_view.color_scheme_idx))];
        const int base_index = static_cast<int>(history_.size()) - draw_rows;
        for (int r = 0; r < draw_rows; ++r) {
            int hist_index = base_index + r;
            if (hist_index < 0) hist_index = 0;
            if (hist_index >= static_cast<int>(history_.size())) hist_index = static_cast<int>(history_.size()) - 1;
            const auto& row = history_[hist_index];

            float row_max = 0.0f;
            for (int c = 0; c < cols; ++c) row_max = std::max(row_max, (c < (int)row.size() ? row[c] : 0.0f));
            if (row_max <= 0.0f) row_max = 1.0f;

            unsigned char* dst = tex_rgba_.data() + (size_t)r * tex_w_ * 4;
            for (int c = 0; c < cols; ++c) {
                float t = (c < (int)row.size() ? row[c] : 0.0f) / row_max;
                float rr = t, gg = t, bb = t;
                for (size_t si = 0; si + 1 < scheme.stops.size(); ++si) {
                    const auto& s0 = scheme.stops[si];
                    const auto& s1 = scheme.stops[si+1];
                    if (t <= s1.position) {
                        float span = (s1.position - s0.position);
                        float u = span > 0.0f ? (t - s0.position) / span : 0.0f;
                        rr = s0.r + (s1.r - s0.r) * u;
                        gg = s0.g + (s1.g - s0.g) * u;
                        bb = s0.b + (s1.b - s0.b) * u;
                        break;
                    }
                }
                dst[c*4+0] = (unsigned char)(rr * 255.0f);
                dst[c*4+1] = (unsigned char)(gg * 255.0f);
                dst[c*4+2] = (unsigned char)(bb * 255.0f);
                dst[c*4+3] = 255;
            }
        }

        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, tex_w_, tex_h_, GL_RGBA, GL_UNSIGNED_BYTE, tex_rgba_.data());

        // Draw image to fill the canvas
        ImTextureID tid = (ImTextureID)(intptr_t)texture_id_;
        dl->AddImage(tid, p0, p1, ImVec2(0, 0), ImVec2(1, 1));
    } else if (current_cols_ > 0) {
        // CPU fallback: draw rects like before (stable and GL-safe)
        float row_height = std::max(1.0f, row_px);
        const int rows_fit = std::max(1, static_cast<int>(height / row_height));
        const int available_rows = std::max(1, filled_rows_);
        int rows = rows_fit;
        if (available_rows < rows_fit) {
            rows = available_rows;
            row_height = height / std::max(1, rows);
        } else {
            rows = std::max(1, std::min(rows_fit, max_rows));
        }

        const int cols = current_cols_;
        const float bin_width = width / std::max(1, cols);
        const float y_bottom = canvas_pos.y + height;
        const float y_top = y_bottom - rows * row_height;

        const auto& schemes = spectrum_view.schemes();
        const auto& scheme = schemes[std::max(0, std::min((int)schemes.size()-1, spectrum_view.color_scheme_idx))];
        const int base_index = static_cast<int>(history_.size()) - rows;
        for (int r = 0; r < rows; ++r) {
            int hist_index = base_index + r;
            if (hist_index < 0) hist_index = 0;
            if (hist_index >= static_cast<int>(history_.size())) hist_index = static_cast<int>(history_.size()) - 1;
            const auto& spectrum_row = history_[hist_index];

            float row_max = 0.0f;
            for (int c = 0; c < cols && c < (int)spectrum_row.size(); ++c) row_max = std::max(row_max, spectrum_row[c]);
            if (row_max <= 0.0f) row_max = 1.0f;

            const float y0 = y_top + r * row_height;
            float y1 = y0 + row_height;
            if (r == rows - 1) y1 = y_bottom;

            for (int c = 0; c < cols && c < (int)spectrum_row.size(); ++c) {
                float t = spectrum_row[c] / row_max;
                float rr = t, gg = t, bb = t;
                for (size_t si = 0; si + 1 < scheme.stops.size(); ++si) {
                    const auto& s0 = scheme.stops[si];
                    const auto& s1 = scheme.stops[si+1];
                    if (t <= s1.position) {
                        float span = (s1.position - s0.position);
                        float u = span > 0.0f ? (t - s0.position) / span : 0.0f;
                        rr = s0.r + (s1.r - s0.r) * u;
                        gg = s0.g + (s1.g - s0.g) * u;
                        bb = s0.b + (s1.b - s0.b) * u;
                        break;
                    }
                }
                ImU32 col = IM_COL32((int)(rr*255.0f), (int)(gg*255.0f), (int)(bb*255.0f), 255);
                const float x0 = canvas_pos.x + c * bin_width;
                const float x1 = canvas_pos.x + (c + 1) * bin_width;
                const float clamped_x1 = (c == cols - 1) ? (canvas_pos.x + width) : x1;
                dl->AddRectFilled(ImVec2(x0, y0), ImVec2(clamped_x1, y1), col);
            }
        }
    }

    ImGui::PopClipRect();
}

void WaterfallView::clear() {
    history_.clear();
    filled_rows_ = 0;
    if (texture_id_ != 0) {
        glDeleteTextures(1, &texture_id_);
        texture_id_ = 0;
    }
    tex_w_ = tex_h_ = 0;
    tex_rgba_.clear();
}

} // namespace gui