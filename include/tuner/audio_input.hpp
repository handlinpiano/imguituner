#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>

namespace tuner {

struct AudioConfig {
    std::string device_name = "default";
    unsigned int sample_rate = 48000;
    unsigned int period_size = 64;
    unsigned int num_periods = 2;
    bool use_realtime_priority = true;
};

class IAudioInput {
public:
    using ProcessCallback = std::function<void(const float* input, int num_samples)>;

    virtual ~IAudioInput() = default;

    virtual bool start() = 0;
    virtual void stop() = 0;
    virtual bool is_running() const = 0;

    virtual void set_process_callback(ProcessCallback callback) = 0;
    virtual const AudioConfig& get_config() const = 0;

    struct LatencyStats {
        float min_ms;
        float max_ms;
        float avg_ms;
        int xruns;
    };
    virtual LatencyStats get_latency_stats() const = 0;
};

// Factory that returns the active platform backend
std::unique_ptr<IAudioInput> createAudioInput(const AudioConfig& config);

} // namespace tuner


