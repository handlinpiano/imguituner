#pragma once
#include <alsa/asoundlib.h>
#include <atomic>
#include <thread>
#include <vector>
#include <functional>
#include <memory>
#include <string>

namespace tuner {

struct AudioConfig {
    std::string device_name = "default";  // ALSA device (e.g., "hw:0", "plughw:0")
    unsigned int sample_rate = 48000;
    unsigned int period_size = 64;        // Buffer size in frames (1.3ms @ 48kHz)
    unsigned int num_periods = 2;         // Double buffering
    bool use_realtime_priority = true;
};

class AudioProcessor {
public:
    using ProcessCallback = std::function<void(const float* input, int num_samples)>;
    
    AudioProcessor(const AudioConfig& config);
    ~AudioProcessor();
    
    // Start/stop audio processing
    bool start();
    void stop();
    bool is_running() const { return running.load(); }
    
    // Set the callback for processing audio
    void set_process_callback(ProcessCallback callback) { process_callback = callback; }
    
    // Get current configuration
    const AudioConfig& get_config() const { return config; }
    
    // Get latency statistics
    struct LatencyStats {
        float min_ms;
        float max_ms;
        float avg_ms;
        int xruns;  // Buffer underruns
    };
    LatencyStats get_latency_stats() const;
    
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
    
    // Audio thread main loop
    void audio_thread_func();
    
    // ALSA setup
    bool setup_alsa();
    void cleanup_alsa();
    
    // Set realtime priority for audio thread
    void set_realtime_priority();

    // Selected sample format
    snd_pcm_format_t sample_format = SND_PCM_FORMAT_FLOAT_LE;
};

// Lock-free ring buffer for passing results between threads
template<typename T>
class RingBuffer {
public:
    explicit RingBuffer(size_t size) 
        : buffer(size), write_index(0), read_index(0) {}
    
    bool push(const T& item) {
        size_t write_idx = write_index.load(std::memory_order_relaxed);
        size_t next_idx = (write_idx + 1) % buffer.size();
        
        if (next_idx == read_index.load(std::memory_order_acquire)) {
            return false;  // Buffer full
        }
        
        buffer[write_idx] = item;
        write_index.store(next_idx, std::memory_order_release);
        return true;
    }
    
    bool pop(T& item) {
        size_t read_idx = read_index.load(std::memory_order_relaxed);
        
        if (read_idx == write_index.load(std::memory_order_acquire)) {
            return false;  // Buffer empty
        }
        
        item = buffer[read_idx];
        read_index.store((read_idx + 1) % buffer.size(), std::memory_order_release);
        return true;
    }
    
    bool get_latest(T& item) {
        size_t write_idx = write_index.load(std::memory_order_acquire);
        if (write_idx == 0) {
            return pop(item);  // Use pop if at beginning
        }
        
        size_t latest_idx = (write_idx - 1 + buffer.size()) % buffer.size();
        item = buffer[latest_idx];
        return true;
    }
    
private:
    std::vector<T> buffer;
    std::atomic<size_t> write_index;
    std::atomic<size_t> read_index;
};

} // namespace tuner