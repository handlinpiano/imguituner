#pragma once

#include <vector>
#include <complex>

namespace tuner::fft {

// In-place iterative radix-2 FFT using cached bit-reversal and twiddles.
// Size must be a power of two.
void compute_fft_inplace(std::vector<std::complex<float>>& data);

} // namespace tuner::fft


