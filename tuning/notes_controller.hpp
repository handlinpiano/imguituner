#pragma once

#include <string>
#include <vector>
#include "pages/notes_state.hpp"

// (no ImGui forward declarations required)

namespace tuner { struct SessionSettings; }

namespace gui {

// Notes & Temperament controller: source of truth for center frequency
class NotesController {
public:
    NotesController();

    // Render informational UI only
    void render(const tuner::SessionSettings& session, const NotesState& state);

    // Currently selected note name (e.g., "A4")
    const std::string& selected_note_name() const;

private:
    int selected_note_index_; // 0..87 => A0..C8
    std::vector<std::string> note_names_; // cached A0..C8

    void ensure_note_names();
    float compute_note_frequency_hz(const tuner::SessionSettings& session, int note_index) const;
};

}


