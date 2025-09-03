#pragma once
#include <vector>
#include <complex>
#include <array>
#include <memory>

namespace tuner {

struct ZoomFFTConfig {
    int decimation = 16;      // Decimation factor (16 or 32 typical)
    int fft_size = 16384;      // FFT size after decimation
    int num_bins = 1200;       // Number of output bins (±120 cents)
    int sample_rate = 48000;   // Input sample rate
    bool use_hann = true;      // Use Hann window (vs rectangular)
};

class ButterworthFilter {
public:
    struct BiquadSection {
        float b0, b1, b2, a1, a2;
        std::complex<float> z1{0.0f, 0.0f};
        std::complex<float> z2{0.0f, 0.0f};
        
        std::complex<float> process(const std::complex<float>& x);
        void reset();
    };
    
    ButterworthFilter();
    void configure(int sample_rate, int decimation);
    bool process_and_decimate(const std::complex<float>& input, std::complex<float>& output);
    void reset();
    
private:
    static constexpr int NUM_SECTIONS = 4;  // 8th order = 4 biquads
    std::array<BiquadSection, NUM_SECTIONS> sections;
    int decimation_factor;
    int decimation_counter;
};

class ZoomFFT {
public:
    ZoomFFT(const ZoomFFTConfig& config);
    ~ZoomFFT();
    
    // Process input buffer and return magnitude spectrum around center frequency
    // Returns vector of magnitudes in linear scale, spanning ±120 cents
    std::vector<float> process(const float* input, int input_length, float center_freq_hz);
    
    // Get the frequency for a given bin index
    float get_bin_frequency(int bin_index, float center_freq_hz) const;
    
    // Get configuration
    const ZoomFFTConfig& get_config() const { return config; }
    
private:
    ZoomFFTConfig config;
    ButterworthFilter filter;
    std::vector<std::complex<float>> fft_buffer;
    std::vector<std::complex<float>> decimated_buffer;
    
    // Heterodyne oscillator state
    std::complex<float> oscillator_phase;
    int renorm_counter;
    float last_center_freq;
    
    // Internal FFT implementation
    void compute_fft(std::vector<std::complex<float>>& data);
    
    // Apply window function
    void apply_window(std::vector<std::complex<float>>& data);
    
    // Sample magnitude spectrum at specific cents offsets
    std::vector<float> sample_magnitudes(const std::vector<std::complex<float>>& spectrum);
};

// Multi-region processor for handling multiple harmonics
class MultiRegionProcessor {
public:
    static constexpr int NUM_HARMONICS = 8;
    
    MultiRegionProcessor(const ZoomFFTConfig& base_config);
    
    // Configure regions for a specific fundamental frequency
    void setup_for_note(float fundamental_hz);
    
    // Process all regions in parallel
    struct RegionResult {
        int harmonic_number;
        float center_freq_hz;
        std::vector<float> magnitudes;
    };
    
    std::vector<RegionResult> process_all_regions(const float* input, int input_length);
    
private:
    std::vector<std::unique_ptr<ZoomFFT>> regions;
    std::vector<float> harmonic_frequencies;
    ZoomFFTConfig base_config;
    
    // Adaptive decimation based on frequency
    int select_decimation(float frequency_hz) const;
};

} // namespace tuner