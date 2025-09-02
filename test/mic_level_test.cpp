#include <alsa/asoundlib.h>
#include <iostream>
#include <vector>
#include <cmath>
#include <atomic>
#include <signal.h>
#include <iomanip>

std::atomic<bool> running(true);

void signal_handler(int) {
    running = false;
}

// Simple VU meter display
void draw_meter(float level_db) {
    const int meter_width = 50;
    const float min_db = -60.0f;
    const float max_db = 0.0f;
    
    // Clamp to range
    level_db = std::max(min_db, std::min(max_db, level_db));
    
    // Map to meter position
    int filled = static_cast<int>((level_db - min_db) / (max_db - min_db) * meter_width);
    
    std::cout << "\r[";
    for (int i = 0; i < meter_width; ++i) {
        if (i < filled) {
            if (level_db > -6) {
                std::cout << "#";  // Red zone
            } else if (level_db > -12) {
                std::cout << "=";  // Yellow zone
            } else {
                std::cout << "-";  // Green zone
            }
        } else {
            std::cout << " ";
        }
    }
    std::cout << "] " << std::fixed << std::setprecision(1) 
              << std::setw(6) << level_db << " dB" << std::flush;
}

int main(int argc, char* argv[]) {
    signal(SIGINT, signal_handler);
    
    // Parse arguments
    std::string device = "hw:1,0";  // Default to USB mic
    int sample_rate = 48000;
    int period_size = 256;
    
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--device" && i + 1 < argc) {
            device = argv[++i];
        } else if (arg == "--help") {
            std::cout << "Microphone Level Test\n"
                      << "Usage: " << argv[0] << " [options]\n"
                      << "  --device <name>  ALSA device (default: hw:1,0)\n"
                      << "  --help           Show this help\n";
            return 0;
        }
    }
    
    std::cout << "Microphone Level Test\n"
              << "Device: " << device << "\n"
              << "Sample Rate: " << sample_rate << " Hz\n"
              << "Press Ctrl+C to exit\n\n";
    
    // Open PCM device
    snd_pcm_t* pcm_handle;
    int err = snd_pcm_open(&pcm_handle, device.c_str(), SND_PCM_STREAM_CAPTURE, 0);
    if (err < 0) {
        std::cerr << "Cannot open device " << device << ": " << snd_strerror(err) << std::endl;
        return 1;
    }
    
    // Configure hardware parameters
    snd_pcm_hw_params_t* hw_params;
    snd_pcm_hw_params_alloca(&hw_params);
    snd_pcm_hw_params_any(pcm_handle, hw_params);
    
    // Try float format first, then S16
    snd_pcm_format_t format = SND_PCM_FORMAT_FLOAT_LE;
    err = snd_pcm_hw_params_set_format(pcm_handle, hw_params, format);
    if (err < 0) {
        format = SND_PCM_FORMAT_S16_LE;
        err = snd_pcm_hw_params_set_format(pcm_handle, hw_params, format);
        if (err < 0) {
            std::cerr << "Cannot set format: " << snd_strerror(err) << std::endl;
            snd_pcm_close(pcm_handle);
            return 1;
        }
        std::cout << "Using S16 format (float not supported)\n";
    } else {
        std::cout << "Using FLOAT format\n";
    }
    
    // Set other parameters
    snd_pcm_hw_params_set_access(pcm_handle, hw_params, SND_PCM_ACCESS_RW_INTERLEAVED);
    snd_pcm_hw_params_set_channels(pcm_handle, hw_params, 1);  // Mono
    
    unsigned int rate = sample_rate;
    snd_pcm_hw_params_set_rate_near(pcm_handle, hw_params, &rate, 0);
    
    snd_pcm_uframes_t frames = period_size;
    snd_pcm_hw_params_set_period_size_near(pcm_handle, hw_params, &frames, 0);
    
    // Apply parameters
    err = snd_pcm_hw_params(pcm_handle, hw_params);
    if (err < 0) {
        std::cerr << "Cannot set hardware parameters: " << snd_strerror(err) << std::endl;
        snd_pcm_close(pcm_handle);
        return 1;
    }
    
    // Get actual values
    snd_pcm_hw_params_get_period_size(hw_params, &frames, 0);
    snd_pcm_hw_params_get_rate(hw_params, &rate, 0);
    
    std::cout << "Actual: " << rate << " Hz, " << frames << " frames/period\n";
    std::cout << "Listening for audio...\n\n";
    
    // Prepare for capture
    snd_pcm_prepare(pcm_handle);
    
    // Allocate buffer
    std::vector<float> float_buffer(frames);
    std::vector<int16_t> int16_buffer(frames);
    
    // Main loop
    int silent_count = 0;
    while (running.load()) {
        int frames_read;
        
        if (format == SND_PCM_FORMAT_FLOAT_LE) {
            frames_read = snd_pcm_readi(pcm_handle, float_buffer.data(), frames);
        } else {
            frames_read = snd_pcm_readi(pcm_handle, int16_buffer.data(), frames);
            // Convert S16 to float
            for (size_t i = 0; i < frames; ++i) {
                float_buffer[i] = int16_buffer[i] / 32768.0f;
            }
        }
        
        if (frames_read < 0) {
            if (frames_read == -EPIPE) {
                std::cout << "\nBuffer overrun, recovering...\n";
                snd_pcm_prepare(pcm_handle);
            }
            continue;
        }
        
        // Calculate RMS level
        float sum_squares = 0.0f;
        float peak = 0.0f;
        for (int i = 0; i < frames_read; ++i) {
            float sample = float_buffer[i];
            sum_squares += sample * sample;
            peak = std::max(peak, std::abs(sample));
        }
        
        float rms = std::sqrt(sum_squares / frames_read);
        float rms_db = 20.0f * std::log10(std::max(1e-10f, rms));
        float peak_db = 20.0f * std::log10(std::max(1e-10f, peak));
        
        // Display level meter
        draw_meter(rms_db);
        
        // Additional info
        if (rms_db < -50.0f) {
            silent_count++;
            if (silent_count == 10) {
                std::cout << " (No signal detected - check mic connection)";
            }
        } else {
            silent_count = 0;
            if (peak_db > -3.0f) {
                std::cout << " CLIPPING!";
            }
        }
    }
    
    std::cout << "\n\nShutting down...\n";
    snd_pcm_close(pcm_handle);
    
    return 0;
}