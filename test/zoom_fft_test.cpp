#include "zoom_fft.hpp"
#include "audio_processor.hpp"
#include <iostream>
#include <iomanip>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <atomic>
#include <chrono>
#include <thread>
#include <signal.h>

using namespace tuner;

// Global flag for clean shutdown
std::atomic<bool> g_running(true);

void signal_handler(int /*signum*/) {
    g_running = false;
}

// Peak detection with parabolic interpolation
struct PeakInfo {
    float frequency_hz;
    float magnitude;
    float cents_error;  // Error from nearest semitone
    bool valid;  // Whether a valid peak was found
};

PeakInfo find_peak(const std::vector<float>& magnitudes, 
                   const ZoomFFT& zoom_fft, 
                   float center_freq_hz) {
    PeakInfo peak;
    peak.magnitude = 0.0f;
    peak.valid = false;
    
    // Find maximum magnitude
    auto max_it = std::max_element(magnitudes.begin(), magnitudes.end());
    if (max_it == magnitudes.end() || *max_it < 0.001f) {  // Threshold for noise floor
        peak.frequency_hz = center_freq_hz;
        peak.cents_error = 0.0f;
        peak.valid = false;
        return peak;
    }
    
    int peak_bin = std::distance(magnitudes.begin(), max_it);
    peak.magnitude = *max_it;
    peak.valid = true;
    
    // Parabolic interpolation for sub-bin accuracy
    if (peak_bin > 0 && peak_bin < static_cast<int>(magnitudes.size()) - 1) {
        float y1 = magnitudes[peak_bin - 1];
        float y2 = magnitudes[peak_bin];
        float y3 = magnitudes[peak_bin + 1];
        
        float a = (y1 - 2*y2 + y3) / 2.0f;
        float b = (y3 - y1) / 2.0f;
        
        if (std::abs(a) > 1e-6f) {
            float x_offset = -b / (2*a);
            if (std::abs(x_offset) < 1.0f) {
                peak_bin += x_offset;
            }
        }
    }
    
    // Convert bin to frequency
    peak.frequency_hz = zoom_fft.get_bin_frequency(peak_bin, center_freq_hz);
    
    // Calculate cents error from nearest semitone
    float semitone_ratio = std::pow(2.0f, std::round(std::log2(peak.frequency_hz / 440.0f) * 12.0f) / 12.0f);
    float nearest_note_freq = 440.0f * semitone_ratio;
    peak.cents_error = 1200.0f * std::log2(peak.frequency_hz / nearest_note_freq);
    
    return peak;
}

