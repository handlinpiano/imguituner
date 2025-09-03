#include "audio_processor.hpp"
#include <iostream>
#include <chrono>
#include <cstring>
#include <sys/mman.h>
#include <sched.h>

namespace tuner {

AudioProcessor::AudioProcessor(const AudioConfig& cfg) 
    : config(cfg),
      pcm_handle(nullptr),
      running(false),
      min_latency_ms(1000.0f),
      max_latency_ms(0.0f),
      total_latency_ms(0.0f),
      latency_count(0),
      xrun_count(0) {
}

AudioProcessor::~AudioProcessor() {
    stop();
}

bool AudioProcessor::start() {
    if (running.load()) {
        return true;  // Already running
    }
    
    if (!setup_alsa()) {
        return false;
    }
    
    running = true;
    audio_thread = std::thread(&AudioProcessor::audio_thread_func, this);
    
    if (config.use_realtime_priority) {
        set_realtime_priority();
    }
    
    return true;
}

void AudioProcessor::stop() {
    if (!running.load()) {
        return;
    }
    
    running = false;
    
    if (audio_thread.joinable()) {
        audio_thread.join();
    }
    
    cleanup_alsa();
}

bool AudioProcessor::setup_alsa() {
    int err;
    
    // Open PCM device for capture
    err = snd_pcm_open(&pcm_handle, config.device_name.c_str(), 
                       SND_PCM_STREAM_CAPTURE, 0);
    if (err < 0) {
        std::cerr << "Cannot open audio device " << config.device_name 
                  << ": " << snd_strerror(err) << std::endl;
        return false;
    }
    
    // Allocate hardware parameters
    snd_pcm_hw_params_t* hw_params;
    snd_pcm_hw_params_alloca(&hw_params);
    
    // Initialize hardware parameters
    err = snd_pcm_hw_params_any(pcm_handle, hw_params);
    if (err < 0) {
        std::cerr << "Cannot initialize hardware parameters: " 
                  << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Set access type - interleaved
    err = snd_pcm_hw_params_set_access(pcm_handle, hw_params, 
                                       SND_PCM_ACCESS_RW_INTERLEAVED);
    if (err < 0) {
        std::cerr << "Cannot set access type: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Set format - prefer float, fallback to S16
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
    
    // Set channels - mono
    err = snd_pcm_hw_params_set_channels(pcm_handle, hw_params, 1);
    if (err < 0) {
        std::cerr << "Cannot set channels: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Set sample rate
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
    
    // Set period size
    snd_pcm_uframes_t period_size = config.period_size;
    err = snd_pcm_hw_params_set_period_size_near(pcm_handle, hw_params, 
                                                  &period_size, 0);
    if (err < 0) {
        std::cerr << "Cannot set period size: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    if (period_size != config.period_size) {
        std::cout << "Period size adjusted to " << period_size << " frames" << std::endl;
    }
    
    // Set number of periods
    unsigned int periods = config.num_periods;
    err = snd_pcm_hw_params_set_periods_near(pcm_handle, hw_params, &periods, 0);
    if (err < 0) {
        std::cerr << "Cannot set periods: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Apply hardware parameters
    err = snd_pcm_hw_params(pcm_handle, hw_params);
    if (err < 0) {
        std::cerr << "Cannot set hardware parameters: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Prepare interface for use
    err = snd_pcm_prepare(pcm_handle);
    if (err < 0) {
        std::cerr << "Cannot prepare audio interface: " << snd_strerror(err) << std::endl;
        cleanup_alsa();
        return false;
    }
    
    // Get actual values
    snd_pcm_hw_params_get_period_size(hw_params, &period_size, 0);
    snd_pcm_hw_params_get_rate(hw_params, &rate, 0);

    // Persist the actual hardware values back into our config for downstream users
    config.sample_rate = rate;
    config.period_size = static_cast<unsigned int>(period_size);

    std::cout << "ALSA configured: " << rate << " Hz, " 
              << period_size << " frames/period ("
              << (1000.0f * period_size / rate) << " ms)" << std::endl;
    
    return true;
}

void AudioProcessor::cleanup_alsa() {
    if (pcm_handle) {
        snd_pcm_close(pcm_handle);
        pcm_handle = nullptr;
    }
}

void AudioProcessor::audio_thread_func() {
    // Lock memory to prevent paging
    if (config.use_realtime_priority) {
        mlockall(MCL_CURRENT | MCL_FUTURE);
    }
    
    // Get actual period size
    snd_pcm_uframes_t period_size;
    snd_pcm_hw_params_t* hw_params;
    snd_pcm_hw_params_alloca(&hw_params);
    snd_pcm_hw_params_current(pcm_handle, hw_params);
    snd_pcm_hw_params_get_period_size(hw_params, &period_size, nullptr);
    
    // Allocate buffer(s) depending on sample format
    std::vector<float> buffer_f;
    std::vector<int16_t> buffer_s16;
    if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
        buffer_f.resize(period_size);
    } else {
        buffer_s16.resize(period_size);
    }
    
    while (running.load()) {
        auto start_time = std::chrono::high_resolution_clock::now();
        
        // Read from ALSA
        int frames_read = 0;
        if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
            frames_read = snd_pcm_readi(pcm_handle, buffer_f.data(), period_size);
        } else {
            frames_read = snd_pcm_readi(pcm_handle, buffer_s16.data(), period_size);
        }
        
        if (frames_read < 0) {
            if (frames_read == -EPIPE) {
                // Buffer underrun
                xrun_count++;
                snd_pcm_prepare(pcm_handle);
            } else if (frames_read == -EAGAIN) {
                // Try again
                continue;
            } else {
                std::cerr << "Read error: " << snd_strerror(frames_read) << std::endl;
                break;
            }
        } else if (frames_read > 0) {
            // Call processing callback
            if (process_callback) {
                if (sample_format == SND_PCM_FORMAT_FLOAT_LE) {
                    process_callback(buffer_f.data(), frames_read);
                } else {
                    // Convert S16 to float in-place buffer
                    if (buffer_f.size() < static_cast<size_t>(frames_read)) buffer_f.resize(frames_read);
                    const float scale = 1.0f / 32768.0f;
                    for (int i = 0; i < frames_read; ++i) buffer_f[i] = static_cast<float>(buffer_s16[i]) * scale;
                    process_callback(buffer_f.data(), frames_read);
                }
            }
            
            // Update latency statistics
            auto end_time = std::chrono::high_resolution_clock::now();
            auto duration = std::chrono::duration_cast<std::chrono::microseconds>
                           (end_time - start_time);
            float latency_ms = duration.count() / 1000.0f;
            
            // Update atomic statistics
            float current_min = min_latency_ms.load();
            while (latency_ms < current_min && 
                   !min_latency_ms.compare_exchange_weak(current_min, latency_ms));
            
            float current_max = max_latency_ms.load();
            while (latency_ms > current_max && 
                   !max_latency_ms.compare_exchange_weak(current_max, latency_ms));
            
            total_latency_ms.store(total_latency_ms.load() + latency_ms);
            latency_count.store(latency_count.load() + 1);
        }
    }
    
    // Unlock memory
    if (config.use_realtime_priority) {
        munlockall();
    }
}

void AudioProcessor::set_realtime_priority() {
    struct sched_param param;
    param.sched_priority = sched_get_priority_max(SCHED_FIFO) - 1;
    
    if (pthread_setschedparam(audio_thread.native_handle(), SCHED_FIFO, &param) != 0) {
        std::cerr << "Warning: Could not set realtime priority. "
                  << "Run with sudo or configure limits.conf" << std::endl;
    }
}

AudioProcessor::LatencyStats AudioProcessor::get_latency_stats() const {
    LatencyStats stats;
    stats.min_ms = min_latency_ms.load();
    stats.max_ms = max_latency_ms.load();
    
    int count = latency_count.load();
    if (count > 0) {
        stats.avg_ms = total_latency_ms.load() / count;
    } else {
        stats.avg_ms = 0.0f;
    }
    
    stats.xruns = xrun_count.load();
    
    return stats;
}

} // namespace tuner