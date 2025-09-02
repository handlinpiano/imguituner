#include "zoom_fft.hpp"
#include "butterworth_filter.hpp"
#include <cmath>
#include <algorithm>
#include <cstring>

namespace tuner {

// ButterworthFilter implementation
ButterworthFilter::ButterworthFilter() 
    : decimation_factor(1), decimation_counter(0) {
}

void ButterworthFilter::configure(int sample_rate, int decimation) {
    decimation_factor = std::max(1, decimation);
    decimation_counter = 0;
    
    // Reset all sections
    for (auto& section : sections) {
        section.reset();
    }
    
    // Use Joe filter coefficients (0.027 * Fs passband)
    // These are optimal for piano harmonic analysis
    sections[0] = {1.0f, 2.0f, 1.0f, -1.9648f, 0.9891f, {0, 0}, {0, 0}};
    sections[1] = {1.0f, 2.0f, 1.0f, -1.9517f, 0.9692f, {0, 0}, {0, 0}};
    sections[2] = {1.0f, 2.0f, 1.0f, -1.9460f, 0.9542f, {0, 0}, {0, 0}};
    sections[3] = {1.0f, 2.0f, 1.0f, -1.9444f, 0.9461f, {0, 0}, {0, 0}};
}

std::complex<float> ButterworthFilter::BiquadSection::process(const std::complex<float>& x) {
    // Direct Form II implementation
    std::complex<float> w = x - a1 * z1 - a2 * z2;
    std::complex<float> y = b0 * w + b1 * z1 + b2 * z2;
    z2 = z1;
    z1 = w;
    return y;
}

void ButterworthFilter::BiquadSection::reset() {
    z1 = std::complex<float>(0.0f, 0.0f);
    z2 = std::complex<float>(0.0f, 0.0f);
}

bool ButterworthFilter::process_and_decimate(const std::complex<float>& input, 
                                             std::complex<float>& output) {
    // Process through cascade
    std::complex<float> signal = input;
    for (auto& section : sections) {
        signal = section.process(signal);
    }
    
    decimation_counter++;
    if ((decimation_counter % decimation_factor) != 0) {
        return false;  // Not ready to output
    }
    
    output = signal;
    return true;
}

void ButterworthFilter::reset() {
    for (auto& section : sections) {
        section.reset();
    }
    decimation_counter = 0;
}

// ZoomFFT implementation
ZoomFFT::ZoomFFT(const ZoomFFTConfig& cfg) 
    : config(cfg),
      fft_buffer(cfg.fft_size),
      decimated_buffer(cfg.fft_size),
      oscillator_phase(1.0f, 0.0f),
      renorm_counter(0),
      last_center_freq(440.0f) {
    
    filter.configure(config.sample_rate, config.decimation);
}

ZoomFFT::~ZoomFFT() = default;

std::vector<float> ZoomFFT::process(const float* input, int input_length, float center_freq_hz) {
    if (!input || input_length <= 0 || center_freq_hz <= 0) {
        return std::vector<float>(config.num_bins, 0.0f);
    }
    
    // Store center frequency for magnitude sampling
    last_center_freq = center_freq_hz;
    
    const float two_pi = 2.0f * M_PI;
    const float omega = two_pi * center_freq_hz / static_cast<float>(config.sample_rate);
    const std::complex<float> phase_increment(std::cos(-omega), std::sin(-omega));
    
    // Reset for new processing
    filter.reset();
    oscillator_phase = std::complex<float>(1.0f, 0.0f);
    renorm_counter = 0;
    
    // Maximum samples we can process after decimation
    const int max_decimated = std::min(config.fft_size, input_length / config.decimation);
    
    // Clear decimated buffer
    std::fill(decimated_buffer.begin(), decimated_buffer.end(), std::complex<float>(0, 0));
    
    // Heterodyne mixing + filtering + decimation
    int decimated_count = 0;
    for (int i = 0; i < input_length && decimated_count < max_decimated; ++i) {
        // Mix input with complex exponential to shift center frequency to DC
        std::complex<float> mixed = oscillator_phase * input[i];
        
        // Update oscillator
        oscillator_phase *= phase_increment;
        
        // Periodic renormalization to prevent numerical drift
        if ((++renorm_counter & 8191) == 0) {
            float mag = std::abs(oscillator_phase);
            if (mag > 0.0f) {
                oscillator_phase /= mag;
            }
        }
        
        // Filter and decimate
        std::complex<float> filtered;
        if (filter.process_and_decimate(mixed, filtered)) {
            decimated_buffer[decimated_count++] = filtered;
        }
    }
    
    // Apply window function
    if (config.use_hann) {
        apply_window(decimated_buffer);
    }
    
    // Copy to FFT buffer and zero-pad if necessary
    std::copy(decimated_buffer.begin(), decimated_buffer.end(), fft_buffer.begin());
    
    // Compute FFT
    compute_fft(fft_buffer);
    
    // Sample magnitudes at desired cent offsets
    return sample_magnitudes(fft_buffer);
}

void ZoomFFT::apply_window(std::vector<std::complex<float>>& data) {
    const float two_pi = 2.0f * M_PI;
    const int N = static_cast<int>(data.size());
    
    for (int i = 0; i < N; ++i) {
        // Hann window: 0.5 * (1 - cos(2*pi*i/(N-1)))
        float window_value = 0.5f * (1.0f - std::cos(two_pi * i / (N - 1)));
        data[i] *= window_value;
    }
}

void ZoomFFT::compute_fft(std::vector<std::complex<float>>& data) {
    const int n = static_cast<int>(data.size());
    
    // Bit-reversal permutation
    int j = 0;
    for (int i = 1; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            std::swap(data[i], data[j]);
        }
    }
    
