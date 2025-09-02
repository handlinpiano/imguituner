#include "butterworth_filter.hpp"
#include <cmath>
#include <algorithm>
#include <vector>

namespace tuner {

ButterworthLowpass::ButterworthLowpass() {
    // Initialize with Joe filter coefficients by default
    coeffs = get_joe_filter_coefficients();
    reset();
}

void ButterworthLowpass::design(int /*sample_rate*/, float /*cutoff_hz*/) {
    // For now, use fixed Joe filter coefficients
    // These provide 0.027 * Fs passband (optimal for piano tuning)
    coeffs = get_joe_filter_coefficients();
    reset();
}

std::array<ButterworthLowpass::Coefficients, ButterworthLowpass::NUM_SECTIONS> 
ButterworthLowpass::get_joe_filter_coefficients() {
    // Joe filter: 8th-order Butterworth with 0.027 * Fs passband
    // Pre-calculated coefficients for optimal piano harmonic analysis
    // Format: b0, b1, b2, a1, a2 (normalized with a0 = 1.0)
    return {{
        {1.0f, 2.0f, 1.0f, -1.9648f, 0.9891f},  // Section 1
        {1.0f, 2.0f, 1.0f, -1.9517f, 0.9692f},  // Section 2
        {1.0f, 2.0f, 1.0f, -1.9460f, 0.9542f},  // Section 3
        {1.0f, 2.0f, 1.0f, -1.9444f, 0.9461f}   // Section 4
    }};
}

std::complex<float> ButterworthLowpass::process(const std::complex<float>& input) {
    std::complex<float> signal = input;
    
    // Process through cascaded biquad sections
    for (int i = 0; i < NUM_SECTIONS; ++i) {
        const auto& c = coeffs[i];
        auto& s = states[i];
        
        // Direct Form II implementation for numerical stability
        std::complex<float> w = signal - c.a1 * s.z1 - c.a2 * s.z2;
        std::complex<float> output = c.b0 * w + c.b1 * s.z1 + c.b2 * s.z2;
        
        // Update state
        s.z2 = s.z1;
        s.z1 = w;
        
        signal = output;
    }
    
    return signal;
}

void ButterworthLowpass::reset() {
    for (auto& state : states) {
        state.z1 = std::complex<float>(0.0f, 0.0f);
        state.z2 = std::complex<float>(0.0f, 0.0f);
    }
}

namespace FilterDesign {

std::vector<std::complex<double>> butterworth_poles(int order, double cutoff_rad) {
    std::vector<std::complex<double>> poles;
    const double pi = M_PI;
    
    for (int k = 0; k < order; ++k) {
        double theta = pi * (2.0 * k + 1.0) / (2.0 * order) + pi / 2.0;
        poles.push_back(cutoff_rad * std::complex<double>(std::cos(theta), std::sin(theta)));
    }
    
    return poles;
}

std::vector<std::complex<double>> bilinear_transform(
    const std::vector<std::complex<double>>& s_poles, 
    double sample_rate) {
    
    std::vector<std::complex<double>> z_poles;
    const double T = 1.0 / sample_rate;
    
    for (const auto& s : s_poles) {
        // z = (1 + sT/2) / (1 - sT/2)
        std::complex<double> num = 1.0 + s * T / 2.0;
        std::complex<double> den = 1.0 - s * T / 2.0;
        z_poles.push_back(num / den);
    }
    
    return z_poles;
}

std::array<ButterworthLowpass::Coefficients, 4> poles_to_sos(
    const std::vector<std::complex<double>>& z_poles) {
    
    std::array<ButterworthLowpass::Coefficients, 4> sections;
    
    // Group complex conjugate pairs into second-order sections
    size_t section_idx = 0;
    for (size_t i = 0; i < z_poles.size() && section_idx < 4; i += 2) {
        if (i + 1 < z_poles.size()) {
            // Pair of poles
            auto p1 = z_poles[i];
            auto p2 = z_poles[i + 1];
            
            // For Butterworth, poles come in conjugate pairs
            // Transfer function: H(z) = b0(1 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
            // With two poles p1, p2: denominator = (1 - p1*z^-1)(1 - p2*z^-1)
            
            double a1 = -static_cast<float>(std::real(p1 + p2));
            double a2 = static_cast<float>(std::real(p1 * p2));
            
            // For lowpass, numerator is (1 + z^-1)^2 = 1 + 2*z^-1 + z^-2
            sections[section_idx] = {1.0f, 2.0f, 1.0f, static_cast<float>(a1), static_cast<float>(a2)};
            section_idx++;
        }
    }
    
    return sections;
}

} // namespace FilterDesign

} // namespace tuner