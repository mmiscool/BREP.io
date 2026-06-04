# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 224
tests_run: 224
passed: 223
handled_errors: 0
failed: 1
total_elapsed_ms: 57413.958

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 5.269 | 9.527 | 14.796 |  |
| 2 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.636 | 2.018 | 3.654 |  |
| 3 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 0.972 | 1.737 | 2.709 |  |
| 4 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 1.103 | 1.593 | 2.696 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 1.387 | 1.449 | 2.836 |  |
| 6 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.547 | 1.401 | 1.949 |  |
| 7 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.545 | 1.325 | 1.869 |  |
| 8 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 3.874 | 1.055 | 4.930 |  |
| 9 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 0.824 | 1.383 | 2.207 |  |
| 10 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.350 | 1.587 | 2.937 |  |
| 11 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.816 | 1.292 | 4.107 |  |
| 12 | test_cppSolidMirror_preserves_face_metadata | passed | 4.987 | 1.198 | 6.186 |  |
| 13 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 1.977 | 1.410 | 3.387 |  |
| 14 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 76.602 | 1.475 | 78.077 |  |
| 15 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 6.188 | 1.210 | 7.398 |  |
| 16 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.490 | 1.054 | 1.544 |  |
| 17 | test_remesh_simplify_imported_fixture_stl | passed | 1884.220 | 432.861 | 2317.080 |  |
| 18 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 9.757 | 1.156 | 10.913 |  |
| 19 | test_revolve_after_union_preserves_face_reference_resolution | passed | 88.118 | 4.191 | 92.309 |  |
| 20 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 0.800 | 0.908 | 1.708 |  |
| 21 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.549 | 0.978 | 1.527 |  |
| 22 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.385 | 0.984 | 1.369 |  |
| 23 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 1.049 | 1.057 | 2.106 |  |
| 24 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 1.370 | 1.255 | 2.625 |  |
| 25 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 0.786 | 1.001 | 1.787 |  |
| 26 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.573 | 1.047 | 1.620 |  |
| 27 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.455 | 0.962 | 1.416 |  |
| 28 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.447 | 0.938 | 1.384 |  |
| 29 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.359 | 0.906 | 2.264 |  |
| 30 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 2.288 | 1.507 | 3.795 |  |
| 31 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 22.653 | 1.432 | 24.085 |  |
| 32 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 19.383 | 1.392 | 20.775 |  |
| 33 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 20.201 | 1.605 | 21.806 |  |
| 34 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 20.027 | 1.614 | 21.642 |  |
| 35 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 19.457 | 1.176 | 20.633 |  |
| 36 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 11.803 | 2.988 | 14.790 |  |
| 37 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 3.857 | 1.140 | 4.997 |  |
| 38 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.866 | 0.862 | 1.728 |  |
| 39 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 2.311 | 0.996 | 3.307 |  |
| 40 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.458 | 1.193 | 2.650 |  |
| 41 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.907 | 0.950 | 1.856 |  |
| 42 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.905 | 1.062 | 1.968 |  |
| 43 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 17.910 | 1.602 | 19.511 |  |
| 44 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 49.554 | 1.027 | 50.581 |  |
| 45 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 23.941 | 1.141 | 25.082 |  |
| 46 | test_cppTube_native_builder_reports_selected_build_mode | passed | 10.417 | 1.302 | 11.719 |  |
| 47 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 29.657 | 1.222 | 30.880 |  |
| 48 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 9.868 | 1.072 | 10.940 |  |
| 49 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.549 | 0.840 | 1.389 |  |
| 50 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.590 | 0.920 | 2.510 |  |
| 51 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.584 | 1.038 | 2.623 |  |
| 52 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 14.441 | 1.545 | 15.986 |  |
| 53 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 7.045 | 1.099 | 8.144 |  |
| 54 | test_configurator_expressions | passed | 1.668 | 1.117 | 2.785 |  |
| 55 | test_manifoldPlus_sum | passed | 0.210 | 0.808 | 1.018 |  |
| 56 | test_plane | passed | 1.170 | 0.858 | 2.028 |  |
| 57 | test_primitiveCube | passed | 4.163 | 2.956 | 7.119 |  |
| 58 | test_primitivePyramid | passed | 2.606 | 1.943 | 4.549 |  |
| 59 | test_primitiveCylinder | passed | 7.524 | 4.815 | 12.339 |  |
| 60 | test_face_source_feature_seed | passed | 7.916 | 3.131 | 11.047 |  |
| 61 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 4.456 | 0.836 | 5.292 |  |
| 62 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.768 | 0.827 | 1.594 |  |
| 63 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 12.276 | 0.984 | 13.260 |  |
| 64 | test_offsetFace_preserves_individual_edges | passed | 6.522 | 1.589 | 8.111 |  |
| 65 | test_face_thicken_planar_profile | passed | 11.473 | 1.390 | 12.863 |  |
| 66 | test_face_thicken_hole_profile | passed | 10.652 | 4.182 | 14.834 |  |
| 67 | test_face_thicken_curved_cylinder_side | passed | 145.967 | 7.123 | 153.090 |  |
| 68 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 1205.843 | 9.486 | 1215.329 |  |
| 69 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 3.084 | 0.955 | 4.039 |  |
| 70 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 75.069 | 2.910 | 77.980 |  |
| 71 | test_face_thicken_self_overlap_cylinder_side | passed | 40.104 | 2.314 | 42.418 |  |
| 72 | test_thicken_sphere_torus_union | passed | 2274.551 | 50.040 | 2324.591 |  |
| 73 | test_offsetShell_thickens_all_faces_except_selected | passed | 144.052 | 4.047 | 148.099 |  |
| 74 | test_offsetShell_preserves_source_centerlines | passed | 81.642 | 1.298 | 82.940 |  |
| 75 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.241 | 0.994 | 1.235 |  |
| 76 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 10.940 | 1.537 | 12.477 |  |
| 77 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 16.310 | 1.982 | 18.292 |  |
| 78 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 15.674 | 2.073 | 17.747 |  |
| 79 | test_primitiveCone | passed | 7.373 | 2.722 | 10.095 |  |
| 80 | test_primitiveTorus | passed | 48.454 | 23.793 | 72.246 |  |
| 81 | test_primitiveSphere | passed | 6.519 | 2.835 | 9.354 |  |
| 82 | test_feature_dimension_overlay_supports_port | passed | 0.132 | 0.665 | 0.796 |  |
| 83 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.280 | 0.619 | 0.899 |  |
| 84 | test_transform_reference_sanitize_preserves_metadata | passed | 0.154 | 0.656 | 0.810 |  |
| 85 | test_transform_reference_base_uses_face_pick_point | passed | 0.426 | 0.692 | 1.118 |  |
| 86 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.322 | 1.016 | 1.338 |  |
| 87 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.835 | 0.862 | 1.696 |  |
| 88 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.424 | 1.113 | 1.537 |  |
| 89 | test_boolean_subtract | passed | 27.347 | 2.445 | 29.792 |  |
| 90 | test_boolean_face_metadata_preserved | passed | 114.511 | 0.910 | 115.420 |  |
| 91 | test_primitive_boolean_union_preserves_face_grouping | passed | 62.617 | 4.813 | 67.430 |  |
| 92 | test_boolean_operation_target_name_preserved | passed | 12.115 | 1.938 | 14.053 |  |
| 93 | test_stlLoader | passed | 74.877 | 14.244 | 89.121 |  |
| 94 | test_import3d_decimation_reduces_triangle_count | passed | 27.571 | 21.797 | 49.368 |  |
| 95 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 25.473 | 9.898 | 35.371 |  |
| 96 | test_import3d_decimation_99_is_near_full_detail | passed | 50.909 | 35.281 | 86.189 |  |
| 97 | test_import3d_decimation_100_restores_original_geometry | passed | 36.485 | 17.795 | 54.280 |  |
| 98 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 52.014 | 6.327 | 58.341 |  |
| 99 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 35.432 | 14.638 | 50.070 |  |
| 100 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 1.793 | 3.592 | 5.385 |  |
| 101 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.705 | 0.717 | 1.422 |  |
| 102 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.541 | 0.582 | 1.123 |  |
| 103 | test_import3d_fixture_merges_faces_4_and_34 | passed | 1023.040 | 428.737 | 1451.778 |  |
| 104 | test_import3d_extract_multiple_solids_toggle | passed | 10.549 | 2.982 | 13.532 |  |
| 105 | test_SweepFace | passed | 45.760 | 14.977 | 60.737 |  |
| 106 | test_SweepFace_pathAlign_multi_loop_islands | passed | 10.723 | 2.130 | 12.853 |  |
| 107 | test_tube | passed | 117.390 | 23.993 | 141.383 |  |
| 108 | test_tube_closedLoop | passed | 57.600 | 17.818 | 75.419 |  |
| 109 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.262 | 0.665 | 0.927 |  |
| 110 | test_wire_harness_connection_endpoint_resolution | passed | 0.930 | 0.555 | 1.486 |  |
| 111 | test_sheet_custom_size_persists | passed | 0.724 | 0.650 | 1.374 |  |
| 112 | test_pmi_view_text_size_setting_normalizes | passed | 0.267 | 0.598 | 0.865 |  |
| 113 | test_pmi_view_visibility_state_normalizes | passed | 0.142 | 0.601 | 0.743 |  |
| 114 | test_pmi_view_visibility_state_round_trip | passed | 2.743 | 1.181 | 3.924 |  |
| 115 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 0.897 | 0.643 | 1.539 |  |
| 116 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.089 | 0.576 | 0.666 |  |
| 117 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.166 | 0.607 | 0.772 |  |
| 118 | test_pmi_export_render_context_applies_visibility_state | passed | 0.947 | 0.662 | 1.609 |  |
| 119 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.104 | 0.638 | 0.742 |  |
| 120 | test_sheet_clipboard_image_utils | passed | 0.683 | 0.711 | 1.394 |  |
| 121 | test_wire_harness_formboard_insert | passed | 5.023 | 0.607 | 5.630 |  |
| 122 | test_wire_harness_sheet_table_insert | passed | 1.950 | 1.041 | 2.991 |  |
| 123 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 2.303 | 0.728 | 3.031 |  |
| 124 | test_wire_harness_routes_render_as_scene_solids | passed | 5.721 | 0.618 | 6.339 |  |
| 125 | test_wire_harness_route_results_persist_in_model_json | passed | 0.765 | 0.681 | 1.446 |  |
| 126 | test_sketch_openLoop | passed | 1.180 | 1.040 | 2.220 |  |
| 127 | test_sketch_face_attachment_alignment | failed | 190.592 | 0.000 | 190.592 | FeatureHistoryError: Feature S6 (S) failed: refObj.updateWorldMatrix is not a function     at PartHistory.runHistory (file:///home/user/projects/BREP/src/PartHistory.js:733:29)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1072:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:993:28) Caused by: TypeError: refObj.updateWorldMatrix is not a function     at SketchFeature._getOrCreateBasis (file:///home/user/projects/BREP/src/features/sketch/SketchFeature.js:293:20)     at SketchFeature.run (file:///home/user/projects/BREP/src/features/sketch/SketchFeature.js:532:28)     at PartHistory.runHistory (file:///home/user/projects/BREP/src/PartHistory.js:705:57)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1072:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:993:28) |
| 128 | test_sketch_solver_topology_rect_shared_points | passed | 8.528 | 4.379 | 12.907 |  |
| 129 | test_sketch_solver_topology_coincident_chain | passed | 15.266 | 3.125 | 18.390 |  |
| 130 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 17.468 | 1.024 | 18.493 |  |
| 131 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 22.586 | 0.876 | 23.462 |  |
| 132 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 33.808 | 0.886 | 34.694 |  |
| 133 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.437 | 0.753 | 2.191 |  |
| 134 | test_sketch_solver_line_to_point_distance_constraint | passed | 4.058 | 0.776 | 4.833 |  |
| 135 | test_extrude_negative_distance_cap_alignment | passed | 4.228 | 1.824 | 6.052 |  |
| 136 | test_extrude_intersect_coplanar_face_merge | passed | 1643.602 | 23.969 | 1667.571 |  |
| 137 | test_ExtrudeFace | passed | 32.399 | 6.387 | 38.787 |  |
| 138 | test_Fillet | passed | 373.964 | 33.848 | 407.812 |  |
| 139 | test_fillet_angle | passed | 11.764 | 7.818 | 19.582 |  |
| 140 | test_fillet_corner_bridge | passed | 49.112 | 3.868 | 52.981 |  |
| 141 | test_fillet_edge_degenerate_segment | passed | 1837.449 | 60.024 | 1897.473 |  |
| 142 | test_sketch_profile_tolerant_loop_join | passed | 1420.889 | 8.160 | 1429.049 |  |
| 143 | test_fillet_compound_snapshot_resolution | passed | 1797.527 | 22.636 | 1820.163 |  |
| 144 | test_fillet_generated_history_20260321144106 | passed | 5096.611 | 145.168 | 5241.779 |  |
| 145 | test_generated_history_20260322220620 | passed | 11175.155 | 181.916 | 11357.071 |  |
| 146 | test_generated_history_20260322222832 | passed | 64.708 | 9.719 | 74.427 |  |
| 147 | test_generated_history_20260418030116 | passed | 1291.010 | 52.713 | 1343.722 |  |
| 148 | test_generated_history_20260427005357 | passed | 2466.838 | 81.570 | 2548.408 |  |
| 149 | test_generated_history_20260427005357_three_face_thicken | passed | 301.877 | 18.841 | 320.717 |  |
| 150 | test_generated_history_20260427005357_nine_face_thicken | passed | 2195.344 | 49.252 | 2244.596 |  |
| 151 | test_generated_history_20260523000414 | passed | 1632.468 | 98.693 | 1731.161 |  |
| 152 | test_generated_history_20260531201126 | passed | 171.420 | 13.154 | 184.574 |  |
| 153 | test_fillet_preserves_original_face_names | passed | 643.801 | 27.459 | 671.260 |  |
| 154 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 675.754 | 26.750 | 702.504 |  |
| 155 | test_Fillet_NonClosed | passed | 13.404 | 2.968 | 16.372 |  |
| 156 | test_fillets_more_dificult | passed | 2637.385 | 153.599 | 2790.984 |  |
| 157 | test_Chamfer | passed | 9.913 | 3.717 | 13.630 |  |
| 158 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 6.122 | 1.198 | 7.320 |  |
| 159 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 3.690 | 0.924 | 4.614 |  |
| 160 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 154.973 | 11.609 | 166.582 |  |
| 161 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 283.383 | 16.705 | 300.088 |  |
| 162 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 150.938 | 10.728 | 161.666 |  |
| 163 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 156.549 | 17.163 | 173.712 |  |
| 164 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 196.463 | 12.395 | 208.858 |  |
| 165 | test_edge_smooth_curve_fit | passed | 0.757 | 0.805 | 1.562 |  |
| 166 | test_edge_smooth_curve_fit_closed_loop | passed | 0.558 | 0.780 | 1.338 |  |
| 167 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.620 | 0.618 | 1.238 |  |
| 168 | test_edge_smooth_closed_loop_feature_selection | passed | 1.623 | 0.707 | 2.330 |  |
| 169 | test_edge_smooth_whole_solid_selection | passed | 0.436 | 0.681 | 1.118 |  |
| 170 | test_edge_smooth_face_selection | passed | 0.341 | 0.777 | 1.117 |  |
| 171 | test_smooth_with_subdivision_replaces_source_solid | passed | 40.346 | 3.468 | 43.814 |  |
| 172 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 24.774 | 1.788 | 26.563 |  |
| 173 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 56.559 | 2.055 | 58.614 |  |
| 174 | test_hole_through | passed | 49.300 | 5.351 | 54.651 |  |
| 175 | test_hole_countersink | passed | 111.239 | 8.112 | 119.351 |  |
| 176 | test_hole_counterbore | passed | 114.155 | 10.642 | 124.797 |  |
| 177 | test_hole_multi_point_cloned_cutter | passed | 238.628 | 12.254 | 250.882 |  |
| 178 | test_hole_thread_symbolic | passed | 139.177 | 9.001 | 148.178 |  |
| 179 | test_hole_thread_modeled | passed | 739.738 | 47.914 | 787.652 |  |
| 180 | test_pushFace_feature | passed | 3.841 | 2.098 | 5.939 |  |
| 181 | test_pushFace | passed | 51.396 | 6.550 | 57.946 |  |
| 182 | test_mirror | passed | 3.655 | 2.012 | 5.666 |  |
| 183 | test_history_features_basic | passed | 62.983 | 29.308 | 92.291 |  |
| 184 | test_history_expand_does_not_dirty | passed | 14.284 | 1.421 | 15.705 |  |
| 185 | test_history_test_snippet_persistent_data_allowlist | passed | 0.818 | 0.711 | 1.528 |  |
| 186 | test_selection_owning_feature_resolution | passed | 0.539 | 0.641 | 1.180 |  |
| 187 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.654 | 0.692 | 1.346 |  |
| 188 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.283 | 0.628 | 0.911 |  |
| 189 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.469 | 0.636 | 1.105 |  |
| 190 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 10.586 | 0.821 | 11.406 |  |
| 191 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 7.987 | 0.691 | 8.678 |  |
| 192 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 8.312 | 0.740 | 9.052 |  |
| 193 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 7.459 | 4.341 | 11.800 |  |
| 194 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 6.890 | 0.672 | 7.562 |  |
| 195 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 15.268 | 0.716 | 15.984 |  |
| 196 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.015 | 0.698 | 2.712 |  |
| 197 | test_visibility_hidden_state_persistence | passed | 4.298 | 1.310 | 5.608 |  |
| 198 | test_sketch_feature_scene_visibility | passed | 0.143 | 0.665 | 0.808 |  |
| 199 | test_textToFace | passed | 28.870 | 11.197 | 40.067 |  |
| 200 | test_sheetMetal_nonManifold_sm_f18 | passed | 199.570 | 0.886 | 200.456 |  |
| 201 | test_sheetMetal_tab_circular_hole_wall | passed | 19.907 | 0.795 | 20.703 |  |
| 202 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 151.824 | 0.955 | 152.779 |  |
| 203 | test_sheetMetal_cutout_context_button | passed | 0.249 | 0.783 | 1.032 |  |
| 204 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.215 | 0.793 | 1.008 |  |
| 205 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 41.623 | 6.847 | 48.470 |  |
| 206 | test_sheetMetal_cutoutEdge_flange_controls | passed | 4.038 | 0.654 | 4.692 |  |
| 207 | test_sheetMetal_corner_fillet | passed | 242.107 | 1.021 | 243.128 |  |
| 208 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 218.589 | 0.838 | 219.427 |  |
| 209 | test_sheetMetal_corner_fillet_selection_resolution | passed | 557.835 | 0.831 | 558.666 |  |
| 210 | test_sheetMetal_corner_fillet_compound_reference | passed | 435.948 | 0.888 | 436.837 |  |
| 211 | test_solidPointMinGap | passed | 1.034 | 0.905 | 1.939 |  |
| 212 | test_solidMetrics | passed | 3.170 | 1.625 | 4.795 |  |
| 213 | import_part_badBoolean | passed | 89.404 | 10.015 | 99.419 |  |
| 214 | import_part_extrudeTest | passed | 30.451 | 3.814 | 34.265 |  |
| 215 | import_part_filletFail | passed | 22.772 | 4.852 | 27.624 |  |
| 216 | import_part_fillet_angle_test.BREP | passed | 32.470 | 5.435 | 37.905 |  |
| 217 | import_part_fillet_test.BREP | passed | 1696.310 | 89.429 | 1785.739 |  |
| 218 | import_part_import_TEst.part.part | passed | 11.740 | 4.424 | 16.164 |  |
| 219 | import_part_medium_fillets.BREP | passed | 652.494 | 33.409 | 685.903 |  |
| 220 | import_part_sketch_throttel_testing.BREP | passed | 10.804 | 4.557 | 15.360 |  |
| 221 | import_part_slowsketch | passed | 2098.878 | 43.353 | 2142.231 |  |
| 222 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 21.090 | 0.871 | 21.961 |  |
| 223 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 8.434 | 0.846 | 9.279 |  |
| 224 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 1062.081 | 0.831 | 1062.912 |  |

Failure details:

1. test_sketch_face_attachment_alignment (failed)

```
FeatureHistoryError: Feature S6 (S) failed: refObj.updateWorldMatrix is not a function
    at PartHistory.runHistory (file:///home/user/projects/BREP/src/PartHistory.js:733:29)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1072:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:993:28)
Caused by: TypeError: refObj.updateWorldMatrix is not a function
    at SketchFeature._getOrCreateBasis (file:///home/user/projects/BREP/src/features/sketch/SketchFeature.js:293:20)
    at SketchFeature.run (file:///home/user/projects/BREP/src/features/sketch/SketchFeature.js:532:28)
    at PartHistory.runHistory (file:///home/user/projects/BREP/src/PartHistory.js:705:57)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1072:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:993:28)
```