// Note name from frequency
std::string frequency_to_note(float freq_hz) {
    const char* note_names[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
    
    // A4 = 440 Hz, MIDI note 69
    float semitones_from_a4 = 12.0f * std::log2(freq_hz / 440.0f);
    int midi_note = std::round(69 + semitones_from_a4);
    
    if (midi_note < 0 || midi_note > 127) {
        return "---";
    }
    
    int octave = (midi_note / 12) - 1;
    int note_index = midi_note % 12;
    
    return std::string(note_names[note_index]) + std::to_string(octave);
}

// Simple console visualization
void draw_spectrum_bar(const std::vector<float>& magnitudes, float max_magnitude) {
    const int bar_width = 60;
    const int bar_height = 10;
    
    // Normalize and create histogram
    std::vector<int> histogram(bar_width, 0);
    
    for (size_t i = 0; i < magnitudes.size(); ++i) {
        int bar_index = (i * bar_width) / magnitudes.size();
        float normalized = magnitudes[i] / max_magnitude;
        int height = static_cast<int>(normalized * bar_height);
        histogram[bar_index] = std::max(histogram[bar_index], height);
    }
    
    // Draw from top to bottom
    for (int h = bar_height; h > 0; --h) {
        std::cout << "│";
        for (int w = 0; w < bar_width; ++w) {
            if (histogram[w] >= h) {
                std::cout << "█";
            } else {
                std::cout << " ";
            }
        }
        std::cout << "│" << std::endl;
    }
    
    // Draw bottom border
    std::cout << "└";
    for (int w = 0; w < bar_width; ++w) {
        std::cout << "─";
    }
    std::cout << "┘" << std::endl;
}

int main(int argc, char* argv[]) {
    // Parse command line arguments
    float target_frequency = 440.0f;  // Default to A4
    std::string device_name = "default";
    bool show_spectrum = false;
    bool multi_harmonic = false;
    
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--freq" && i + 1 < argc) {
            target_frequency = std::stof(argv[++i]);
        } else if (arg == "--device" && i + 1 < argc) {
            device_name = argv[++i];
        } else if (arg == "--spectrum") {
            show_spectrum = true;
        } else if (arg == "--harmonics") {
            multi_harmonic = true;
        } else if (arg == "--help") {
            std::cout << "Usage: " << argv[0] << " [options]\n"
                      << "Options:\n"
                      << "  --freq <hz>     Target frequency (default: 440)\n"
                      << "  --device <name> ALSA device (default: 'default')\n"
                      << "  --spectrum      Show spectrum visualization\n"
                      << "  --harmonics     Analyze multiple harmonics\n"
                      << "  --help          Show this help\n";
            return 0;
        }
    }
    
    // Install signal handler
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    
    std::cout << "Native Linux Piano Tuner - Zoom FFT Test\n"
              << "=========================================\n"
              << "Target frequency: " << target_frequency << " Hz ("
              << frequency_to_note(target_frequency) << ")\n"
              << "ALSA device: " << device_name << "\n"
              << "Press Ctrl+C to exit\n\n";
    
    // Configure Zoom FFT
    ZoomFFTConfig zoom_config;
    zoom_config.decimation = 16;
    zoom_config.fft_size = 16384;
    zoom_config.num_bins = 1200;
    zoom_config.sample_rate = 48000;
    zoom_config.use_hann = true;
    
    // Create Zoom FFT processor
    auto zoom_fft = std::make_unique<ZoomFFT>(zoom_config);
    auto multi_processor = multi_harmonic ? 
        std::make_unique<MultiRegionProcessor>(zoom_config) : nullptr;
    
    if (multi_processor) {
        multi_processor->setup_for_note(target_frequency);
    }
    
    // Configure audio
    AudioConfig audio_config;
    audio_config.device_name = device_name;
    audio_config.sample_rate = 48000;
    audio_config.period_size = 256;  // ~5ms @ 48kHz
    audio_config.num_periods = 2;
    audio_config.use_realtime_priority = true;
    
    // Statistics
    std::atomic<int> frames_processed(0);
    std::atomic<float> latest_frequency(target_frequency);
    std::atomic<float> latest_magnitude(0.0f);
    std::atomic<float> latest_cents_error(0.0f);
    
    // Create audio processor
    AudioProcessor audio(audio_config);
    
    // Set processing callback
    audio.set_process_callback([&](const float* input, int num_samples) {
        if (!g_running.load()) return;
        
        auto start = std::chrono::high_resolution_clock::now();
        
        if (multi_harmonic && multi_processor) {
            // Process multiple harmonics
            auto results = multi_processor->process_all_regions(input, num_samples);
            
            // Find strongest harmonic
            float max_mag = 0.0f;
            int strongest_harmonic = 1;
            
            for (const auto& result : results) {
                auto peak = find_peak(result.magnitudes, *zoom_fft, result.center_freq_hz);
                if (peak.magnitude > max_mag) {
                    max_mag = peak.magnitude;
                    strongest_harmonic = result.harmonic_number;
                    latest_frequency = peak.frequency_hz;
                    latest_magnitude = peak.magnitude;
                    latest_cents_error = peak.cents_error;
                }
            }
            
        } else {
            // Process single region
            auto magnitudes = zoom_fft->process(input, num_samples, target_frequency);
            auto peak = find_peak(magnitudes, *zoom_fft, target_frequency);
            
            latest_frequency = peak.frequency_hz;
            latest_magnitude = peak.magnitude;
            latest_cents_error = peak.cents_error;
            
            if (show_spectrum && frames_processed % 10 == 0) {
                // Clear screen (platform-specific)
                std::cout << "\033[2J\033[H";
                
                std::cout << "Spectrum (±120 cents around " << target_frequency << " Hz):\n";
                draw_spectrum_bar(magnitudes, *std::max_element(magnitudes.begin(), magnitudes.end()));
            }
        }
        
        auto end = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
        
        frames_processed++;
        
        // Print processing time every 100 frames
        if (frames_processed % 100 == 0) {
            std::cout << "DSP processing time: " << duration.count() / 1000.0f << " ms" << std::endl;
        }
    });
    
    // Start audio processing
    if (!audio.start()) {
        std::cerr << "Failed to start audio processing" << std::endl;
        return 1;
    }
    
    // Main display loop
    while (g_running.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        
        if (!show_spectrum) {
            // Clear line and print status
            std::cout << "\r";
            
            float freq = latest_frequency.load();
            float mag = latest_magnitude.load();
            float cents = latest_cents_error.load();
            
            std::cout << "Freq: " << std::fixed << std::setprecision(2) 
                      << freq << " Hz (" << frequency_to_note(freq) << ") | "
                      << "Cents: " << std::showpos << std::setprecision(1) 
                      << cents << " | "
                      << "Mag: " << std::noshowpos << std::setprecision(3) 
                      << mag << " | ";
            
            // Draw tuning meter
            const int meter_width = 21;
            int meter_pos = meter_width / 2 + static_cast<int>(cents / 50.0f * (meter_width / 2));
            meter_pos = std::max(0, std::min(meter_width - 1, meter_pos));
            
            std::cout << "[";
            for (int i = 0; i < meter_width; ++i) {
                if (i == meter_width / 2) {
                    std::cout << "|";
                } else if (i == meter_pos) {
                    std::cout << "█";
                } else {
                    std::cout << "-";
                }
            }
            std::cout << "]";
            
            std::cout << std::flush;
        }
        
        // Check for latency issues
        auto stats = audio.get_latency_stats();
        if (stats.xruns > 0) {
            std::cout << "\nWarning: " << stats.xruns << " buffer underruns detected" << std::endl;
        }
    }
    
    // Stop audio
    audio.stop();
    
    // Print final statistics
    std::cout << "\n\nFinal Statistics:\n";
    std::cout << "Frames processed: " << frames_processed.load() << "\n";
    
    auto stats = audio.get_latency_stats();
    std::cout << "Audio latency: "
              << "min=" << stats.min_ms << "ms, "
              << "max=" << stats.max_ms << "ms, "
              << "avg=" << stats.avg_ms << "ms\n";
    std::cout << "Buffer underruns: " << stats.xruns << "\n";
    
    return 0;
}