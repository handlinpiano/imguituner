#pragma once

#include <string>
#include "analysis/octave_lock_tracker.hpp"

namespace tuner { struct SessionSettings; }

namespace gui {

struct NotesStateReading {
    float f0_hz = 0.0f;
    float f2_hz = 0.0f;
    float f3_hz = 0.0f;
    float f4_hz = 0.0f;
    float mag0 = 0.0f;
    float mag2 = 0.0f;
    float mag3 = 0.0f;
    float mag4 = 0.0f;
    float snr0 = 0.0f;
    float snr2 = 0.0f;
    float snr3 = 0.0f;
    float snr4 = 0.0f;
};

class NotesState {
public:
    void update_from_session(const tuner::SessionSettings& s);
    void set_key_index(int idx); // 0..87
    int key_index() const { return key_index_; }
    void set_preferred_partial_k(int k) { preferred_partial_k_ = k < 1 ? 1 : k; }
    int preferred_partial_k() const { return preferred_partial_k_; }

    void ingest_measurement(const NotesStateReading& r);

    float center_frequency_hz() const { return center_hz_; }
    const OctaveLockTracker& tracker() const { return tracker_; }
    OctaveLockTracker& tracker() { return tracker_; }

private:
    int key_index_ = 48; // A4
    int preferred_partial_k_ = 1; // center on this partial (e.g., 2 for A3 start)
    float center_hz_ = 440.0f;
    OctaveLockTracker tracker_{};
    struct NoteAnalysis { bool has_b=false; float B=0.0f; float f1_inferred=0.0f; };
    NoteAnalysis per_note_[88]{};
};

}


