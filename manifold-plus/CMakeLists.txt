cmake_minimum_required(VERSION 3.18)
project(manifoldplus LANGUAGES CXX)

set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(MANIFOLD_TEST OFF CACHE BOOL "" FORCE)
set(MANIFOLD_PYBIND OFF CACHE BOOL "" FORCE)
set(MANIFOLD_CBIND OFF CACHE BOOL "" FORCE)
set(MANIFOLD_JSBIND ON CACHE BOOL "" FORCE)
set(MANIFOLD_STRICT ON CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

set(MANIFOLD_SOURCE_DIR ${CMAKE_CURRENT_LIST_DIR}/../vendor/manifold3d)

add_subdirectory(${MANIFOLD_SOURCE_DIR} ${CMAKE_BINARY_DIR}/vendor/manifold3d EXCLUDE_FROM_ALL)

if(NOT TARGET manifoldjs)
  message(FATAL_ERROR "Expected upstream manifoldjs target to exist.")
endif()

target_sources(
  manifoldjs
  PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/bindings.cpp
    ${CMAKE_CURRENT_LIST_DIR}/primitive_builder.cpp
    ${CMAKE_CURRENT_LIST_DIR}/mesh_to_brep_builder.cpp
    ${CMAKE_CURRENT_LIST_DIR}/sweep_builder.cpp
    ${CMAKE_CURRENT_LIST_DIR}/fillet_segment_builder.cpp
    ${CMAKE_CURRENT_LIST_DIR}/brep_solid_core.cpp
    ${CMAKE_CURRENT_LIST_DIR}/brep_solid_bindings.cpp
    ${CMAKE_CURRENT_LIST_DIR}/tube_builder.cpp
)
