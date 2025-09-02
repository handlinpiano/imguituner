#pragma once
#include <complex>
#include <array>
#include <vector>

namespace tuner {

// 8th-order Butterworth lowpass filter implemented as cascaded biquads
// Designed for complex baseband signals after heterodyne mixing
class ButterworthLowpass {
public:
    static constexpr int ORDER = 8;
    static constexpr int NUM_SECTIONS = ORDER / 2;  // 4 biquad sections
    
    struct Coefficients {
        float b0, b1, b2;  // Numerator coefficients
        float a1, a2;      // Denominator coefficients (a0 = 1.0)
    };
    
    ButterworthLowpass();
    
    // Design filter with given cutoff frequency
    // For zoom FFT: cutoff = 0.027 * sample_rate (Joe filter design)
    void design(int sample_rate, float cutoff_hz);
    
    // Get pre-calculated Joe filter coefficients (0.027 * Fs passband)
    static std::array<Coefficients, NUM_SECTIONS> get_joe_filter_coefficients();
    
    // Process single sample
    std::complex<float> process(const std::complex<float>& input);
    
    // Reset filter state
    void reset();
    
private:
    struct BiquadState {
        std::complex<float> z1{0.0f, 0.0f};
        std::complex<float> z2{0.0f, 0.0f};
    };
    
    std::array<Coefficients, NUM_SECTIONS> coeffs;
    std::array<BiquadState, NUM_SECTIONS> states;
};

// Utility functions for filter design
namespace FilterDesign {
    // Calculate Butterworth poles for given order and cutoff
    std::vector<std::complex<double>> butterworth_poles(int order, double cutoff_rad);
    
    // Convert analog poles to digital using bilinear transform
    std::vector<std::complex<double>> bilinear_transform(
        const std::vector<std::complex<double>>& s_poles, 
        double sample_rate);
    
    // Group poles into second-order sections
    std::array<ButterworthLowpass::Coefficients, 4> poles_to_sos(
        const std::vector<std::complex<double>>& z_poles);
}

} // namespace tuner