#include "fft_utils.hpp"
#include <unordered_map>
#include <cmath>

namespace tuner::fft {

static std::unordered_map<int, std::vector<int>> g_bitrev;
static std::unordered_map<int, std::vector<std::vector<std::complex<float>>>> g_twiddles;

static const std::vector<int>& get_or_build_bitrev(int n) {
    auto it = g_bitrev.find(n);
    if (it != g_bitrev.end()) return it->second;
    int bits = 0; while ((1 << bits) < n) ++bits;
    std::vector<int> br(n);
    for (int i = 0; i < n; ++i) {
        unsigned int v = static_cast<unsigned int>(i);
        unsigned int r = 0;
        for (int b = 0; b < bits; ++b) { r = (r << 1) | (v & 1u); v >>= 1; }
        br[i] = static_cast<int>(r);
    }
    auto [ins, _] = g_bitrev.emplace(n, std::move(br));
    return ins->second;
}

static const std::vector<std::vector<std::complex<float>>>& get_or_build_twiddles(int n) {
    auto it = g_twiddles.find(n);
    if (it != g_twiddles.end()) return it->second;
    const float two_pi = 6.28318530717958647692f;
    std::vector<std::vector<std::complex<float>>> stages;
    for (int len = 2; len <= n; len <<= 1) {
        const float angle = -two_pi / static_cast<float>(len);
        const std::complex<float> wlen(std::cos(angle), std::sin(angle));
        const int half = len / 2;
        std::vector<std::complex<float>> stage(half);
        std::complex<float> w(1.0f, 0.0f);
        for (int k = 0; k < half; ++k) { stage[k] = w; w *= wlen; }
        stages.push_back(std::move(stage));
    }
    auto [ins, _] = g_twiddles.emplace(n, std::move(stages));
    return ins->second;
}

void compute_fft_inplace(std::vector<std::complex<float>>& data) {
    const int n = static_cast<int>(data.size());
    if (n <= 1) return;

    // Bit-reversal
    const auto& br = get_or_build_bitrev(n);
    std::vector<std::complex<float>> tmp(n);
    for (int i = 0; i < n; ++i) tmp[br[i]] = data[i];
    data.swap(tmp);

    // Iterative radix-2
    const auto& stages = get_or_build_twiddles(n);
    int stageIndex = 0;
    for (int len = 2; len <= n; len <<= 1, ++stageIndex) {
        const auto& W = stages[stageIndex];
        for (int i = 0; i < n; i += len) {
            for (int k = 0; k < len / 2; ++k) {
                const auto u = data[i + k];
                const auto v = data[i + k + len / 2] * W[k];
                data[i + k] = u + v;
                data[i + k + len / 2] = u - v;
            }
        }
    }
}

} // namespace tuner::fft


