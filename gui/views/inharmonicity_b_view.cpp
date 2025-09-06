#include "inharmonicity_b_view.hpp"
#include <algorithm>
#include <cmath>

namespace gui {

static inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

void InharmonicityBView::draw(ImDrawList* dl,
                              const ImVec2& canvas_pos,
                              float width,
                              float height,
                              const gui::NotesState& state) const {
    if (!dl || width <= 0 || height <= 0) return;

    // Frame
    dl->AddRectFilled(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(20,20,20,255));
    dl->AddRect(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(60,60,60,255));

    // Axes (Y only 0..y_max_B)
    ImU32 axis_col = IM_COL32(100,100,100,200);
    dl->AddLine(ImVec2(canvas_pos.x, canvas_pos.y + height - 1.0f), ImVec2(canvas_pos.x + width, canvas_pos.y + height - 1.0f), axis_col, 1.0f);
    // Horizontal grid lines at y_max/8 steps
    for (int i = 1; i <= 8; ++i) {
        float y = canvas_pos.y + height - (height * ((float)i / 8.0f));
        dl->AddLine(ImVec2(canvas_pos.x, y), ImVec2(canvas_pos.x + width, y), IM_COL32(60,60,60,128), 1.0f);
    }

    auto y_for_B = [&](float B){
        float t = y_max_B > 0.0f ? clamp01(B / y_max_B) : 0.0f;
        return canvas_pos.y + height - t * height;
    };

    // Time axis is just sample index across width
    const int n_samples = 128;
    for (int k = 2; k <= 8; ++k) {
        if (!show_harmonic[k]) continue;
        const auto& qB = state.b_history_for_harmonic(k);
        if (qB.empty()) continue;
        ImU32 col = IM_COL32((int)(color_h[k].x*255),(int)(color_h[k].y*255),(int)(color_h[k].z*255),(int)(color_h[k].w*255));
        // Draw as connected line
        const int N = (int)qB.size();
        for (int i = 1; i < N; ++i) {
            float x0 = canvas_pos.x + ((float)(i - 1) / (float)std::max(1, n_samples - 1)) * width;
            float x1 = canvas_pos.x + ((float)i / (float)std::max(1, n_samples - 1)) * width;
            float y0 = y_for_B(qB[std::max(0, i - 1)]);
            float y1 = y_for_B(qB[i]);
            dl->AddLine(ImVec2(x0, y0), ImVec2(x1, y1), col, 2.0f);
        }
        // Label latest B at the right edge
        char buf[64];
        float Blatest = qB.back();
        snprintf(buf, sizeof(buf), "H%d: B=%.5f", k, Blatest);
        dl->AddText(ImVec2(canvas_pos.x + width - 120.0f, canvas_pos.y + 8.0f * (k - 2)), col, buf);
    }

    // Magnitude-weighted average B as a bold line
    float Bw = state.magnitude_weighted_average_b();
    if (Bw > 0.0f && std::isfinite(Bw)) {
        float y = y_for_B(Bw);
        dl->AddLine(ImVec2(canvas_pos.x, y), ImVec2(canvas_pos.x + width, y), IM_COL32(255,200,60,230), 3.0f);
        dl->AddText(ImVec2(canvas_pos.x + 6.0f, y - 18.0f), IM_COL32(255,200,60,230), "Weighted B");
    }
}

}