    // Cooley-Tukey FFT
    const float two_pi = 2.0f * M_PI;
    for (int len = 2; len <= n; len <<= 1) {
        const float angle = -two_pi / len;
        const std::complex<float> wlen(std::cos(angle), std::sin(angle));
        
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

std::vector<float> ZoomFFT::sample_magnitudes(const std::vector<std::complex<float>>& spectrum) {
    std::vector<float> magnitudes(config.num_bins, 0.0f);
    
    // This matches the exact logic from zoom_engine.cpp lines 166-185
    const float fsz = static_cast<float>(config.sample_rate) / static_cast<float>(config.decimation);
    const float centsSpan = 240.0f;
    const float centsMin = -120.0f;
    
    // We need center_freq_hz but it's not passed here - it's stored during processing
    float center_freq_hz = last_center_freq;  // We'll need to store this
    
    for (int b = 0; b < config.num_bins; ++b) {
        const float cents = centsMin + centsSpan * (static_cast<float>(b) / static_cast<float>(config.num_bins - 1));
        const float targetHzAbs = center_freq_hz * std::pow(2.0f, cents / 1200.0f);
        const float basebandHz = targetHzAbs - center_freq_hz;
        
        if (std::fabs(basebandHz) > (fsz * 0.5f)) { 
            magnitudes[b] = 0.0f; 
            continue; 
        }
        
        const float binf = (basebandHz / fsz) * static_cast<float>(config.fft_size);
        const int k0 = static_cast<int>(std::floor(binf));
        const float frac = binf - static_cast<float>(k0);
        const int i0 = ((k0 % config.fft_size) + config.fft_size) % config.fft_size;
        const int i1 = (i0 + 1) % config.fft_size;
        
        const float v0 = std::abs(spectrum[i0]);
        const float v1 = std::abs(spectrum[i1]);
        magnitudes[b] = v0 * (1.0f - frac) + v1 * frac;
    }
    
    return magnitudes;
}

float ZoomFFT::get_bin_frequency(int bin_index, float center_freq_hz) const {
    if (bin_index < 0 || bin_index >= config.num_bins) {
        return center_freq_hz;
    }
    
    // Calculate cents offset for this bin
    const float cents_span = 240.0f;  // ±120 cents
    const float cents_min = -120.0f;
    float cents = cents_min + cents_span * (static_cast<float>(bin_index) / (config.num_bins - 1));
    
    // Convert to frequency
    return center_freq_hz * std::pow(2.0f, cents / 1200.0f);
}

// MultiRegionProcessor implementation
MultiRegionProcessor::MultiRegionProcessor(const ZoomFFTConfig& cfg) 
    : harmonic_frequencies(NUM_HARMONICS), base_config(cfg) {
    
    regions.reserve(NUM_HARMONICS);
    for (int i = 0; i < NUM_HARMONICS; ++i) {
        regions.emplace_back(std::make_unique<ZoomFFT>(base_config));
    }
}

void MultiRegionProcessor::setup_for_note(float fundamental_hz) {
    for (int i = 0; i < NUM_HARMONICS; ++i) {
        harmonic_frequencies[i] = fundamental_hz * (i + 1);
        
        // Adaptive decimation based on frequency
        ZoomFFTConfig harmonic_config = base_config;
        harmonic_config.decimation = select_decimation(harmonic_frequencies[i]);
        
        // Recreate ZoomFFT with new config if decimation changed
        if (harmonic_config.decimation != regions[i]->get_config().decimation) {
            regions[i] = std::make_unique<ZoomFFT>(harmonic_config);
        }
    }
}

int MultiRegionProcessor::select_decimation(float frequency_hz) const {
    // Higher frequencies can use more decimation
    // This maintains constant cents resolution
    if (frequency_hz < 500.0f) {
        return 16;
    } else if (frequency_hz < 2000.0f) {
        return 32;
    } else {
        return 64;
    }
}

std::vector<MultiRegionProcessor::RegionResult> 
MultiRegionProcessor::process_all_regions(const float* input, int input_length) {
    std::vector<RegionResult> results;
    results.reserve(NUM_HARMONICS);
    
    for (int i = 0; i < NUM_HARMONICS; ++i) {
        RegionResult result;
        result.harmonic_number = i + 1;
        result.center_freq_hz = harmonic_frequencies[i];
        result.magnitudes = regions[i]->process(input, input_length, result.center_freq_hz);
        results.push_back(std::move(result));
    }
    
    return results;
}

} // namespace tuner