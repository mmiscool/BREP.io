# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 373
tests_run: 373
passed: 370
handled_errors: 0
skipped: 0
failed: 3
total_elapsed_ms: 122612.334

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_browser_skip_metadata_for_local_file_tests | passed | 6.233 | 9.921 | 16.154 |  |
| 2 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 4.781 | 2.020 | 6.801 |  |
| 3 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 3.179 | 2.227 | 5.406 |  |
| 4 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.301 | 1.564 | 2.865 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 1.083 | 1.495 | 2.578 |  |
| 6 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 0.637 | 1.234 | 1.871 |  |
| 7 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.568 | 1.287 | 1.856 |  |
| 8 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.582 | 1.629 | 2.211 |  |
| 9 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 6.956 | 1.678 | 8.634 |  |
| 10 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 1.103 | 1.213 | 2.315 |  |
| 11 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.090 | 1.147 | 2.238 |  |
| 12 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.965 | 1.487 | 4.452 |  |
| 13 | test_cppSolidMirror_preserves_face_metadata | passed | 6.755 | 1.667 | 8.423 |  |
| 14 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 1.826 | 1.201 | 3.027 |  |
| 15 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 61.552 | 1.154 | 62.706 |  |
| 16 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 8.754 | 1.659 | 10.413 |  |
| 17 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 6.685 | 0.914 | 7.599 |  |
| 18 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 79.763 | 10.728 | 90.491 |  |
| 19 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.781 | 1.355 | 2.136 |  |
| 20 | test_remesh_simplify_imported_fixture_stl | passed | 1003.680 | 383.752 | 1387.432 |  |
| 21 | test_self_intersection_cleanup_feature_splits_selected_solid | passed | 6.800 | 0.966 | 7.766 |  |
| 22 | test_self_intersection_cleanup_feature_context_button_for_single_solid | passed | 0.175 | 1.088 | 1.263 |  |
| 23 | test_self_intersection_cleanup_feature_is_available_in_modeling_and_surfacing | passed | 0.157 | 1.175 | 1.332 |  |
| 24 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 5.835 | 1.156 | 6.991 |  |
| 25 | test_revolve_after_union_preserves_face_reference_resolution | passed | 118.926 | 4.894 | 123.820 |  |
| 26 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 1.101 | 1.209 | 2.310 |  |
| 27 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.930 | 0.961 | 1.891 |  |
| 28 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.425 | 0.750 | 1.175 |  |
| 29 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 1.348 | 0.852 | 2.200 |  |
| 30 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 8.594 | 1.181 | 9.775 |  |
| 31 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 0.937 | 0.852 | 1.789 |  |
| 32 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.793 | 0.778 | 1.571 |  |
| 33 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.294 | 0.710 | 1.004 |  |
| 34 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.758 | 0.850 | 1.608 |  |
| 35 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.518 | 0.882 | 1.399 |  |
| 36 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.741 | 1.075 | 2.816 |  |
| 37 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 2.485 | 1.155 | 3.641 |  |
| 38 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 16.224 | 0.999 | 17.223 |  |
| 39 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 14.355 | 1.205 | 15.560 |  |
| 40 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 15.176 | 1.425 | 16.601 |  |
| 41 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 14.142 | 1.367 | 15.509 |  |
| 42 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 11.818 | 1.127 | 12.945 |  |
| 43 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 12.367 | 0.889 | 13.256 |  |
| 44 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 8.797 | 0.826 | 9.623 |  |
| 45 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 7.912 | 1.058 | 8.970 |  |
| 46 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 7.203 | 0.791 | 7.993 |  |
| 47 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.558 | 0.717 | 1.275 |  |
| 48 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.168 | 1.071 | 2.240 |  |
| 49 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.408 | 0.934 | 2.342 |  |
| 50 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.958 | 1.014 | 1.971 |  |
| 51 | test_cppSolidNative_collapseFilletSideWallFaces_moves_shared_endcap_edge_vertices | passed | 2.165 | 1.103 | 3.267 |  |
| 52 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.988 | 0.740 | 1.728 |  |
| 53 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 10.131 | 1.217 | 11.349 |  |
| 54 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 31.886 | 1.467 | 33.353 |  |
| 55 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 14.376 | 1.449 | 15.825 |  |
| 56 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 20.562 | 4.870 | 25.431 |  |
| 57 | test_cppTube_native_builder_reports_selected_build_mode | passed | 6.658 | 1.232 | 7.891 |  |
| 58 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 15.312 | 1.045 | 16.357 |  |
| 59 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 5.344 | 0.690 | 6.034 |  |
| 60 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.591 | 0.690 | 1.282 |  |
| 61 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.491 | 0.709 | 2.200 |  |
| 62 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.947 | 0.738 | 2.685 |  |
| 63 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 15.243 | 1.045 | 16.287 |  |
| 64 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 4.210 | 1.193 | 5.403 |  |
| 65 | test_configurator_expressions | passed | 1.635 | 0.925 | 2.560 |  |
| 66 | test_manifoldPlus_sum | passed | 0.212 | 0.785 | 0.997 |  |
| 67 | test_plane | passed | 1.573 | 0.804 | 2.377 |  |
| 68 | test_primitiveCube | passed | 6.291 | 3.376 | 9.667 |  |
| 69 | test_primitivePyramid | passed | 3.800 | 1.571 | 5.370 |  |
| 70 | test_primitiveCylinder | passed | 7.240 | 3.197 | 10.437 |  |
| 71 | test_face_source_feature_seed | passed | 8.514 | 1.612 | 10.126 |  |
| 72 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 0.995 | 0.930 | 1.925 |  |
| 73 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.770 | 1.391 | 2.161 |  |
| 74 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 7.539 | 0.877 | 8.416 |  |
| 75 | test_mesh_cleanup_find_one_triangle_intersected_by_multiple_triangles | passed | 1.605 | 1.002 | 2.607 |  |
| 76 | test_mesh_cleanup_two_cut_segments_cross_inside_same_triangle | passed | 1.890 | 1.154 | 3.045 |  |
| 77 | test_mesh_cleanup_intersection_endpoint_on_shared_mesh_edge | passed | 0.713 | 0.988 | 1.701 |  |
| 78 | test_mesh_cleanup_detects_coplanar_partial_triangle_overlap | passed | 0.841 | 0.978 | 1.819 |  |
| 79 | test_mesh_cleanup_removes_geometrically_duplicate_triangles | passed | 0.622 | 0.740 | 1.362 |  |
| 80 | test_mesh_cleanup_removes_closed_box_completely_inside_another | passed | 2.199 | 0.713 | 2.912 |  |
| 81 | test_mesh_cleanup_overlapping_boxes_volume_equals_union | passed | 14.374 | 3.531 | 17.905 |  |
| 82 | test_mesh_cleanup_disjoint_closed_boxes_are_preserved | passed | 2.070 | 1.045 | 3.115 |  |
| 83 | test_mesh_cleanup_preserves_face_ids_after_splitting | passed | 0.685 | 1.222 | 1.907 |  |
| 84 | test_mesh_cleanup_complete_operation_is_idempotent | passed | 15.548 | 1.108 | 16.655 |  |
| 85 | test_offsetFace_preserves_individual_edges | passed | 7.938 | 1.102 | 9.040 |  |
| 86 | test_face_thicken_planar_profile | passed | 18.232 | 1.465 | 19.697 |  |
| 87 | test_face_thicken_hole_profile | passed | 20.873 | 1.289 | 22.162 |  |
| 88 | test_face_thicken_curved_cylinder_side | passed | 83.818 | 4.613 | 88.432 |  |
| 89 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 302.198 | 6.420 | 308.617 |  |
| 90 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 3.960 | 0.925 | 4.886 |  |
| 91 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 4.126 | 1.016 | 5.142 |  |
| 92 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 6.381 | 0.902 | 7.282 |  |
| 93 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 4.131 | 1.747 | 5.878 |  |
| 94 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 4.947 | 0.842 | 5.790 |  |
| 95 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 70.583 | 2.171 | 72.754 |  |
| 96 | test_face_thicken_self_overlap_cylinder_side | passed | 40.801 | 1.788 | 42.589 |  |
| 97 | test_thicken_sphere_torus_union | passed | 775.644 | 28.753 | 804.397 |  |
| 98 | test_offsetShell_thickens_all_faces_except_selected | passed | 28.617 | 2.454 | 31.071 |  |
| 99 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 192.406 | 4.427 | 196.833 |  |
| 100 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 103.131 | 1.835 | 104.966 |  |
| 101 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.592 | 1.113 | 1.705 |  |
| 102 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.762 | 1.586 | 2.348 |  |
| 103 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.730 | 1.511 | 2.241 |  |
| 104 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.440 | 6.096 | 7.536 |  |
| 105 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 1.057 | 1.080 | 2.136 |  |
| 106 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 1973.751 | 23.770 | 1997.522 |  |
| 107 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 1892.605 | 27.042 | 1919.647 |  |
| 108 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 156.495 | 5.419 | 161.914 |  |
| 109 | test_offsetShell_preserves_source_centerlines | passed | 475.126 | 2.712 | 477.838 |  |
| 110 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.127 | 0.696 | 0.823 |  |
| 111 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 17.084 | 2.189 | 19.273 |  |
| 112 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 26.373 | 1.723 | 28.096 |  |
| 113 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 24.873 | 1.773 | 26.645 |  |
| 114 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.453 | 0.720 | 1.173 |  |
| 115 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.252 | 0.789 | 1.041 |  |
| 116 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.435 | 0.672 | 1.107 |  |
| 117 | test_visualize_does_not_repair_face_ids | passed | 0.366 | 0.752 | 1.119 |  |
| 118 | test_primitiveCone | passed | 7.278 | 2.733 | 10.011 |  |
| 119 | test_primitiveTorus | passed | 42.540 | 19.633 | 62.173 |  |
| 120 | test_primitiveSphere | passed | 5.002 | 2.410 | 7.412 |  |
| 121 | test_feature_dimension_overlay_supports_port | passed | 0.145 | 0.845 | 0.990 |  |
| 122 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.173 | 0.868 | 1.041 |  |
| 123 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.459 | 1.005 | 1.464 |  |
| 124 | test_feature_dimension_annotation_builder_dispatches_pattern | passed | 1.604 | 1.048 | 2.652 |  |
| 125 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.362 | 0.841 | 1.203 |  |
| 126 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.464 | 0.874 | 1.338 |  |
| 127 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.579 | 0.720 | 1.299 |  |
| 128 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.751 | 1.198 | 1.949 |  |
| 129 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.513 | 0.862 | 1.376 |  |
| 130 | test_transform_reference_sanitize_preserves_metadata | passed | 0.242 | 1.164 | 1.405 |  |
| 131 | test_transform_reference_base_uses_face_pick_point | passed | 0.673 | 1.054 | 1.726 |  |
| 132 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.411 | 3.519 | 3.930 |  |
| 133 | test_port_definition_uses_transform_reference_without_anchor | passed | 1.478 | 3.058 | 4.536 |  |
| 134 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.753 | 3.186 | 3.939 |  |
| 135 | test_boolean_subtract | passed | 42.675 | 10.376 | 53.051 |  |
| 136 | test_boolean_face_metadata_preserved | passed | 138.021 | 1.050 | 139.071 |  |
| 137 | test_primitive_boolean_union_preserves_face_grouping | passed | 60.526 | 3.053 | 63.579 |  |
| 138 | test_boolean_operation_target_name_preserved | passed | 18.767 | 1.791 | 20.557 |  |
| 139 | test_stlLoader | passed | 67.535 | 13.466 | 81.001 |  |
| 140 | test_import3d_decimation_reduces_triangle_count | passed | 28.406 | 21.225 | 49.631 |  |
| 141 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 22.405 | 7.085 | 29.491 |  |
| 142 | test_import3d_decimation_99_is_near_full_detail | passed | 44.655 | 30.305 | 74.960 |  |
| 143 | test_import3d_decimation_100_restores_original_geometry | passed | 38.652 | 12.293 | 50.946 |  |
| 144 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 43.518 | 9.395 | 52.912 |  |
| 145 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 36.444 | 15.062 | 51.506 |  |
| 146 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.357 | 2.149 | 4.506 |  |
| 147 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.406 | 0.858 | 1.264 |  |
| 148 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.406 | 0.862 | 1.268 |  |
| 149 | test_import3d_fixture_merges_faces_4_and_34 | passed | 894.748 | 424.547 | 1319.295 |  |
| 150 | test_import3d_extract_multiple_solids_toggle | passed | 22.814 | 2.071 | 24.885 |  |
| 151 | test_SweepFace | passed | 46.638 | 7.598 | 54.235 |  |
| 152 | test_SweepFace_pathAlign_multi_loop_islands | passed | 29.424 | 2.960 | 32.384 |  |
| 153 | test_tube | passed | 138.686 | 20.076 | 158.762 |  |
| 154 | test_tube_closedLoop | passed | 66.561 | 13.891 | 80.452 |  |
| 155 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.434 | 0.938 | 1.372 |  |
| 156 | test_wire_harness_connection_endpoint_resolution | passed | 0.783 | 0.767 | 1.550 |  |
| 157 | test_sheet_custom_size_persists | passed | 0.706 | 0.782 | 1.489 |  |
| 158 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.439 | 0.732 | 1.171 |  |
| 159 | test_pmi_view_text_size_setting_normalizes | passed | 0.308 | 0.845 | 1.152 |  |
| 160 | test_pmi_view_visibility_state_normalizes | passed | 0.213 | 0.786 | 0.999 |  |
| 161 | test_pmi_view_visibility_state_round_trip | passed | 6.365 | 1.460 | 7.825 |  |
| 162 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 1.286 | 0.828 | 2.114 |  |
| 163 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.332 | 0.695 | 1.026 |  |
| 164 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.395 | 0.745 | 1.140 |  |
| 165 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 0.827 | 0.865 | 1.693 |  |
| 166 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.327 | 0.823 | 1.149 |  |
| 167 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.315 | 0.762 | 1.077 |  |
| 168 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.544 | 0.963 | 1.507 |  |
| 169 | test_pmi_annotation_failure_status_is_visible | passed | 0.504 | 1.037 | 1.541 |  |
| 170 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 2.025 | 0.852 | 2.877 |  |
| 171 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.460 | 0.875 | 1.335 |  |
| 172 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.303 | 0.717 | 1.021 |  |
| 173 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 0.987 | 0.757 | 1.744 |  |
| 174 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.131 | 0.856 | 0.987 |  |
| 175 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.192 | 0.710 | 0.901 |  |
| 176 | test_pmi_export_render_context_applies_visibility_state | passed | 1.371 | 1.167 | 2.538 |  |
| 177 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.190 | 0.921 | 1.112 |  |
| 178 | test_sheet_clipboard_image_utils | passed | 0.780 | 1.111 | 1.891 |  |
| 179 | test_wire_harness_formboard_insert | passed | 6.002 | 0.868 | 6.870 |  |
| 180 | test_wire_harness_sheet_table_insert | passed | 1.943 | 0.911 | 2.854 |  |
| 181 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.794 | 1.074 | 2.868 |  |
| 182 | test_wire_harness_routes_render_as_scene_solids | passed | 6.399 | 0.828 | 7.227 |  |
| 183 | test_wire_harness_route_results_persist_in_model_json | passed | 1.013 | 0.769 | 1.782 |  |
| 184 | test_sketch_openLoop | passed | 3.125 | 1.121 | 4.246 |  |
| 185 | test_sketch_snapshot_restore_selection_handlers | passed | 8.324 | 1.038 | 9.361 |  |
| 186 | test_sketch_face_attachment_alignment | passed | 544.428 | 11.164 | 555.592 |  |
| 187 | test_sketch_solver_topology_rect_shared_points | passed | 9.648 | 0.913 | 10.561 |  |
| 188 | test_sketch_solver_topology_coincident_chain | passed | 14.771 | 0.958 | 15.728 |  |
| 189 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 17.173 | 0.972 | 18.145 |  |
| 190 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 17.808 | 1.136 | 18.944 |  |
| 191 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 40.634 | 1.226 | 41.860 |  |
| 192 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.494 | 0.761 | 2.256 |  |
| 193 | test_sketch_solver_line_to_point_distance_constraint | passed | 3.992 | 2.415 | 6.407 |  |
| 194 | test_extrude_negative_distance_cap_alignment | passed | 10.405 | 1.482 | 11.887 |  |
| 195 | test_extrude_intersect_coplanar_face_merge | passed | 1905.529 | 15.424 | 1920.953 |  |
| 196 | test_ExtrudeFace | passed | 35.172 | 7.036 | 42.207 |  |
| 197 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 10.390 | 1.527 | 11.917 |  |
| 198 | test_Fillet | passed | 514.981 | 29.482 | 544.462 |  |
| 199 | test_fillet_angle | passed | 14.566 | 2.458 | 17.024 |  |
| 200 | test_fillet_corner_bridge | passed | 41.279 | 3.183 | 44.462 |  |
| 201 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 45.395 | 1.710 | 47.104 |  |
| 202 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 38.334 | 6.626 | 44.960 |  |
| 203 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 34.327 | 1.391 | 35.718 |  |
| 204 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 101.588 | 12.659 | 114.247 |  |
| 205 | test_fillet_edge_degenerate_segment | passed | 1476.486 | 34.215 | 1510.701 |  |
| 206 | test_sketch_profile_tolerant_loop_join | passed | 1719.014 | 10.020 | 1729.035 |  |
| 207 | test_fillet_compound_snapshot_resolution | passed | 2024.412 | 21.023 | 2045.435 |  |
| 208 | test_fillet_generated_history_20260321144106 | passed | 4228.626 | 167.466 | 4396.091 |  |
| 209 | test_generated_history_20260322220620 | passed | 8202.856 | 194.930 | 8397.786 |  |
| 210 | test_generated_history_20260322222832 | passed | 85.039 | 5.101 | 90.140 |  |
| 211 | test_generated_history_20260418030116 | passed | 1014.255 | 41.071 | 1055.326 |  |
| 212 | test_generated_history_20260427005357 | passed | 2483.921 | 44.724 | 2528.645 |  |
| 213 | test_generated_history_20260427005357_three_face_thicken | passed | 670.417 | 21.311 | 691.727 |  |
| 214 | test_generated_history_20260427005357_nine_face_thicken | passed | 2204.398 | 39.795 | 2244.192 |  |
| 215 | test_generated_history_20260523000414 | passed | 1711.167 | 75.976 | 1787.143 |  |
| 216 | test_generated_history_20260531201126 | passed | 253.826 | 17.158 | 270.984 |  |
| 217 | test_generated_history_20260606004152 | passed | 11480.154 | 267.947 | 11748.102 |  |
| 218 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 5131.015 | 1.252 | 5132.267 |  |
| 219 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 5059.138 | 5.630 | 5064.769 |  |
| 220 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 4935.468 | 6.579 | 4942.048 |  |
| 221 | test_generated_history_20260709035143_offset_shell_prefers_source_face_names | passed | 3942.724 | 64.131 | 4006.855 |  |
| 222 | test_generated_history_20260612230031 | passed | 75.527 | 2.701 | 78.228 |  |
| 223 | test_generated_history_20260612232755 | passed | 538.985 | 21.287 | 560.272 |  |
| 224 | test_generated_history_20260613000139 | passed | 73.854 | 3.520 | 77.375 |  |
| 225 | test_generated_history_20260613003952 | passed | 8228.591 | 175.971 | 8404.563 |  |
| 226 | test_fillet_preserves_original_face_names | passed | 594.085 | 22.542 | 616.627 |  |
| 227 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 536.063 | 17.506 | 553.569 |  |
| 228 | test_Fillet_NonClosed | passed | 18.900 | 3.287 | 22.187 |  |
| 229 | test_fillets_more_dificult | passed | 1804.088 | 102.237 | 1906.325 |  |
| 230 | test_Chamfer | passed | 13.731 | 1.934 | 15.665 |  |
| 231 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 3.680 | 0.862 | 4.543 |  |
| 232 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 4.360 | 1.114 | 5.475 |  |
| 233 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 233.925 | 9.472 | 243.397 |  |
| 234 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 316.226 | 10.382 | 326.608 |  |
| 235 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 223.633 | 12.776 | 236.410 |  |
| 236 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 244.721 | 8.456 | 253.178 |  |
| 237 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 250.566 | 10.468 | 261.034 |  |
| 238 | test_edge_smooth_curve_fit | passed | 0.590 | 0.933 | 1.524 |  |
| 239 | test_edge_smooth_curve_fit_closed_loop | passed | 0.802 | 1.240 | 2.042 |  |
| 240 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.726 | 0.749 | 1.475 |  |
| 241 | test_edge_smooth_closed_loop_feature_selection | passed | 1.574 | 0.689 | 2.263 |  |
| 242 | test_edge_smooth_whole_solid_selection | passed | 0.401 | 0.652 | 1.052 |  |
| 243 | test_edge_smooth_face_selection | passed | 0.368 | 0.814 | 1.181 |  |
| 244 | test_smooth_with_subdivision_replaces_source_solid | passed | 48.052 | 2.405 | 50.458 |  |
| 245 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 40.658 | 4.740 | 45.398 |  |
| 246 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 81.432 | 4.833 | 86.266 |  |
| 247 | test_hole_through | passed | 43.278 | 3.708 | 46.986 |  |
| 248 | test_hole_countersink | passed | 65.943 | 5.610 | 71.553 |  |
| 249 | test_hole_counterbore | passed | 101.028 | 6.886 | 107.914 |  |
| 250 | test_hole_multi_point_cloned_cutter | passed | 166.435 | 10.678 | 177.113 |  |
| 251 | test_hole_thread_symbolic | passed | 101.481 | 5.345 | 106.826 |  |
| 252 | test_hole_thread_modeled | passed | 472.028 | 42.737 | 514.765 |  |
| 253 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 17.873 | 1.252 | 19.125 |  |
| 254 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 32.904 | 1.777 | 34.680 |  |
| 255 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.395 | 1.024 | 1.419 |  |
| 256 | test_run_history_calls_are_serialized | passed | 49.770 | 2.293 | 52.063 |  |
| 257 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 30.610 | 1.782 | 32.392 |  |
| 258 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 52.418 | 1.550 | 53.968 |  |
| 259 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 5096.170 | 48.430 | 5144.600 |  |
| 260 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 5892.883 | 0.000 | 5892.883 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32) |
| 261 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 7084.389 | 0.000 | 7084.389 | Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32) |
| 262 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 7039.611 | 0.000 | 7039.611 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32) |
| 263 | test_pushFace_feature | passed | 6.899 | 11.490 | 18.389 |  |
| 264 | test_pushFace | passed | 49.087 | 4.179 | 53.266 |  |
| 265 | test_mirror | passed | 9.608 | 1.698 | 11.306 |  |
| 266 | test_pattern_circular_count_pitch_uses_angle_as_step | passed | 0.802 | 0.735 | 1.536 |  |
| 267 | test_history_features_basic | passed | 112.006 | 11.642 | 123.647 |  |
| 268 | test_history_expand_does_not_dirty | passed | 21.085 | 1.235 | 22.319 |  |
| 269 | test_history_test_snippet_persistent_data_allowlist | passed | 0.986 | 0.802 | 1.789 |  |
| 270 | test_history_test_snippet_includes_cam_operations | passed | 0.701 | 0.781 | 1.482 |  |
| 271 | test_history_test_snippet_toolbar_snapshot_compacts_cam_generated_data | passed | 0.671 | 1.270 | 1.942 |  |
| 272 | test_history_test_snippet_omits_empty_cam_state | passed | 0.231 | 1.000 | 1.231 |  |
| 273 | test_history_test_snippet_includes_global_cam_state_without_operations | passed | 0.277 | 0.950 | 1.227 |  |
| 274 | test_selection_owning_feature_resolution | passed | 0.686 | 0.803 | 1.488 |  |
| 275 | test_selection_line2_resolution_repair | passed | 2.872 | 0.923 | 3.795 |  |
| 276 | test_selection_hover_material_restores_before_dispose | passed | 0.370 | 0.701 | 1.070 |  |
| 277 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.351 | 0.900 | 1.251 |  |
| 278 | test_selection_sketch_hover_tints_material_in_place | passed | 0.477 | 0.814 | 1.291 |  |
| 279 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.782 | 1.094 | 1.876 |  |
| 280 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.987 | 1.054 | 2.040 |  |
| 281 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.382 | 0.778 | 1.160 |  |
| 282 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.560 | 0.717 | 1.277 |  |
| 283 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 10.960 | 1.160 | 12.120 |  |
| 284 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 7.997 | 0.903 | 8.900 |  |
| 285 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 11.163 | 5.634 | 16.798 |  |
| 286 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 8.800 | 0.851 | 9.651 |  |
| 287 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 7.736 | 1.024 | 8.760 |  |
| 288 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 16.303 | 1.284 | 17.587 |  |
| 289 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.889 | 0.888 | 3.777 |  |
| 290 | test_cam_plan_manager_preserves_operations_and_profiles | passed | 1.054 | 0.791 | 1.845 |  |
| 291 | test_cam_plan_manager_async_generation_reports_progress_steps | passed | 70.326 | 2.072 | 72.399 |  |
| 292 | test_cam_plan_manager_strips_legacy_generated_data | passed | 0.531 | 0.906 | 1.437 |  |
| 293 | test_cam_shadow_cutter_generated_history_20260704000935_keeps_outer_loop | passed | 289.750 | 1.133 | 290.883 |  |
| 294 | test_cam_shadow_cutter_cuts_each_loop_to_depth_before_next_loop | passed | 3.390 | 0.912 | 4.302 |  |
| 295 | test_cam_shadow_cutter_generates_clear_hole_loop | passed | 3.702 | 1.288 | 4.990 |  |
| 296 | test_cam_shadow_cutter_generates_outer_and_hole_for_nonconvex_profile | passed | 5.049 | 0.928 | 5.977 |  |
| 297 | test_cam_shadow_cutter_history_item_generates_toolpath | passed | 1.430 | 1.006 | 2.436 |  |
| 298 | test_cam_shadow_cutter_ignores_raised_cap_loops_as_holes | passed | 4.406 | 1.518 | 5.925 |  |
| 299 | test_cam_shadow_cutter_offset_keeps_l_shape_inside_corner_clear | passed | 1.138 | 0.992 | 2.130 |  |
| 300 | test_cam_shadow_cutter_offset_stays_outside_concave_shadow | passed | 1.504 | 0.918 | 2.423 |  |
| 301 | test_cam_roughing_history_item_generates_sliced_toolpaths | passed | 4.570 | 1.336 | 5.906 |  |
| 302 | test_cam_roughing_debug_slices_emit_layer_solids | passed | 2.928 | 1.030 | 3.958 |  |
| 303 | test_cam_roughing_debug_slices_create_real_scene_solids | passed | 22.430 | 3.490 | 25.920 |  |
| 304 | test_cam_roughing_debug_slices_survive_combined_cam_plan | passed | 10.370 | 1.032 | 11.402 |  |
| 305 | test_cam_roughing_sloped_slab_generates_each_step | passed | 3.156 | 1.000 | 4.157 |  |
| 306 | test_cam_roughing_unions_curved_slice_shadow_before_pathing | passed | 29.655 | 0.974 | 30.629 |  |
| 307 | test_cam_roughing_uses_each_slice_shadow | passed | 2.365 | 0.877 | 3.242 |  |
| 308 | test_cam_roughing_vertical_wall_slice_matches_shadow_cutter_loop | passed | 8.279 | 2.772 | 11.051 |  |
| 309 | test_cam_surfacing_adaptive_sampling_inserts_points_on_curved_face | passed | 15.063 | 1.204 | 16.267 |  |
| 310 | test_cam_surfacing_applies_parent_transform_to_direct_face_geometry | passed | 7.435 | 1.671 | 9.106 |  |
| 311 | test_cam_surfacing_both_raster_directions_emit_x_and_y_paths | passed | 52.114 | 1.091 | 53.204 |  |
| 312 | test_cam_surfacing_clearance_link_samples_narrow_preserved_geometry | passed | 6.836 | 1.373 | 8.208 |  |
| 313 | test_cam_surfacing_combined_gcode_posts_single_runnable_program | passed | 11.493 | 1.423 | 12.917 |  |
| 314 | test_cam_surfacing_combined_gcode_reissues_feed_after_roughing | passed | 10.703 | 1.177 | 11.880 |  |
| 315 | test_cam_surfacing_detects_narrow_preserved_island_between_coarse_samples | passed | 26.907 | 1.399 | 28.306 |  |
| 316 | test_cam_surfacing_does_not_cut_across_selected_face_hole | passed | 66.221 | 1.033 | 67.253 |  |
| 317 | test_cam_surfacing_does_not_duplicate_direct_face_with_owner_metadata | passed | 8.458 | 1.087 | 9.545 |  |
| 318 | test_cam_surfacing_flat_path_tolerance_zero_respects_sample_spacing | passed | 6.023 | 0.929 | 6.951 |  |
| 319 | test_cam_surfacing_history_item_generates_ball_endmill_raster | passed | 21.009 | 2.524 | 23.533 |  |
| 320 | test_cam_surfacing_follows_sloped_face_with_drop_cutter | passed | 9.683 | 1.176 | 10.859 |  |
| 321 | test_cam_surfacing_reaches_edge_beside_coplanar_preserved_face | passed | 16.050 | 1.252 | 17.302 |  |
| 322 | test_cam_surfacing_reports_warning_when_raster_too_dense | passed | 4.567 | 1.614 | 6.181 |  |
| 323 | test_cam_surfacing_resolves_solid_owned_face_reference | passed | 8.662 | 1.010 | 9.672 |  |
| 324 | test_cam_surfacing_uses_explicit_solid_owner_for_shared_face_name | passed | 10.744 | 1.251 | 11.995 |  |
| 325 | test_cam_surfacing_splits_runs_around_preserved_island | passed | 16.790 | 1.278 | 18.068 |  |
| 326 | test_cam_surfacing_stops_before_higher_adjacent_preserved_face | passed | 4.363 | 1.137 | 5.500 |  |
| 327 | test_cam_surfacing_stock_allowance_leaves_material_on_selected_face | passed | 10.213 | 1.075 | 11.288 |  |
| 328 | test_cam_surfacing_ui_reference_metadata_preserves_shared_face_owner | passed | 33.491 | 3.748 | 37.239 |  |
| 329 | test_cam_surfacing_uses_low_clearance_links_between_separate_face_spans | passed | 8.935 | 1.089 | 10.024 |  |
| 330 | test_cam_surfacing_falls_back_to_full_retract_when_low_hop_reaches_safe_height | passed | 6.797 | 1.619 | 8.417 |  |
| 331 | test_cam_surfacing_uses_userdata_solid_owner_for_shared_face_name | passed | 10.005 | 1.409 | 11.414 |  |
| 332 | test_cam_surfacing_y_raster_reaches_selected_face_edges | passed | 15.846 | 1.651 | 17.497 |  |
| 333 | test_cam_surfacing_zero_sample_spacing_uses_automatic_spacing | passed | 12.866 | 3.602 | 16.468 |  |
| 334 | test_cam_surfacing_rejects_vertical_face_without_projected_area | passed | 0.869 | 1.247 | 2.116 |  |
| 335 | test_cam_shadow_cutter_single_solid_does_not_require_target_selection | passed | 0.958 | 1.158 | 2.116 |  |
| 336 | test_cam_toolpath_simulator_displays_ball_endmill_round_tip | passed | 6.779 | 1.082 | 7.861 |  |
| 337 | test_cam_toolpath_simulator_visualizes_program_and_moves_head | passed | 2.608 | 1.191 | 3.799 |  |
| 338 | test_cam_shadow_cutter_uses_projected_outline_not_convex_hull | passed | 0.762 | 1.052 | 1.813 |  |
| 339 | test_cam_workbench_exit_clears_scene_artifacts | passed | 79.528 | 1.886 | 81.414 |  |
| 340 | test_cam_workbench_registers_shadow_cutter_and_roughing_operations | passed | 0.287 | 0.911 | 1.198 |  |
| 341 | test_cam_workbench_registers_and_persists_part_history_state | passed | 0.413 | 0.713 | 1.127 |  |
| 342 | test_visibility_hidden_state_persistence | passed | 11.272 | 5.449 | 16.722 |  |
| 343 | test_sketch_feature_scene_visibility | passed | 0.236 | 0.819 | 1.055 |  |
| 344 | test_textToFace | passed | 48.215 | 13.437 | 61.652 |  |
| 345 | test_sheetMetal_nonManifold_sm_f18 | passed | 155.195 | 1.743 | 156.938 |  |
| 346 | test_sheetMetal_tab_circular_hole_wall | passed | 17.766 | 3.366 | 21.132 |  |
| 347 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 12.054 | 1.566 | 13.620 |  |
| 348 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 6.221 | 1.232 | 7.454 |  |
| 349 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 126.007 | 3.468 | 129.476 |  |
| 350 | test_sheetMetal_tab_and_flange_context_buttons | passed | 0.588 | 0.864 | 1.452 |  |
| 351 | test_sheetMetal_cutout_preserves_multiple_profile_loops | passed | 163.948 | 8.799 | 172.747 |  |
| 352 | test_sheetMetal_cutout_context_button | passed | 0.352 | 1.106 | 1.459 |  |
| 353 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.212 | 0.795 | 1.008 |  |
| 354 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 48.014 | 4.916 | 52.930 |  |
| 355 | test_sheetMetal_cutoutEdge_flange_controls | passed | 5.591 | 1.209 | 6.800 |  |
| 356 | test_sheetMetal_corner_fillet | passed | 211.856 | 2.966 | 214.822 |  |
| 357 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 203.688 | 1.800 | 205.488 |  |
| 358 | test_sheetMetal_corner_fillet_selection_resolution | passed | 467.970 | 2.709 | 470.679 |  |
| 359 | test_sheetMetal_corner_fillet_compound_reference | passed | 366.724 | 1.481 | 368.205 |  |
| 360 | test_solidPointMinGap | passed | 1.448 | 1.504 | 2.952 |  |
| 361 | test_solidMetrics | passed | 5.373 | 1.722 | 7.095 |  |
| 362 | import_part_badBoolean | passed | 90.157 | 9.113 | 99.269 |  |
| 363 | import_part_extrudeTest | passed | 38.490 | 3.241 | 41.731 |  |
| 364 | import_part_filletFail | passed | 21.518 | 2.567 | 24.085 |  |
| 365 | import_part_fillet_angle_test.BREP | passed | 41.190 | 4.691 | 45.882 |  |
| 366 | import_part_fillet_test.BREP | passed | 1941.212 | 70.171 | 2011.383 |  |
| 367 | import_part_import_TEst.part.part | passed | 33.777 | 4.390 | 38.167 |  |
| 368 | import_part_medium_fillets.BREP | passed | 545.507 | 32.582 | 578.089 |  |
| 369 | import_part_sketch_throttel_testing.BREP | passed | 19.173 | 4.353 | 23.526 |  |
| 370 | import_part_slowsketch | passed | 2382.139 | 43.798 | 2425.937 |  |
| 371 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 23.513 | 1.636 | 25.149 |  |
| 372 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 9.947 | 1.133 | 11.080 |  |
| 373 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 1375.713 | 5.390 | 1381.103 |  |

Failure details:

1. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32)
```

2. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32)
```

3. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1952:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1831:32)
```
