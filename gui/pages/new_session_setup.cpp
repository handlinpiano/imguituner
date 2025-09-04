#include "pages/new_session_setup.hpp"
#include "tuner/session_settings.hpp"
#include <imgui.h>
#include <cmath>
#include <ctime>
#include <string>
#include <algorithm>

namespace gui {

// Removed auto-suggest: user provides the session name directly.

void render_new_session_setup(tuner::SessionSettings& draft, const NewSessionCallbacks& cb) {
    ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings;
    if (ImGui::Begin("New Session Setup", nullptr, flags)) {
        ImGui::TextUnformatted("Create New Tuning Session");
        ImGui::Separator();
        // No session name input; the file will be auto-named when creating the session.

        // Temperament
        const char* temp_items[] = { "Equal Temperament" };
        int temp_idx = 0;
        if (ImGui::BeginCombo("Temperament", temp_items[temp_idx])) {
            bool selected = true; // only one for now
            if (ImGui::Selectable(temp_items[0], selected)) {
                draft.temperament = temp_items[0];
            }
            if (selected) ImGui::SetItemDefaultFocus();
            ImGui::EndCombo();
        }

        // A4 offset (cents) and display current Hz
        ImGui::Separator();
        ImGui::TextUnformatted("Reference A4");
        ImGui::SliderFloat("Offset (cents)", &draft.a4_offset_cents, -30.0f, 30.0f, "%.1f cents");
        // A4 frequency from cents offset: f = 440 * 2^(cents/1200)
        float a4_hz = 440.0f * powf(2.0f, draft.a4_offset_cents / 1200.0f);
        ImGui::SameLine();
        ImGui::Text("(%.2f Hz)", a4_hz);

        ImGui::Separator();
        // Instrument type
        int type_idx = (draft.instrument_type == "Grand") ? 1 : 0;
        ImGui::TextUnformatted("Instrument Type");
        if (ImGui::RadioButton("Upright", type_idx == 0)) { type_idx = 0; draft.instrument_type = "Upright"; }
        ImGui::SameLine();
        if (ImGui::RadioButton("Grand", type_idx == 1)) { type_idx = 1; draft.instrument_type = "Grand"; }

        // Update size label helper
        auto update_label = [&]() {
            if (type_idx == 1) {
                float ft = draft.size_feet;
                const char* label = "Grand";
                if (ft < 5.3f) label = "Petite Grand";       // ~4'11"–5'3"
                else if (ft < 5.8f) label = "Baby Grand";     // ~5'3"–5'8"
                else if (ft < 6.6f) label = "Medium Grand";   // ~5'9"–6'6"
                else if (ft < 7.0f) label = "Parlor/Salon Grand";
                else if (ft < 8.5f) label = "Semi-Concert Grand";
                else label = "Concert Grand";                 // ~9'0"
                draft.instrument_size_label = label;
            } else {
                float in = draft.upright_height_inches;
                const char* label = "Upright";
                if (in <= 36.0f) label = "Spinet";           // ~32–36"
                else if (in <= 43.0f) label = "Console";      // ~40–43"
                else if (in <= 52.0f) label = "Studio";       // ~45–52"
                else label = "Full Upright";                  // ~52–66"
                draft.instrument_size_label = label;
            }
        };

        if (type_idx == 1) {
            // Grand sizing in feet
            ImGui::TextUnformatted("Approx. Size (feet)");
            if (ImGui::SliderFloat("Size", &draft.size_feet, 4.9f, 9.0f, "%.2f ft")) { update_label(); }
            ImGui::SameLine();
            ImGui::TextDisabled("(petite 4'11\" to concert 9'0\")");
        } else {
            // Upright sizing in fractional feet (internally stored as inches)
            float height_ft = draft.upright_height_inches / 12.0f;
            ImGui::TextUnformatted("Height (feet)");
            if (ImGui::SliderFloat("Height##upright_feet", &height_ft, 2.67f, 5.50f, "%.2f ft")) {
                draft.upright_height_inches = height_ft * 12.0f; update_label(); }
            ImGui::SameLine();
            ImGui::TextDisabled("(spinet ~2.67 ft to full upright ~5.50 ft)");
            ImGui::Text("~%.0f in", draft.upright_height_inches);
        }

        // Show current derived label
        update_label();
        ImGui::Text("Size class: %s", draft.instrument_size_label.c_str());

        // No auto-renaming; user controls the name fully.

        ImGui::Separator();
        if (ImGui::Button("Back")) { if (cb.on_cancel) cb.on_cancel(); }
        ImGui::SameLine();
        if (ImGui::Button("Create Session")) { if (cb.on_confirm) cb.on_confirm(draft); }
    }
    ImGui::End();
}

}


