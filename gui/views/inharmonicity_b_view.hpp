#pragma once

#include <imgui.h>
#include <vector>
#include "tuning/notes_state.hpp"

namespace gui {

class InharmonicityBView {
public:
    float y_max_B = 0.008f; // display range for B (0 .. y_max_B)
    bool show_harmonic[9] = {false,false,true,true,true,true,true,true,true}; // 2..8 default on
    ImVec4 color_h[9] = {
        ImVec4(0,0,0,0),
        ImVec4(0,0,0,0),
        ImVec4(0.90f,0.30f,0.30f,1.0f), // H2
        ImVec4(0.30f,0.90f,0.30f,1.0f), // H3
        ImVec4(0.30f,0.30f,0.90f,1.0f), // H4
        ImVec4(0.90f,0.90f,0.30f,1.0f), // H5
        ImVec4(0.90f,0.30f,0.90f,1.0f), // H6
        ImVec4(0.30f,0.90f,0.90f,1.0f), // H7
        ImVec4(0.90f,0.60f,0.30f,1.0f)  // H8
    };

    void draw(ImDrawList* dl,
              const ImVec2& canvas_pos,
              float width,
              float height,
              const gui::NotesState& state) const;
};

}



