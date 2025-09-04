#include "audio_input.hpp"

#include <alsa/asoundlib.h>
#include <iostream>
#include <chrono>
#include <cstring>
#include <sys/mman.h>
#include <sched.h>
#include <thread>
#include <vector>

namespace tuner {

class AlsaAudioInput : public IAudioInput {
public:
    explicit AlsaAudioInput(const AudioConfig& cfg)
        : config(cfg), pcm_handle(nullptr), running(false),
          min_latency_ms(1000.0f), max_latency_ms(0.0f), total_latency_ms(0.0f),
          latency_count(0), xrun_count(0), sample_format(SND_PCM_FORMAT_FLOAT_LE) {}

    ~AlsaAudioInput() override { stop(); }

    bool start() override {
        if (running.load()) {
            return true;
        }
        if (!setup_alsa()) {
            return false;
        }
        running = true;
        audio_thread = std::thread(&AlsaAudioInput::audio_thread_func, this);
        if (config.use_realtime_priority) {
            set_realtime_priority();
        }
        return true;
    }

    void stop() override {
        if (!running.load()) {
            return;
        }
        running = false;
        if (audio_thread.joinable()) {
            audio_thread.join();
        }
        cleanup_alsa();
    }

    bool is_running() const override { return running.load(); }

    void set_process_callback(ProcessCallback callback) override { process_callback = callback; }

    const AudioConfig& get_config() const override { return config; }

    LatencyStats get_latency_stats() const override {
        LatencyStats stats{};
        stats.min_ms = min_latency_ms.load();
        stats.max_ms = max_latency_ms.load();
        int count = latency_count.load();
        stats.avg_ms = count > 0 ? total_latency_ms.load() / count : 0.0f;
        stats.xruns = xrun_count.load();
        return stats;
    }

private:
    AudioConfig config;
    snd_pcm_t* pcm_handle;
    std::atomic<bool> running;
    std::thread audio_thread;
    ProcessCallback process_callback;

    // Latency tracking
    mutable std::atomic<float> min_latency_ms;
    mutable std::atomic<float> max_latency_ms;
    mutable std::atomic<float> total_latency_ms;
    mutable std::atomic<int> latency_count;
    mutable std::atomic<int> xrun_count;

    snd_pcm_format_t sample_format;

