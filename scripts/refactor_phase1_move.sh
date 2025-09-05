#!/usr/bin/env bash
set -euo pipefail
cd /home/cody/Projects/alsa_project

# Create new structure
mkdir -p gui/windows gui/views dsp/analysis examples/{cpp,plots}

# 1) GUI "plots" → "views" (rename files only; keep class names)
if [ -f gui/plots/spectrum_plot.hpp ]; then git mv gui/plots/spectrum_plot.hpp gui/views/spectrum_view.hpp; fi
if [ -f gui/plots/spectrum_plot.cpp ]; then git mv gui/plots/spectrum_plot.cpp gui/views/spectrum_view.cpp; fi

if [ -f gui/plots/waterfall_plot.hpp ]; then git mv gui/plots/waterfall_plot.hpp gui/views/waterfall_view.hpp; fi
if [ -f gui/plots/waterfall_plot.cpp ]; then git mv gui/plots/waterfall_plot.cpp gui/views/waterfall_view.cpp; fi

if [ -f gui/plots/concentric_plot.hpp ]; then git mv gui/plots/concentric_plot.hpp gui/views/concentric_view.hpp; fi
if [ -f gui/plots/concentric_plot.cpp ]; then git mv gui/plots/concentric_plot.cpp gui/views/concentric_view.cpp; fi

if [ -f gui/plots/long_analysis_plot.hpp ]; then git mv gui/plots/long_analysis_plot.hpp gui/views/long_analysis_view.hpp; fi
if [ -f gui/plots/long_analysis_plot.cpp ]; then git mv gui/plots/long_analysis_plot.cpp gui/views/long_analysis_view.cpp; fi

# 2) Settings page → window (keep class name "SettingsPage" inside the renamed file)
if [ -f gui/plots/settings_page.cpp ]; then git mv gui/plots/settings_page.cpp gui/windows/settings_window.cpp; fi
if [ -f gui/settings_page.hpp ]; then git mv gui/settings_page.hpp gui/windows/settings_window.hpp; fi

# 3) Move GUI analysis:
#    - Rendering window stays in gui/windows
#    - Logic engines move to dsp/analysis
if [ -f gui/analysis/inharmonicity_window.hpp ]; then git mv gui/analysis/inharmonicity_window.hpp gui/windows/inharmonicity_window.hpp; fi
if [ -f gui/analysis/inharmonicity_window.cpp ]; then git mv gui/analysis/inharmonicity_window.cpp gui/windows/inharmonicity_window.cpp; fi

if [ -f gui/analysis/long_analysis_engine.hpp ]; then git mv gui/analysis/long_analysis_engine.hpp dsp/analysis/long_analysis_engine.hpp; fi
if [ -f gui/analysis/long_analysis_engine.cpp ]; then git mv gui/analysis/long_analysis_engine.cpp dsp/analysis/long_analysis_engine.cpp; fi

if [ -f gui/analysis/octave_lock_tracker.hpp ]; then git mv gui/analysis/octave_lock_tracker.hpp dsp/analysis/octave_lock_tracker.hpp; fi
if [ -f gui/analysis/octave_lock_tracker.cpp ]; then git mv gui/analysis/octave_lock_tracker.cpp dsp/analysis/octave_lock_tracker.cpp; fi

# 4) Pages:
#    - Visual pages are windows
#    - Notes logic moves to tuning/
mkdir -p tuning
for f in landing_page.hpp landing_page.cpp new_session_setup.hpp new_session_setup.cpp mic_setup.hpp mic_setup.cpp; do
  if [ -f gui/pages/$f ]; then git mv gui/pages/$f gui/windows/$f; fi
done

if [ -f gui/pages/notes_controller.hpp ]; then git mv gui/pages/notes_controller.hpp tuning/notes_controller.hpp; fi
if [ -f gui/pages/notes_controller.cpp ]; then git mv gui/pages/notes_controller.cpp tuning/notes_controller.cpp; fi
if [ -f gui/pages/notes_state.hpp ]; then git mv gui/pages/notes_state.hpp tuning/notes_state.hpp; fi
if [ -f gui/pages/notes_state.cpp ]; then git mv gui/pages/notes_state.cpp tuning/notes_state.cpp; fi

# 5) Examples: consolidate
if [ -d example_cpp ]; then git mv example_cpp examples/cpp; fi
if [ -d example_plots ]; then git mv example_plots examples/plots; fi

echo "Phase 1 moves complete."


