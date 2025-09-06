#pragma once

#include "audio_input.hpp"
#include <memory>
#include <string>

namespace tuner::audio {

// Thin wrapper that owns the platform audio backend and provides
// a stable, cross-platform API for the GUI and DSP layers.
class AudioEngine {
public:
    using ProcessCallback = IAudioInput::ProcessCallback;

    explicit AudioEngine(const AudioConfig& initial_config);

    bool start();
    void stop();
    bool is_running() const;

    void set_process_callback(ProcessCallback cb);
    const AudioConfig& get_config() const { return config_; }
    void change_device(const std::string& device_name);

    IAudioInput::LatencyStats get_latency_stats() const;

private:
    void recreate_backend();

    AudioConfig config_{};
    std::unique_ptr<IAudioInput> backend_;
    ProcessCallback callback_{};
};

} // namespace tuner::audio


