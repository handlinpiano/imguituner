#include "pages/notes_controller.hpp"
#include "tuner/session_settings.hpp"
#include <imgui.h>
#include <cmath>
#include <algorithm>

namespace gui {

static inline std::string make_note_name_from_index(int idx) {
    // idx 0..87 for A0..C8; key numbers are 1..88 with 49 = A4
    static const char* names12[] = {"A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"};
    int semitone = idx % 12;
    // A0 is MIDI 21, C8 is MIDI 108; map idx to MIDI for octave calc
    int midi = 21 + idx; // A0=21
    int octave = (midi / 12) - 1;
    int key_number = idx + 1; // 1..88
    char buf[16];
    // Example: "49 A4" (sharps only; no flats)
    std::snprintf(buf, sizeof(buf), "%d %s%d", key_number, names12[semitone], octave);
    return std::string(buf);
}

static inline std::string make_plain_note_label_from_index(int idx) {
    static const char* names12[] = {"A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"};
    int semitone = idx % 12;
    int midi = 21 + idx; // A0=21
    int octave = (midi / 12) - 1;
    char buf[16];
    std::snprintf(buf, sizeof(buf), "%s%d", names12[semitone], octave);
    return std::string(buf);
}

static inline const char* ordinal(int k) {
    switch (k) { case 1: return "1st"; case 2: return "2nd"; case 3: return "3rd"; default: return "4th"; }
}

NotesController::NotesController()
    : selected_note_index_(48) { // A4 roughly in middle (A0..C8: 88 keys, A4=idx 48)
    ensure_note_names();
}

void NotesController::ensure_note_names() {
    if (!note_names_.empty()) return;
    note_names_.reserve(88);
    for (int i = 0; i < 88; ++i) note_names_.push_back(make_note_name_from_index(i));
}

const std::string& NotesController::selected_note_name() const {
    return note_names_[std::max(0, std::min(87, selected_note_index_))];
}

// Compute ET frequency using session A4 offset and temperament (ET only for now)
float NotesController::compute_note_frequency_hz(const tuner::SessionSettings& session, int note_index) const {
    // Equal temperament mapping with A4 as reference
    // Calculate semitone offset n from A4
    // idx for A4 is 48 by our choice above
    int n = note_index - 48;
    float a4_hz = 440.0f * std::pow(2.0f, session.a4_offset_cents / 1200.0f);
    float f = a4_hz * std::pow(2.0f, n / 12.0f);
    return f;
}

void NotesController::render(const tuner::SessionSettings& session, const NotesState& state) {
    ensure_note_names();

    ImGui::TextUnformatted("Notes & Temperament");
    ImGui::Separator();

    // Accordions for small screens
    if (ImGui::CollapsingHeader("Reference", ImGuiTreeNodeFlags_DefaultOpen)) {
        // INFO ONLY: Temperament (read-only)
        ImGui::Text("Temperament: %s", session.temperament.c_str());

        // A4 readout
        float a4_hz = 440.0f * std::pow(2.0f, session.a4_offset_cents / 1200.0f);
        ImGui::Text("A4 reference: %.2f Hz (%.1f cents)", a4_hz, session.a4_offset_cents);
    }

    ImGui::Separator();

    // Current note
    if (ImGui::CollapsingHeader("Current Note", ImGuiTreeNodeFlags_DefaultOpen)) {
        int knum = selected_note_index_ + 1;
        std::string label = make_plain_note_label_from_index(selected_note_index_);
        int pk = state.preferred_partial_k();
        char partial_note[96];
        if (pk > 1) std::snprintf(partial_note, sizeof(partial_note), "%d %s — %s partial (center)", knum, label.c_str(), ordinal(pk));
        else std::snprintf(partial_note, sizeof(partial_note), "%d %s", knum, label.c_str());
        ImGui::Text("Current note: %s", partial_note);
    }

    // Computed
    float computed_center_hz = compute_note_frequency_hz(session, selected_note_index_);
    const int key_number = selected_note_index_ + 1; // 1..88
    const std::string note_label = make_plain_note_label_from_index(selected_note_index_);
    const float a4_hz_const = 440.0f * std::pow(2.0f, session.a4_offset_cents / 1200.0f);
    const float global_hz_offset = a4_hz_const - 440.0f;
    const float global_cents_offset = session.a4_offset_cents;
    const float note_offset_cents = 0.0f;
    const float custom_note_offset_cents = 0.0f;
    const float temperament_offset_cents = 0.0f;

    if (ImGui::CollapsingHeader("Computed", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::Text("Temperament: %s", session.temperament.c_str());
        ImGui::Text("Current note: %d %s", key_number, note_label.c_str());
        ImGui::Text("Frequency: %.3f Hz", computed_center_hz);
        ImGui::Text("Global offset: %.2f Hz  |  %.2f cents", global_hz_offset, global_cents_offset);
        ImGui::Text("Note offset (cents): %.2f", note_offset_cents);
        ImGui::Text("Custom note offset (cents): %.2f", custom_note_offset_cents);
        ImGui::Text("Temperament offset (cents): %.2f", temperament_offset_cents);
    }

    // Live measurement
    const auto& tr = state.tracker();
    if (ImGui::CollapsingHeader("Live 2:1 Measurement", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::Text("Captures: %d/%d | Next in: %d frames", tr.captures_count(), tr.max_captures(), tr.frames_to_next_capture());
        if (tr.last_capture_valid()) {
            auto db = [](float x){ return 20.0f * std::log10(std::max(1e-9f, x)); };
            ImGui::Text("Last capture: %.2f cents | Fundamental=%.1f dB 2nd=%.1f dB | SNR0=%.2f SNR2=%.2f",
                        tr.last_capture_cents(), db(tr.last_capture_mag0()), db(tr.last_capture_mag2()),
                        tr.last_capture_snr0(), tr.last_capture_snr2());
        } else {
            const char* reason = tr.last_capture_reason().empty() ? "n/a" : tr.last_capture_reason().c_str();
            ImGui::Text("Last capture: (rejected: %s)", reason);
        }
        if (tr.has_estimate()) {
            // Median deviation and derived ratio
            float cents_med = tr.estimate_cents();
            float r_norm = std::pow(2.0f, cents_med / 1200.0f); // normalized to 1.0 at perfect octave
            float ratio2 = 2.0f * r_norm;                        // 2nd partial ratio
            ImGui::Text("Fundamental: 1.000000 (0.00 cents)");
            ImGui::Text("2nd partial: %.6f (MED), %+.2f cents", ratio2, cents_med);
            // Approximate inharmonicity B from small-signal model: r_norm ≈ 1 + 3B/2 -> B ≈ (2/3)(r_norm - 1)
            float B_approx = (2.0f / 3.0f) * (r_norm - 1.0f);
            ImGui::Text("Inharmonicity B (approx): %.6g", B_approx);
        }
    }
}

}


