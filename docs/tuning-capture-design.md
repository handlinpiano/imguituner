# Partial‑aware, low‑overhead capture and display (technician‑friendly)

## Technician vocabulary (display contract)
- We always display partials as H1, H2, H3, … relative to the note being tuned.
- H1 (Fundamental) is the reference: ratio = 1.000000, cents = 0.00.
- Hk is shown as: k:1 ratio (e.g., 2.000696) and cents deviation from exact k·f1.
- Strengths are shown per partial (dB) and SNR per partial.
- Even if the DSP centers on a higher partial (e.g., tuning A1 via A3, the 4th partial), the UI still labels that signal as H4 of A1. The technician never sees “we centered at H4”; they only see “H4 of this note”.

## Partial‑aware measurement (internal)
- Physics: inharmonic partials are fk = k·f1·sqrt(1 + B·k²). Use a conservative global Bmax to derive a cents window, no magic cents.
- Center selection is practical (for SNR/resolution) and can be a higher partial, but all measurements are remapped back to Hk of the note’s fundamental for display and for ratio/cents math.
- When centering at Hm, measuring lower partials maps by division (≈ f1 = fm/m), higher by multiplication (≈ fk ≈ (k/m)·fm). Display still uses Hk labels.

## Simplest always‑on capture policy (per partial lane k)
- Gate: per‑partial SNR ≥ SNR_min; accept only if |cents| ≤ C(Bmax) (derived from Bmax).
- Strength band vs running max: accept only if score in [0.75, 0.95] of lane’s running max (drop very weak and top spikes); running max decays/rolls per cluster (below).
- Sampling: take one capture every M frames.
- Buffer: keep the last K accepted captures (or cluster them, see below).
- Estimate: trimmed median (drop top 5% by |cents|), report median cents and lane MAD.

## Rolling clusters (optional improvement)
- Form clusters of K captures (e.g., K=20) with independent running max/SNR stats.
- Discard clusters with low average SNR (silence/air). Final readout is the median of cluster medians; variability = median cluster MAD or MAD of medians.

## Progressive enablement (scales to 8 partials)
- Always enable H2. When H2 is stable (K≥Kmin and MAD small), enable H3; then H4; stop enabling when a new lane is weak/unreliable (SNR low, out of physics window). Disable lanes if SNR collapses.
- Heuristic: enable H3 only if mag2/mag1 ≥ r2_min (e.g., 10%), similarly for higher lanes with smaller ratios.

## Inharmonicity (B) estimation (lightweight, optional)
- After lanes are stable, fit B by minimizing Σ ρ(|fk(B) − f̂k|) over available lanes (k≥2), where fk(B) = k·f1·sqrt(1 + B·k²), using a short 1‑variable search over B ∈ [Bmin, Bmax].
- Show: B, fitted k:1 ratios and cents per lane, residual MAD.

## Edge cases
- Long sustains: age captures (keep last few seconds or last N captures) to avoid late low‑SNR bias.
- Short sustains: relax trimming when captures are few; indicate “insufficient samples” below a small floor.
- Attack: ignore first ~150 ms after onset; measure in sustain.

## Parameters (few, grounded)
- Bmax (global) → cents window C(Bmax). Example: Bmax≈0.006 → C≈15 cents.
- SNR_min (peak/mean), small and per partial.
- Strength band [0.75, 0.95] of running max (cluster‑local).
- M (capture period), K (captures per cluster), Kmin (for stability flag).

## Implementation notes
- NotesState owns lanes (k=1..8): per‑lane gate/buffer/median/MAD, running max, SNR.
- NotesController renders technician view: H1 fixed at 1.000000 (0.00 c), Hk shows median ratio and cents; strengths in dB, SNR; no mention of internal centers.
- Inharmonicity window runs the tiny B fit when lanes are stable.
