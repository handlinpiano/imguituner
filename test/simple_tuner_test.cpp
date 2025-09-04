#include "zoom_fft.hpp"
#include "audio_input.hpp"
#include <iostream>
#include <iomanip>
#include <atomic>
#include <chrono>
#include <thread>
#include <signal.h>

using namespace tuner;

std::atomic<bool> g_running(true);

void signal_handler(int) {
    g_running = false;
}

int main(int argc, char* argv[]) {
    signal(SIGINT, signal_handler);
    
    float target_frequency = 440.0f;
    std::string device_name = "hw:1,0";
    
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--freq" && i + 1 < argc) {
            target_frequency = std::stof(argv[++i]);
        } else if (arg == "--device" && i + 1 < argc) {
            device_name = argv[++i];
        }
    }
    
    std::cout << "Simple Piano Tuner Test\n"
              << "Target: " << target_frequency << " Hz\n"
              << "Device: " << device_name << "\n"
              << "Press Ctrl+C to exit\n\n";
    
    // Configure Zoom FFT
    ZoomFFTConfig config;
    config.decimation = 16;
    config.fft_size = 8192;  // Smaller for faster processing
    config.num_bins = 240;   // Fewer bins for faster processing
    config.sample_rate = 48000;
    
    ZoomFFT zoom_fft(config);
    
    // Configure audio
    AudioConfig audio_config;
    audio_config.device_name = device_name;
    audio_config.sample_rate = 48000;
    audio_config.period_size = 256;
    audio_config.num_periods = 2;
    
    // Simple peak detection
    std::atomic<float> peak_freq(0.0f);
    std::atomic<float> peak_magnitude(0.0f);
    std::atomic<int> valid_detections(0);
    
    auto audio = createAudioInput(audio_config);
    
    audio->set_process_callback([&](const float* input, int num_samples) {
        if (!g_running.load()) return;
        
        auto magnitudes = zoom_fft.process(input, num_samples, target_frequency);
        
        // Find peak
        float max_mag = 0.0f;
        int peak_bin = 0;
        
        for (size_t i = 0; i < magnitudes.size(); ++i) {
            if (magnitudes[i] > max_mag) {
                max_mag = magnitudes[i];
                peak_bin = static_cast<int>(i);
            }
        }
        
        // Always update with the peak we found
        float freq = zoom_fft.get_bin_frequency(peak_bin, target_frequency);
        peak_freq.store(freq);
        peak_magnitude.store(max_mag);
        valid_detections.fetch_add(1);
    });
    
    if (!audio->start()) {
        std::cerr << "Failed to start audio\n";
        return 1;
    }
    
    // Simple status display - update every second
    auto last_detections = 0;
    while (g_running.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        
        int current_detections = valid_detections.load();
        float freq = peak_freq.load();
        float mag = peak_magnitude.load();
        
        if (current_detections > last_detections) {
            // Calculate cents error
            float cents_error = 1200.0f * std::log2(freq / target_frequency);
            
            std::cout << std::fixed << std::setprecision(1)
                      << "Detected: " << freq << " Hz ("
                      << std::showpos << cents_error << " cents) "
                      << std::noshowpos << std::setprecision(3)
                      << "mag=" << mag << " "
                      << (current_detections - last_detections) << " detections/sec"
                      << std::endl;
            
            last_detections = current_detections;
        } else {
            std::cout << "No signal detected" << std::endl;
        }
    }
    
    audio->stop();
    
    auto stats = audio->get_latency_stats();
    std::cout << "\nStats: avg=" << stats.avg_ms << "ms, xruns=" << stats.xruns << std::endl;
    
    return 0;
}