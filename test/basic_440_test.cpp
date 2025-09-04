#include "zoom_fft.hpp"
#include "audio_input.hpp"
#include <iostream>
#include <atomic>
#include <signal.h>

using namespace tuner;

std::atomic<bool> g_running(true);
void signal_handler(int) { g_running = false; }

int main(int argc, char* argv[]) {
    signal(SIGINT, signal_handler);
    
    std::string device = "hw:1,0";
    if (argc > 1) device = argv[1];
    
    std::cout << "Basic 440 Hz Test - Device: " << device << std::endl;
    
    // Minimal config
    ZoomFFTConfig config;
    config.sample_rate = 48000;
    config.decimation = 16;
    config.fft_size = 1024;
    config.num_bins = 100;
    
    ZoomFFT zoom(config);
    
    AudioConfig audio_config;
    audio_config.device_name = device;
    audio_config.sample_rate = 48000;
    audio_config.period_size = 256;
    
    std::atomic<float> last_magnitude(0);
    
    auto audio = createAudioInput(audio_config);
    
    audio->set_process_callback([&](const float* input, int num_samples) {
        auto mags = zoom.process(input, num_samples, 440.0f);
        
        // Find peak
        float peak = 0;
        int peak_idx = 0;
        for (size_t i = 0; i < mags.size(); ++i) {
            if (mags[i] > peak) {
                peak = mags[i];
                peak_idx = i;
            }
        }
        
        last_magnitude = peak;
    });
    
    if (!audio->start()) {
        std::cerr << "Audio failed\n";
        return 1;
    }
    
    while (g_running) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        std::cout << "Peak magnitude: " << last_magnitude.load() << std::endl;
    }
    
    return 0;
}