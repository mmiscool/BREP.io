#pragma once

#include <emscripten/val.h>

namespace manifoldplus {

emscripten::val BuildSweepAuthoringState(const emscripten::val& options);
emscripten::val BuildRevolveAuthoringState(const emscripten::val& options);

}  // namespace manifoldplus
