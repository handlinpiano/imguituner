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

## Ultra‑light inharmonicity estimation (adjacent‑triplet convergence)
- Single SNR gate: require the harmonics in use to have SNR ≥ SNR_min.
- Adjacent triplets: per frame, choose the best among (1,2,3), (2,3,4), (3,4,5), (4,5,6) subject to availability and note range.
- Pairwise B: compute B from each pair in the triplet; within‑frame B̂ = median of pairwise B’s; dispersion = MAD.
- Sanity bounds: require B̂ ∈ [Bmin(note), Bmax(note)] with conservative note‑dependent bounds.
- Convergence lock: if dispersion ≤ τ_pair and |B̂ − B̂_prev| ≤ τ_time for X consecutive frames, declare B locked. Output B̂ (or running median over last few).

## Rolling clusters (optional improvement)
- Form clusters of K captures (e.g., K=20) with independent running max/SNR stats.
- Discard clusters with low average SNR (silence/air). Final readout is the median of cluster medians; variability = median cluster MAD or MAD of medians.

## Progressive enablement (simplified)
- Not required for B estimation. We still center where SNR is best, but B uses whichever adjacent triplet is reliable that frame. Baseline initial H ranges per note remain for UI and analysis when desired.

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
- NotesState implements a convergence tracker over adjacent harmonic triplets with a single SNR gate and note‑based sanity bounds; computes B̂ and lock status.
- NotesController/Windows display Hk lanes and the inharmonicity readout (latest/locked B, which triplet used can be indicated).
