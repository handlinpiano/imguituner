#include "AudioEngine.hpp"

namespace tuner::audio {

AudioEngine::AudioEngine(const AudioConfig& initial_config) : config_(initial_config) {
    recreate_backend();
}

void AudioEngine::recreate_backend() {
    backend_ = createAudioInput(config_);
    if (callback_) backend_->set_process_callback(callback_);
}

bool AudioEngine::start() {
    if (!backend_) recreate_backend();
    return backend_ && backend_->start();
}

void AudioEngine::stop() {
    if (backend_) backend_->stop();
}

bool AudioEngine::is_running() const {
    return backend_ && backend_->is_running();
}

void AudioEngine::set_process_callback(ProcessCallback cb) {
    callback_ = cb;
    if (backend_) backend_->set_process_callback(callback_);
}

void AudioEngine::change_device(const std::string& device_name) {
    bool was_running = is_running();
    if (backend_) backend_->stop();
    config_.device_name = device_name;
    recreate_backend();
    if (was_running) backend_->start();
}

IAudioInput::LatencyStats AudioEngine::get_latency_stats() const {
    return backend_ ? backend_->get_latency_stats() : IAudioInput::LatencyStats{};
}

} // namespace tuner::audio


