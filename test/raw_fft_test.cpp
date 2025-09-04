#include "audio_input.hpp"
#include <iostream>
#include <vector>
#include <complex>
#include <cmath>
#include <algorithm>
#include <atomic>
#include <signal.h>

using namespace tuner;

std::atomic<bool> g_running(true);

void signal_handler(int) {
    g_running = false;
}

// Simple FFT for debugging
void simple_fft(std::vector<std::complex<float>>& data) {
    int n = data.size();
    
    // Bit reversal
    int j = 0;
    for (int i = 1; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(data[i], data[j]);
    }
    
    // FFT
    for (int len = 2; len <= n; len <<= 1) {
        float angle = -2.0f * M_PI / len;
        std::complex<float> wlen(std::cos(angle), std::sin(angle));
        for (int i = 0; i < n; i += len) {
            std::complex<float> w(1.0f, 0.0f);
            for (int j = 0; j < len / 2; ++j) {
                auto u = data[i + j];
                auto v = data[i + j + len/2] * w;
                data[i + j] = u + v;
                data[i + j + len/2] = u - v;
                w *= wlen;
            }
        }
    }
}

int main(int argc, char* argv[]) {
    signal(SIGINT, signal_handler);
    
    std::string device_name = "hw:1,0";
    
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--device" && i + 1 < argc) {
            device_name = argv[++i];
        }
    }
    
    std::cout << "Raw FFT Signal Test\n"
              << "Device: " << device_name << "\n"
              << "Looking for any signal...\n\n";
    
    AudioConfig audio_config;
    audio_config.device_name = device_name;
    audio_config.sample_rate = 48000;
    audio_config.period_size = 1024;  // Larger buffer for better frequency resolution
    
    std::atomic<float> max_magnitude(0.0f);
    std::atomic<float> max_frequency(0.0f);
    
    auto audio = createAudioInput(audio_config);
    
    audio->set_process_callback([&](const float* input, int num_samples) {
        if (!g_running.load() || num_samples < 512) return;
        
        // Take first 512 samples for FFT
        const int fft_size = 512;
        std::vector<std::complex<float>> fft_data(fft_size);
        
        // Copy input to complex array
        for (int i = 0; i < fft_size; ++i) {
            fft_data[i] = std::complex<float>(input[i], 0.0f);
        }
        
        // Apply simple window (Hann)
        for (int i = 0; i < fft_size; ++i) {
            float window = 0.5f * (1.0f - std::cos(2.0f * M_PI * i / (fft_size - 1)));
            fft_data[i] *= window;
        }
        
        // Compute FFT
        simple_fft(fft_data);
        
        // Find peak in meaningful frequency range (100-2000 Hz)
        float sample_rate = 48000.0f;
        int min_bin = static_cast<int>(100.0f * fft_size / sample_rate);
        int max_bin = static_cast<int>(2000.0f * fft_size / sample_rate);
        
        float peak_mag = 0.0f;
        int peak_bin = 0;
        
        for (int i = min_bin; i <= max_bin && i < fft_size/2; ++i) {
            float magnitude = std::abs(fft_data[i]);
            if (magnitude > peak_mag) {
                peak_mag = magnitude;
                peak_bin = i;
            }
        }
        
        // Convert bin to frequency
        float peak_freq = static_cast<float>(peak_bin) * sample_rate / fft_size;
        
        // Update atomics if we found a stronger signal
        float current_max = max_magnitude.load();
        if (peak_mag > current_max) {
            max_magnitude.store(peak_mag);
            max_frequency.store(peak_freq);
        }
    });
    
    if (!audio->start()) {
        std::cerr << "Failed to start audio\n";
        return 1;
    }
    
    // Display updates every 2 seconds
    while (g_running.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        
        float mag = max_magnitude.load();
        float freq = max_frequency.load();
        
        if (mag > 0.001f) {  // Very low threshold
            std::cout << "Peak: " << freq << " Hz, magnitude: " << mag << std::endl;
        } else {
            std::cout << "No significant signal (max mag: " << mag << ")" << std::endl;
        }
        
        // Reset for next measurement
        max_magnitude.store(0.0f);
        max_frequency.store(0.0f);
    }
    
    audio->stop();
    return 0;
}