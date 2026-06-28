#pragma once

#include <emscripten/val.h>

namespace manifoldplus {

emscripten::val BuildMeshToBrepAuthoringState(const emscripten::val& options);

}  // namespace manifoldplus
