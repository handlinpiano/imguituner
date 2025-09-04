#pragma once

#include <string>

namespace tuner {

// Per-session metadata and tuning parameters
struct SessionSettings {
    // Human-readable name (e.g., customer or location)
    std::string name;
    // Storage path of this session file
    std::string path;
    // Date ISO8601
    std::string created_utc;
    std::string modified_utc;

    // Example session-specific settings (extend as needed)
    std::string piano_model;
    std::string technician;
    int reference_a_hz = 440;
    // A4 pitch deviation in cents relative to 440 Hz (-30..+30)
    float a4_offset_cents = 0.0f;
    // Temperament (for now: Equal Temperament)
    std::string temperament = "Equal Temperament";
    // Instrument category (Upright, Grand)
    std::string instrument_type = "Upright";
    // Size in feet (approx) for grands
    float size_feet = 5.0f; // e.g., 4.9..9.0
    // Height in inches for uprights
    float upright_height_inches = 45.0f; // e.g., 32..66
    // Derived size label (e.g., Spinet, Console, Studio, Full Upright; Petite, Baby, ...)
    std::string instrument_size_label;
};

bool load_session_settings(const char* path, SessionSettings& out);
bool save_session_settings(const char* path, const SessionSettings& in);

}


