#pragma once

#include "pages/notes_state.hpp"
#include "tuner/session_settings.hpp"

namespace gui {

// Simple window to inspect captured octave/partial details and derived stats.
void render_inharmonicity_window(const NotesState& state,
                                 const tuner::SessionSettings& session,
                                 bool& open);

}


