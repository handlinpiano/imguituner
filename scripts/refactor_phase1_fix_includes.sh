#!/usr/bin/env bash
set -euo pipefail
cd /home/cody/Projects/alsa_project

files=$(find . -type f \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' \) -not -path './third_party/*')

sub() {
  local from="$1"; shift
  local to="$1"; shift
  echo "Rewriting: $from -> $to"
  # shellcheck disable=SC2086
  grep -rl --null --exclude-dir=third_party -- "$from" $files | xargs -0 -r sed -i "s|$from|$to|g"
}

# plots → views
sub '#include "plots/spectrum_plot.hpp"' '#include "views/spectrum_view.hpp"'
sub '#include "plots/waterfall_plot.hpp"' '#include "views/waterfall_view.hpp"'
sub '#include "plots/concentric_plot.hpp"' '#include "views/concentric_view.hpp"'
sub '#include "plots/long_analysis_plot.hpp"' '#include "views/long_analysis_view.hpp"'

# settings page → window
sub '#include "settings_page.hpp"' '#include "windows/settings_window.hpp"'
sub '#include "plots/settings_page.hpp"' '#include "windows/settings_window.hpp"'

# analysis window moved into gui/windows
sub '#include "analysis/inharmonicity_window.hpp"' '#include "windows/inharmonicity_window.hpp"'

# analysis engines moved to dsp/analysis
sub '#include "analysis/long_analysis_engine.hpp"' '#include "dsp/analysis/long_analysis_engine.hpp"'
sub '#include "analysis/octave_lock_tracker.hpp"' '#include "dsp/analysis/octave_lock_tracker.hpp"'

# pages → windows
sub '#include "pages/landing_page.hpp"' '#include "windows/landing_page.hpp"'
sub '#include "pages/new_session_setup.hpp"' '#include "windows/new_session_setup.hpp"'
sub '#include "pages/mic_setup.hpp"' '#include "windows/mic_setup.hpp"'

# notes logic → tuning
sub '#include "pages/notes_controller.hpp"' '#include "tuning/notes_controller.hpp"'
sub '#include "pages/notes_state.hpp"' '#include "tuning/notes_state.hpp"'

echo "Include paths updated."