    bool setup_alsa() {
        int err;
        // Build candidate device list for portability
        std::vector<std::string> candidates;
        if (!config.device_name.empty()) candidates.push_back(config.device_name);
        candidates.push_back("default");

        // Enumerate ALSA PCM hints to find capture-capable devices
        void** hints = nullptr;
        if (snd_device_name_hint(-1, "pcm", &hints) == 0 && hints) {
            std::vector<std::string> plughw;
            std::vector<std::string> hw;
            for (void** n = hints; *n != nullptr; ++n) {
                const char* name = snd_device_name_get_hint(*n, "NAME");
                const char* ioid = snd_device_name_get_hint(*n, "IOID");
                if (!name) continue;
                // Accept inputs or unspecified IOID
                if (ioid && std::strcmp(ioid, "Input") != 0) {
                    // skip outputs
                    continue;
                }
                std::string s(name);
                if (s.rfind("plughw:", 0) == 0) plughw.push_back(s);
                else if (s.rfind("hw:", 0) == 0) hw.push_back(s);
            }
            for (auto& s : plughw) candidates.push_back(s);
            for (auto& s : hw) candidates.push_back(s);
            snd_device_name_free_hint(hints);
        }

        // Try candidates in order
        std::string opened_device;
        for (const auto& dev : candidates) {
            err = snd_pcm_open(&pcm_handle, dev.c_str(), SND_PCM_STREAM_CAPTURE, 0);
            if (err == 0) { opened_device = dev; break; }
        }
        if (opened_device.empty()) {
            std::cerr << "Cannot open any audio capture device. Last tried: "
                      << (candidates.empty() ? std::string("<none>") : candidates.back())
                      << std::endl;
            return false;
        }
        // Persist the actually opened device for diagnostics
        if (opened_device != config.device_name) {
            std::cout << "Using capture device: " << opened_device << std::endl;
            config.device_name = opened_device;
        }

        snd_pcm_hw_params_t* hw_params;
        snd_pcm_hw_params_alloca(&hw_params);

        err = snd_pcm_hw_params_any(pcm_handle, hw_params);
        if (err < 0) {
            std::cerr << "Cannot initialize hardware parameters: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        err = snd_pcm_hw_params_set_access(pcm_handle, hw_params, SND_PCM_ACCESS_RW_INTERLEAVED);
        if (err < 0) {
            std::cerr << "Cannot set access type: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        sample_format = SND_PCM_FORMAT_FLOAT_LE;
        err = snd_pcm_hw_params_set_format(pcm_handle, hw_params, sample_format);
        if (err < 0) {
            sample_format = SND_PCM_FORMAT_S16_LE;
            err = snd_pcm_hw_params_set_format(pcm_handle, hw_params, sample_format);
            if (err < 0) {
                std::cerr << "Cannot set format: " << snd_strerror(err) << std::endl;
                cleanup_alsa();
                return false;
            }
        }

        err = snd_pcm_hw_params_set_channels(pcm_handle, hw_params, 1);
        if (err < 0) {
            std::cerr << "Cannot set channels: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        unsigned int rate = config.sample_rate;
        err = snd_pcm_hw_params_set_rate_near(pcm_handle, hw_params, &rate, 0);
        if (err < 0) {
            std::cerr << "Cannot set sample rate: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        if (rate != config.sample_rate) {
            std::cout << "Sample rate adjusted to " << rate << " Hz" << std::endl;
        }

        snd_pcm_uframes_t period_size = config.period_size;
        err = snd_pcm_hw_params_set_period_size_near(pcm_handle, hw_params, &period_size, 0);
        if (err < 0) {
            std::cerr << "Cannot set period size: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        if (period_size != config.period_size) {
            std::cout << "Period size adjusted to " << period_size << " frames" << std::endl;
        }

        unsigned int periods = config.num_periods;
        err = snd_pcm_hw_params_set_periods_near(pcm_handle, hw_params, &periods, 0);
        if (err < 0) {
            std::cerr << "Cannot set periods: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        // Use default buffer size chosen by ALSA for stability

        err = snd_pcm_hw_params(pcm_handle, hw_params);
        if (err < 0) {
            std::cerr << "Cannot set hardware parameters: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        err = snd_pcm_prepare(pcm_handle);
        if (err < 0) {
            std::cerr << "Cannot prepare audio interface: " << snd_strerror(err) << std::endl;
            cleanup_alsa();
            return false;
        }

        snd_pcm_hw_params_get_period_size(hw_params, &period_size, 0);
        snd_pcm_hw_params_get_rate(hw_params, &rate, 0);

        config.sample_rate = rate;
        config.period_size = static_cast<unsigned int>(period_size);

        std::cout << "ALSA configured: " << rate << " Hz, "
                  << period_size << " frames/period ("
                  << (1000.0f * period_size / rate) << " ms)" << std::endl;
        return true;
    }

    void cleanup_alsa() {
        if (pcm_handle) {
            snd_pcm_close(pcm_handle);
            pcm_handle = nullptr;
        }
    }

    void audio_thread_func() {
        if (config.use_realtime_priority) {
            mlockall(MCL_CURRENT | MCL_FUTURE);
        }

        snd_pcm_uframes_t period_size;
        snd_pcm_hw_params_t* hw_params;
        snd_pcm_hw_params_alloca(&hw_params);
        snd_pcm_hw_params_current(pcm_handle, hw_params);
        snd_pcm_hw_params_get_period_size(hw_params, &period_size, nullptr);

        std::vector<float> buffer_f;
        std::vector<int16_t> buffer_s16;
        if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
            buffer_f.resize(period_size);
        } else {
            buffer_s16.resize(period_size);
        }

        while (running.load()) {
            auto start_time = std::chrono::high_resolution_clock::now();

            int frames_read = 0;
            if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
                frames_read = snd_pcm_readi(pcm_handle, buffer_f.data(), period_size);
            } else {
                frames_read = snd_pcm_readi(pcm_handle, buffer_s16.data(), period_size);
            }

            if (frames_read < 0) {
                if (frames_read == -EPIPE) {
                    xrun_count++;
                    snd_pcm_prepare(pcm_handle);
                } else if (frames_read == -EAGAIN) {
                    continue;
                } else {
                    std::cerr << "Read error: " << snd_strerror(frames_read) << std::endl;
                    break;
                }
            } else if (frames_read > 0) {
                if (process_callback) {
                    if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
                        process_callback(buffer_f.data(), frames_read);
                    } else {
                        if (buffer_f.size() < static_cast<size_t>(frames_read)) buffer_f.resize(frames_read);
                        const float scale = 1.0f / 32768.0f;
                        for (int i = 0; i < frames_read; ++i) buffer_f[i] = static_cast<float>(buffer_s16[i]) * scale;
                        process_callback(buffer_f.data(), frames_read);
                    }
                }

                auto end_time = std::chrono::high_resolution_clock::now();
                auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
                float latency_ms = duration.count() / 1000.0f;

                float current_min = min_latency_ms.load();
                while (latency_ms < current_min && !min_latency_ms.compare_exchange_weak(current_min, latency_ms));

                float current_max = max_latency_ms.load();
                while (latency_ms > current_max && !max_latency_ms.compare_exchange_weak(current_max, latency_ms));

                total_latency_ms.store(total_latency_ms.load() + latency_ms);
                latency_count.store(latency_count.load() + 1);
            }
        }

        if (config.use_realtime_priority) {
            munlockall();
        }
    }

    void set_realtime_priority() {
        struct sched_param param;
        param.sched_priority = sched_get_priority_max(SCHED_FIFO) - 1;
        if (pthread_setschedparam(audio_thread.native_handle(), SCHED_FIFO, &param) != 0) {
            std::cerr << "Warning: Could not set realtime priority. Run with sudo or configure limits.conf" << std::endl;
        }
    }
};

std::unique_ptr<IAudioInput> createAudioInput(const AudioConfig& config) {
    return std::make_unique<AlsaAudioInput>(config);
}

} // namespace tuner


