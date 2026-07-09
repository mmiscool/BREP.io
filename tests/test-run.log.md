# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 372
tests_run: 372
passed: 369
handled_errors: 0
skipped: 0
failed: 3
total_elapsed_ms: 108455.034

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_browser_skip_metadata_for_local_file_tests | passed | 6.303 | 9.667 | 15.971 |  |
| 2 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 5.054 | 2.226 | 7.280 |  |
| 3 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.935 | 2.404 | 4.338 |  |
| 4 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.105 | 1.180 | 2.285 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 0.888 | 1.337 | 2.225 |  |
| 6 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 0.820 | 1.523 | 2.343 |  |
| 7 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.636 | 1.406 | 2.042 |  |
| 8 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.672 | 1.938 | 2.610 |  |
| 9 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 5.824 | 1.147 | 6.971 |  |
| 10 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 0.830 | 1.309 | 2.140 |  |
| 11 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.193 | 1.291 | 2.484 |  |
| 12 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 3.218 | 1.554 | 4.772 |  |
| 13 | test_cppSolidMirror_preserves_face_metadata | passed | 6.460 | 1.264 | 7.724 |  |
| 14 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 1.838 | 1.331 | 3.169 |  |
| 15 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 58.924 | 6.466 | 65.390 |  |
| 16 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 9.898 | 1.258 | 11.156 |  |
| 17 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 5.481 | 1.021 | 6.502 |  |
| 18 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 65.012 | 2.903 | 67.915 |  |
| 19 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.447 | 1.004 | 1.451 |  |
| 20 | test_remesh_simplify_imported_fixture_stl | passed | 864.466 | 390.934 | 1255.400 |  |
| 21 | test_self_intersection_cleanup_feature_splits_selected_solid | passed | 7.939 | 1.543 | 9.482 |  |
| 22 | test_self_intersection_cleanup_feature_context_button_for_single_solid | passed | 0.179 | 1.065 | 1.245 |  |
| 23 | test_self_intersection_cleanup_feature_is_available_in_modeling_and_surfacing | passed | 0.176 | 1.175 | 1.351 |  |
| 24 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 5.912 | 1.699 | 7.611 |  |
| 25 | test_revolve_after_union_preserves_face_reference_resolution | passed | 110.880 | 3.648 | 114.528 |  |
| 26 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 1.246 | 1.252 | 2.498 |  |
| 27 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.657 | 1.023 | 1.680 |  |
| 28 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.365 | 0.998 | 1.362 |  |
| 29 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 1.009 | 0.961 | 1.970 |  |
| 30 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 8.741 | 1.149 | 9.891 |  |
| 31 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 1.000 | 1.161 | 2.161 |  |
| 32 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.786 | 1.016 | 1.801 |  |
| 33 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.318 | 0.969 | 1.287 |  |
| 34 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.549 | 1.157 | 1.706 |  |
| 35 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.565 | 1.385 | 1.950 |  |
| 36 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 2.325 | 1.284 | 3.610 |  |
| 37 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 2.376 | 1.261 | 3.637 |  |
| 38 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 17.414 | 2.997 | 20.411 |  |
| 39 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 14.927 | 1.007 | 15.933 |  |
| 40 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 17.531 | 1.394 | 18.926 |  |
| 41 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 13.288 | 0.960 | 14.248 |  |
| 42 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 13.034 | 1.076 | 14.110 |  |
| 43 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 14.980 | 0.952 | 15.933 |  |
| 44 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 9.920 | 1.146 | 11.066 |  |
| 45 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 7.974 | 0.977 | 8.951 |  |
| 46 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 9.248 | 0.949 | 10.197 |  |
| 47 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.749 | 0.809 | 1.558 |  |
| 48 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.417 | 0.843 | 2.260 |  |
| 49 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.098 | 0.814 | 1.911 |  |
| 50 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.910 | 0.867 | 1.777 |  |
| 51 | test_cppSolidNative_collapseFilletSideWallFaces_moves_shared_endcap_edge_vertices | passed | 1.928 | 1.117 | 3.045 |  |
| 52 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.875 | 1.103 | 1.977 |  |
| 53 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 9.900 | 1.002 | 10.902 |  |
| 54 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 33.813 | 1.212 | 35.026 |  |
| 55 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 14.242 | 0.933 | 15.175 |  |
| 56 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 20.207 | 0.986 | 21.192 |  |
| 57 | test_cppTube_native_builder_reports_selected_build_mode | passed | 6.239 | 0.796 | 7.035 |  |
| 58 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 13.853 | 0.911 | 14.764 |  |
| 59 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 4.845 | 0.864 | 5.710 |  |
| 60 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.686 | 0.775 | 1.462 |  |
| 61 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.620 | 0.777 | 2.397 |  |
| 62 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.728 | 0.782 | 2.510 |  |
| 63 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 14.653 | 0.858 | 15.511 |  |
| 64 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 3.258 | 0.869 | 4.127 |  |
| 65 | test_configurator_expressions | passed | 1.454 | 0.944 | 2.398 |  |
| 66 | test_manifoldPlus_sum | passed | 0.178 | 0.797 | 0.975 |  |
| 67 | test_plane | passed | 1.258 | 0.756 | 2.014 |  |
| 68 | test_primitiveCube | passed | 3.993 | 2.171 | 6.164 |  |
| 69 | test_primitivePyramid | passed | 2.728 | 1.618 | 4.346 |  |
| 70 | test_primitiveCylinder | passed | 5.719 | 2.988 | 8.707 |  |
| 71 | test_face_source_feature_seed | passed | 7.888 | 1.670 | 9.558 |  |
| 72 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 1.004 | 1.001 | 2.005 |  |
| 73 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.568 | 4.717 | 5.284 |  |
| 74 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 7.857 | 0.980 | 8.837 |  |
| 75 | test_mesh_cleanup_find_one_triangle_intersected_by_multiple_triangles | passed | 1.477 | 0.830 | 2.307 |  |
| 76 | test_mesh_cleanup_two_cut_segments_cross_inside_same_triangle | passed | 1.353 | 0.803 | 2.156 |  |
| 77 | test_mesh_cleanup_intersection_endpoint_on_shared_mesh_edge | passed | 0.510 | 0.796 | 1.306 |  |
| 78 | test_mesh_cleanup_detects_coplanar_partial_triangle_overlap | passed | 0.708 | 0.821 | 1.529 |  |
| 79 | test_mesh_cleanup_removes_geometrically_duplicate_triangles | passed | 0.756 | 0.799 | 1.555 |  |
| 80 | test_mesh_cleanup_removes_closed_box_completely_inside_another | passed | 2.321 | 0.789 | 3.110 |  |
| 81 | test_mesh_cleanup_overlapping_boxes_volume_equals_union | passed | 12.753 | 0.931 | 13.684 |  |
| 82 | test_mesh_cleanup_disjoint_closed_boxes_are_preserved | passed | 1.893 | 0.785 | 2.678 |  |
| 83 | test_mesh_cleanup_preserves_face_ids_after_splitting | passed | 0.468 | 0.799 | 1.268 |  |
| 84 | test_mesh_cleanup_complete_operation_is_idempotent | passed | 15.536 | 0.869 | 16.405 |  |
| 85 | test_offsetFace_preserves_individual_edges | passed | 9.104 | 1.275 | 10.380 |  |
| 86 | test_face_thicken_planar_profile | passed | 17.029 | 1.134 | 18.163 |  |
| 87 | test_face_thicken_hole_profile | passed | 17.529 | 1.179 | 18.707 |  |
| 88 | test_face_thicken_curved_cylinder_side | passed | 72.690 | 3.436 | 76.126 |  |
| 89 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 302.167 | 6.265 | 308.431 |  |
| 90 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 2.706 | 0.802 | 3.507 |  |
| 91 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 3.856 | 0.808 | 4.665 |  |
| 92 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 3.949 | 0.847 | 4.796 |  |
| 93 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 5.356 | 1.069 | 6.424 |  |
| 94 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 4.465 | 0.839 | 5.304 |  |
| 95 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 73.848 | 2.695 | 76.543 |  |
| 96 | test_face_thicken_self_overlap_cylinder_side | passed | 45.686 | 5.924 | 51.610 |  |
| 97 | test_thicken_sphere_torus_union | passed | 749.453 | 28.671 | 778.123 |  |
| 98 | test_offsetShell_thickens_all_faces_except_selected | passed | 29.041 | 1.831 | 30.872 |  |
| 99 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 179.243 | 3.444 | 182.687 |  |
| 100 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 106.205 | 2.595 | 108.800 |  |
| 101 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.768 | 0.845 | 1.613 |  |
| 102 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.399 | 0.667 | 1.066 |  |
| 103 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.429 | 0.828 | 1.257 |  |
| 104 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.119 | 0.694 | 1.813 |  |
| 105 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 0.657 | 0.777 | 1.434 |  |
| 106 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 1651.117 | 19.233 | 1670.350 |  |
| 107 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 1558.792 | 22.652 | 1581.444 |  |
| 108 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 133.927 | 4.914 | 138.841 |  |
| 109 | test_offsetShell_preserves_source_centerlines | passed | 389.351 | 2.973 | 392.324 |  |
| 110 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.121 | 0.653 | 0.775 |  |
| 111 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 15.028 | 2.193 | 17.221 |  |
| 112 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 22.172 | 1.545 | 23.717 |  |
| 113 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 18.707 | 1.503 | 20.210 |  |
| 114 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.381 | 0.672 | 1.054 |  |
| 115 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.269 | 0.611 | 0.879 |  |
| 116 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.373 | 0.617 | 0.991 |  |
| 117 | test_visualize_does_not_repair_face_ids | passed | 0.332 | 0.739 | 1.072 |  |
| 118 | test_primitiveCone | passed | 5.326 | 2.780 | 8.106 |  |
| 119 | test_primitiveTorus | passed | 49.680 | 16.028 | 65.708 |  |
| 120 | test_primitiveSphere | passed | 4.013 | 2.131 | 6.144 |  |
| 121 | test_feature_dimension_overlay_supports_port | passed | 0.138 | 0.709 | 0.847 |  |
| 122 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.151 | 0.717 | 0.868 |  |
| 123 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.535 | 0.687 | 1.222 |  |
| 124 | test_feature_dimension_annotation_builder_dispatches_pattern | passed | 1.108 | 0.668 | 1.777 |  |
| 125 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.253 | 0.678 | 0.932 |  |
| 126 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.367 | 0.694 | 1.061 |  |
| 127 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.530 | 0.774 | 1.304 |  |
| 128 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.746 | 0.980 | 1.727 |  |
| 129 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.307 | 0.838 | 1.145 |  |
| 130 | test_transform_reference_sanitize_preserves_metadata | passed | 0.167 | 0.747 | 0.914 |  |
| 131 | test_transform_reference_base_uses_face_pick_point | passed | 0.472 | 0.784 | 1.256 |  |
| 132 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.274 | 2.344 | 2.618 |  |
| 133 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.867 | 2.543 | 3.410 |  |
| 134 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.496 | 2.280 | 2.776 |  |
| 135 | test_boolean_subtract | passed | 37.316 | 11.767 | 49.082 |  |
| 136 | test_boolean_face_metadata_preserved | passed | 147.158 | 1.177 | 148.335 |  |
| 137 | test_primitive_boolean_union_preserves_face_grouping | passed | 53.123 | 2.159 | 55.282 |  |
| 138 | test_boolean_operation_target_name_preserved | passed | 15.358 | 3.477 | 18.835 |  |
| 139 | test_stlLoader | passed | 52.761 | 17.892 | 70.652 |  |
| 140 | test_import3d_decimation_reduces_triangle_count | passed | 24.330 | 14.737 | 39.067 |  |
| 141 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 18.675 | 7.166 | 25.841 |  |
| 142 | test_import3d_decimation_99_is_near_full_detail | passed | 40.521 | 27.567 | 68.088 |  |
| 143 | test_import3d_decimation_100_restores_original_geometry | passed | 34.460 | 14.584 | 49.044 |  |
| 144 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 48.121 | 6.261 | 54.382 |  |
| 145 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 39.336 | 11.110 | 50.446 |  |
| 146 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.294 | 2.460 | 4.753 |  |
| 147 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.408 | 0.785 | 1.193 |  |
| 148 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.392 | 1.125 | 1.517 |  |
| 149 | test_import3d_fixture_merges_faces_4_and_34 | passed | 791.598 | 353.765 | 1145.363 |  |
| 150 | test_import3d_extract_multiple_solids_toggle | passed | 17.259 | 5.090 | 22.348 |  |
| 151 | test_SweepFace | passed | 41.459 | 3.719 | 45.178 |  |
| 152 | test_SweepFace_pathAlign_multi_loop_islands | passed | 25.675 | 3.446 | 29.121 |  |
| 153 | test_tube | passed | 103.032 | 19.749 | 122.781 |  |
| 154 | test_tube_closedLoop | passed | 62.139 | 12.143 | 74.282 |  |
| 155 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.315 | 0.787 | 1.103 |  |
| 156 | test_wire_harness_connection_endpoint_resolution | passed | 0.933 | 0.742 | 1.675 |  |
| 157 | test_sheet_custom_size_persists | passed | 0.889 | 0.889 | 1.779 |  |
| 158 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.487 | 0.840 | 1.327 |  |
| 159 | test_pmi_view_text_size_setting_normalizes | passed | 0.342 | 0.791 | 1.134 |  |
| 160 | test_pmi_view_visibility_state_normalizes | passed | 0.152 | 0.785 | 0.937 |  |
| 161 | test_pmi_view_visibility_state_round_trip | passed | 5.059 | 1.059 | 6.118 |  |
| 162 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 1.204 | 0.802 | 2.006 |  |
| 163 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.315 | 0.683 | 0.997 |  |
| 164 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.423 | 0.769 | 1.193 |  |
| 165 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 0.737 | 0.775 | 1.513 |  |
| 166 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.306 | 0.727 | 1.033 |  |
| 167 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.248 | 0.707 | 0.955 |  |
| 168 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.488 | 0.805 | 1.293 |  |
| 169 | test_pmi_annotation_failure_status_is_visible | passed | 0.341 | 0.784 | 1.125 |  |
| 170 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 1.415 | 0.728 | 2.143 |  |
| 171 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.393 | 0.874 | 1.266 |  |
| 172 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.314 | 0.686 | 1.001 |  |
| 173 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 0.903 | 0.752 | 1.654 |  |
| 174 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.120 | 0.718 | 0.838 |  |
| 175 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.188 | 0.746 | 0.934 |  |
| 176 | test_pmi_export_render_context_applies_visibility_state | passed | 0.926 | 0.744 | 1.670 |  |
| 177 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.108 | 0.676 | 0.784 |  |
| 178 | test_sheet_clipboard_image_utils | passed | 0.550 | 0.749 | 1.299 |  |
| 179 | test_wire_harness_formboard_insert | passed | 5.764 | 0.843 | 6.607 |  |
| 180 | test_wire_harness_sheet_table_insert | passed | 1.896 | 0.848 | 2.744 |  |
| 181 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.837 | 0.831 | 2.668 |  |
| 182 | test_wire_harness_routes_render_as_scene_solids | passed | 6.233 | 0.852 | 7.085 |  |
| 183 | test_wire_harness_route_results_persist_in_model_json | passed | 1.207 | 0.807 | 2.014 |  |
| 184 | test_sketch_openLoop | passed | 2.989 | 0.941 | 3.929 |  |
| 185 | test_sketch_snapshot_restore_selection_handlers | passed | 7.058 | 0.959 | 8.018 |  |
| 186 | test_sketch_face_attachment_alignment | passed | 494.463 | 9.865 | 504.328 |  |
| 187 | test_sketch_solver_topology_rect_shared_points | passed | 8.646 | 1.110 | 9.755 |  |
| 188 | test_sketch_solver_topology_coincident_chain | passed | 16.721 | 1.211 | 17.932 |  |
| 189 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 17.507 | 1.174 | 18.681 |  |
| 190 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 20.246 | 2.511 | 22.758 |  |
| 191 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 34.000 | 3.224 | 37.224 |  |
| 192 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.534 | 0.871 | 2.405 |  |
| 193 | test_sketch_solver_line_to_point_distance_constraint | passed | 4.191 | 0.719 | 4.910 |  |
| 194 | test_extrude_negative_distance_cap_alignment | passed | 9.242 | 3.704 | 12.946 |  |
| 195 | test_extrude_intersect_coplanar_face_merge | passed | 1658.509 | 14.181 | 1672.690 |  |
| 196 | test_ExtrudeFace | passed | 28.471 | 2.937 | 31.408 |  |
| 197 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 8.082 | 1.161 | 9.243 |  |
| 198 | test_Fillet | passed | 485.676 | 30.194 | 515.869 |  |
| 199 | test_fillet_angle | passed | 14.144 | 2.404 | 16.548 |  |
| 200 | test_fillet_corner_bridge | passed | 40.617 | 3.321 | 43.937 |  |
| 201 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 37.112 | 1.521 | 38.633 |  |
| 202 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 34.214 | 1.232 | 35.446 |  |
| 203 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 30.808 | 1.241 | 32.049 |  |
| 204 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 84.601 | 9.053 | 93.654 |  |
| 205 | test_fillet_edge_degenerate_segment | passed | 1297.439 | 28.169 | 1325.608 |  |
| 206 | test_sketch_profile_tolerant_loop_join | passed | 1458.820 | 9.894 | 1468.715 |  |
| 207 | test_fillet_compound_snapshot_resolution | passed | 1689.627 | 19.960 | 1709.588 |  |
| 208 | test_fillet_generated_history_20260321144106 | passed | 3602.685 | 119.476 | 3722.161 |  |
| 209 | test_generated_history_20260322220620 | passed | 8314.795 | 208.325 | 8523.119 |  |
| 210 | test_generated_history_20260322222832 | passed | 83.678 | 5.200 | 88.878 |  |
| 211 | test_generated_history_20260418030116 | passed | 1073.339 | 44.312 | 1117.650 |  |
| 212 | test_generated_history_20260427005357 | passed | 2902.587 | 51.590 | 2954.177 |  |
| 213 | test_generated_history_20260427005357_three_face_thicken | passed | 831.661 | 26.903 | 858.563 |  |
| 214 | test_generated_history_20260427005357_nine_face_thicken | passed | 2494.065 | 45.846 | 2539.911 |  |
| 215 | test_generated_history_20260523000414 | passed | 2066.007 | 83.037 | 2149.044 |  |
| 216 | test_generated_history_20260531201126 | passed | 286.699 | 17.427 | 304.126 |  |
| 217 | test_generated_history_20260606004152 | passed | 10280.148 | 243.281 | 10523.429 |  |
| 218 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 4326.807 | 1.773 | 4328.580 |  |
| 219 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 4860.238 | 2.307 | 4862.545 |  |
| 220 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 4511.001 | 5.590 | 4516.592 |  |
| 221 | test_generated_history_20260612230031 | passed | 138.242 | 4.378 | 142.620 |  |
| 222 | test_generated_history_20260612232755 | passed | 561.129 | 20.060 | 581.189 |  |
| 223 | test_generated_history_20260613000139 | passed | 92.123 | 3.821 | 95.944 |  |
| 224 | test_generated_history_20260613003952 | passed | 7136.264 | 174.471 | 7310.735 |  |
| 225 | test_fillet_preserves_original_face_names | passed | 515.186 | 18.847 | 534.033 |  |
| 226 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 519.145 | 15.448 | 534.592 |  |
| 227 | test_Fillet_NonClosed | passed | 14.328 | 2.154 | 16.482 |  |
| 228 | test_fillets_more_dificult | passed | 1982.741 | 97.782 | 2080.523 |  |
| 229 | test_Chamfer | passed | 12.306 | 1.862 | 14.169 |  |
| 230 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 3.979 | 0.861 | 4.839 |  |
| 231 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 3.453 | 0.863 | 4.316 |  |
| 232 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 231.549 | 11.959 | 243.507 |  |
| 233 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 329.555 | 10.038 | 339.594 |  |
| 234 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 213.462 | 12.000 | 225.463 |  |
| 235 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 233.834 | 9.854 | 243.689 |  |
| 236 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 260.259 | 8.702 | 268.961 |  |
| 237 | test_edge_smooth_curve_fit | passed | 0.739 | 1.053 | 1.792 |  |
| 238 | test_edge_smooth_curve_fit_closed_loop | passed | 0.554 | 0.851 | 1.405 |  |
| 239 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.737 | 0.890 | 1.627 |  |
| 240 | test_edge_smooth_closed_loop_feature_selection | passed | 1.885 | 0.798 | 2.683 |  |
| 241 | test_edge_smooth_whole_solid_selection | passed | 0.553 | 0.812 | 1.365 |  |
| 242 | test_edge_smooth_face_selection | passed | 0.441 | 0.812 | 1.253 |  |
| 243 | test_smooth_with_subdivision_replaces_source_solid | passed | 47.902 | 2.296 | 50.198 |  |
| 244 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 37.347 | 5.120 | 42.467 |  |
| 245 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 75.793 | 4.964 | 80.757 |  |
| 246 | test_hole_through | passed | 39.754 | 4.023 | 43.778 |  |
| 247 | test_hole_countersink | passed | 63.308 | 5.259 | 68.568 |  |
| 248 | test_hole_counterbore | passed | 86.926 | 7.320 | 94.246 |  |
| 249 | test_hole_multi_point_cloned_cutter | passed | 169.057 | 10.267 | 179.324 |  |
| 250 | test_hole_thread_symbolic | passed | 90.014 | 4.777 | 94.792 |  |
| 251 | test_hole_thread_modeled | passed | 462.145 | 33.892 | 496.037 |  |
| 252 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 16.204 | 1.421 | 17.626 |  |
| 253 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 31.047 | 1.481 | 32.528 |  |
| 254 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.266 | 0.718 | 0.984 |  |
| 255 | test_run_history_calls_are_serialized | passed | 48.331 | 1.010 | 49.341 |  |
| 256 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 27.559 | 1.750 | 29.309 |  |
| 257 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 50.315 | 1.927 | 52.242 |  |
| 258 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 4363.247 | 44.621 | 4407.868 |  |
| 259 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 5168.529 | 0.000 | 5168.529 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32) |
| 260 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 5934.428 | 0.000 | 5934.428 | Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32) |
| 261 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 6497.422 | 0.000 | 6497.422 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G2_SW_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G4_SW, E2:S1:G5_SW_END, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW_END     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32) |
| 262 | test_pushFace_feature | passed | 5.869 | 7.278 | 13.147 |  |
| 263 | test_pushFace | passed | 43.277 | 4.154 | 47.431 |  |
| 264 | test_mirror | passed | 5.862 | 4.618 | 10.480 |  |
| 265 | test_pattern_circular_count_pitch_uses_angle_as_step | passed | 0.849 | 0.724 | 1.573 |  |
| 266 | test_history_features_basic | passed | 85.552 | 14.069 | 99.622 |  |
| 267 | test_history_expand_does_not_dirty | passed | 17.332 | 0.870 | 18.202 |  |
| 268 | test_history_test_snippet_persistent_data_allowlist | passed | 0.772 | 0.708 | 1.480 |  |
| 269 | test_history_test_snippet_includes_cam_operations | passed | 0.498 | 2.276 | 2.775 |  |
| 270 | test_history_test_snippet_toolbar_snapshot_compacts_cam_generated_data | passed | 0.575 | 1.052 | 1.627 |  |
| 271 | test_history_test_snippet_omits_empty_cam_state | passed | 0.267 | 1.551 | 1.818 |  |
| 272 | test_history_test_snippet_includes_global_cam_state_without_operations | passed | 0.281 | 1.609 | 1.889 |  |
| 273 | test_selection_owning_feature_resolution | passed | 0.955 | 1.813 | 2.768 |  |
| 274 | test_selection_line2_resolution_repair | passed | 92.163 | 2.451 | 94.614 |  |
| 275 | test_selection_hover_material_restores_before_dispose | passed | 0.453 | 1.099 | 1.552 |  |
| 276 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.285 | 0.897 | 1.183 |  |
| 277 | test_selection_sketch_hover_tints_material_in_place | passed | 0.356 | 0.829 | 1.185 |  |
| 278 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.541 | 0.914 | 1.455 |  |
| 279 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.705 | 0.803 | 1.508 |  |
| 280 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.274 | 0.903 | 1.177 |  |
| 281 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.467 | 1.062 | 1.528 |  |
| 282 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 10.572 | 1.020 | 11.592 |  |
| 283 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 7.278 | 1.429 | 8.707 |  |
| 284 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 8.720 | 0.997 | 9.718 |  |
| 285 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 7.545 | 0.993 | 8.538 |  |
| 286 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 7.485 | 1.132 | 8.617 |  |
| 287 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 15.552 | 1.149 | 16.701 |  |
| 288 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.086 | 1.083 | 3.168 |  |
| 289 | test_cam_plan_manager_preserves_operations_and_profiles | passed | 1.177 | 1.106 | 2.284 |  |
| 290 | test_cam_plan_manager_async_generation_reports_progress_steps | passed | 54.725 | 0.769 | 55.494 |  |
| 291 | test_cam_plan_manager_strips_legacy_generated_data | passed | 0.374 | 0.767 | 1.141 |  |
| 292 | test_cam_shadow_cutter_generated_history_20260704000935_keeps_outer_loop | passed | 244.990 | 0.956 | 245.946 |  |
| 293 | test_cam_shadow_cutter_cuts_each_loop_to_depth_before_next_loop | passed | 4.109 | 0.981 | 5.090 |  |
| 294 | test_cam_shadow_cutter_generates_clear_hole_loop | passed | 3.008 | 0.975 | 3.983 |  |
| 295 | test_cam_shadow_cutter_generates_outer_and_hole_for_nonconvex_profile | passed | 4.583 | 1.094 | 5.677 |  |
| 296 | test_cam_shadow_cutter_history_item_generates_toolpath | passed | 1.491 | 1.008 | 2.499 |  |
| 297 | test_cam_shadow_cutter_ignores_raised_cap_loops_as_holes | passed | 3.959 | 1.107 | 5.066 |  |
| 298 | test_cam_shadow_cutter_offset_keeps_l_shape_inside_corner_clear | passed | 0.910 | 1.026 | 1.936 |  |
| 299 | test_cam_shadow_cutter_offset_stays_outside_concave_shadow | passed | 1.392 | 0.987 | 2.380 |  |
| 300 | test_cam_roughing_history_item_generates_sliced_toolpaths | passed | 5.062 | 1.026 | 6.088 |  |
| 301 | test_cam_roughing_debug_slices_emit_layer_solids | passed | 2.887 | 0.965 | 3.852 |  |
| 302 | test_cam_roughing_debug_slices_create_real_scene_solids | passed | 22.894 | 3.745 | 26.639 |  |
| 303 | test_cam_roughing_debug_slices_survive_combined_cam_plan | passed | 8.504 | 0.938 | 9.442 |  |
| 304 | test_cam_roughing_sloped_slab_generates_each_step | passed | 2.483 | 0.844 | 3.327 |  |
| 305 | test_cam_roughing_unions_curved_slice_shadow_before_pathing | passed | 27.185 | 0.911 | 28.096 |  |
| 306 | test_cam_roughing_uses_each_slice_shadow | passed | 1.827 | 0.761 | 2.588 |  |
| 307 | test_cam_roughing_vertical_wall_slice_matches_shadow_cutter_loop | passed | 6.670 | 2.625 | 9.296 |  |
| 308 | test_cam_surfacing_adaptive_sampling_inserts_points_on_curved_face | passed | 15.397 | 1.873 | 17.271 |  |
| 309 | test_cam_surfacing_applies_parent_transform_to_direct_face_geometry | passed | 5.717 | 0.954 | 6.671 |  |
| 310 | test_cam_surfacing_both_raster_directions_emit_x_and_y_paths | passed | 41.219 | 0.918 | 42.137 |  |
| 311 | test_cam_surfacing_clearance_link_samples_narrow_preserved_geometry | passed | 5.398 | 0.779 | 6.177 |  |
| 312 | test_cam_surfacing_combined_gcode_posts_single_runnable_program | passed | 8.530 | 0.880 | 9.410 |  |
| 313 | test_cam_surfacing_combined_gcode_reissues_feed_after_roughing | passed | 7.973 | 1.093 | 9.066 |  |
| 314 | test_cam_surfacing_detects_narrow_preserved_island_between_coarse_samples | passed | 22.553 | 1.049 | 23.601 |  |
| 315 | test_cam_surfacing_does_not_cut_across_selected_face_hole | passed | 55.744 | 1.149 | 56.893 |  |
| 316 | test_cam_surfacing_does_not_duplicate_direct_face_with_owner_metadata | passed | 9.679 | 1.094 | 10.773 |  |
| 317 | test_cam_surfacing_flat_path_tolerance_zero_respects_sample_spacing | passed | 4.771 | 0.964 | 5.734 |  |
| 318 | test_cam_surfacing_history_item_generates_ball_endmill_raster | passed | 18.294 | 2.505 | 20.799 |  |
| 319 | test_cam_surfacing_follows_sloped_face_with_drop_cutter | passed | 8.038 | 1.113 | 9.151 |  |
| 320 | test_cam_surfacing_reaches_edge_beside_coplanar_preserved_face | passed | 12.476 | 0.925 | 13.401 |  |
| 321 | test_cam_surfacing_reports_warning_when_raster_too_dense | passed | 3.882 | 0.927 | 4.810 |  |
| 322 | test_cam_surfacing_resolves_solid_owned_face_reference | passed | 9.072 | 0.885 | 9.958 |  |
| 323 | test_cam_surfacing_uses_explicit_solid_owner_for_shared_face_name | passed | 10.055 | 1.153 | 11.208 |  |
| 324 | test_cam_surfacing_splits_runs_around_preserved_island | passed | 16.041 | 0.990 | 17.030 |  |
| 325 | test_cam_surfacing_stops_before_higher_adjacent_preserved_face | passed | 3.832 | 0.922 | 4.754 |  |
| 326 | test_cam_surfacing_stock_allowance_leaves_material_on_selected_face | passed | 9.499 | 1.020 | 10.519 |  |
| 327 | test_cam_surfacing_ui_reference_metadata_preserves_shared_face_owner | passed | 29.553 | 2.760 | 32.313 |  |
| 328 | test_cam_surfacing_uses_low_clearance_links_between_separate_face_spans | passed | 5.946 | 0.829 | 6.776 |  |
| 329 | test_cam_surfacing_falls_back_to_full_retract_when_low_hop_reaches_safe_height | passed | 4.581 | 0.802 | 5.383 |  |
| 330 | test_cam_surfacing_uses_userdata_solid_owner_for_shared_face_name | passed | 7.362 | 0.777 | 8.139 |  |
| 331 | test_cam_surfacing_y_raster_reaches_selected_face_edges | passed | 10.832 | 0.775 | 11.607 |  |
| 332 | test_cam_surfacing_zero_sample_spacing_uses_automatic_spacing | passed | 8.315 | 2.348 | 10.663 |  |
| 333 | test_cam_surfacing_rejects_vertical_face_without_projected_area | passed | 0.534 | 0.875 | 1.409 |  |
| 334 | test_cam_shadow_cutter_single_solid_does_not_require_target_selection | passed | 0.594 | 0.751 | 1.345 |  |
| 335 | test_cam_toolpath_simulator_displays_ball_endmill_round_tip | passed | 7.147 | 1.240 | 8.387 |  |
| 336 | test_cam_toolpath_simulator_visualizes_program_and_moves_head | passed | 1.099 | 0.653 | 1.753 |  |
| 337 | test_cam_shadow_cutter_uses_projected_outline_not_convex_hull | passed | 0.546 | 0.745 | 1.291 |  |
| 338 | test_cam_workbench_exit_clears_scene_artifacts | passed | 58.030 | 0.908 | 58.939 |  |
| 339 | test_cam_workbench_registers_shadow_cutter_and_roughing_operations | passed | 0.187 | 0.772 | 0.958 |  |
| 340 | test_cam_workbench_registers_and_persists_part_history_state | passed | 0.425 | 0.638 | 1.063 |  |
| 341 | test_visibility_hidden_state_persistence | passed | 10.086 | 4.003 | 14.089 |  |
| 342 | test_sketch_feature_scene_visibility | passed | 0.243 | 0.842 | 1.085 |  |
| 343 | test_textToFace | passed | 38.811 | 9.997 | 48.807 |  |
| 344 | test_sheetMetal_nonManifold_sm_f18 | passed | 124.224 | 0.819 | 125.042 |  |
| 345 | test_sheetMetal_tab_circular_hole_wall | passed | 16.124 | 1.819 | 17.943 |  |
| 346 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 10.571 | 1.002 | 11.573 |  |
| 347 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 5.462 | 1.188 | 6.650 |  |
| 348 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 103.034 | 1.970 | 105.005 |  |
| 349 | test_sheetMetal_tab_and_flange_context_buttons | passed | 0.437 | 0.844 | 1.281 |  |
| 350 | test_sheetMetal_cutout_preserves_multiple_profile_loops | passed | 132.347 | 6.738 | 139.084 |  |
| 351 | test_sheetMetal_cutout_context_button | passed | 0.266 | 0.855 | 1.120 |  |
| 352 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.215 | 0.772 | 0.986 |  |
| 353 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 36.020 | 4.556 | 40.576 |  |
| 354 | test_sheetMetal_cutoutEdge_flange_controls | passed | 4.859 | 0.746 | 5.605 |  |
| 355 | test_sheetMetal_corner_fillet | passed | 156.361 | 0.863 | 157.224 |  |
| 356 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 200.331 | 1.015 | 201.347 |  |
| 357 | test_sheetMetal_corner_fillet_selection_resolution | passed | 367.184 | 1.124 | 368.308 |  |
| 358 | test_sheetMetal_corner_fillet_compound_reference | passed | 318.209 | 0.940 | 319.149 |  |
| 359 | test_solidPointMinGap | passed | 1.009 | 0.875 | 1.884 |  |
| 360 | test_solidMetrics | passed | 5.106 | 1.580 | 6.686 |  |
| 361 | import_part_badBoolean | passed | 77.935 | 8.177 | 86.112 |  |
| 362 | import_part_extrudeTest | passed | 30.221 | 2.743 | 32.964 |  |
| 363 | import_part_filletFail | passed | 23.690 | 2.633 | 26.323 |  |
| 364 | import_part_fillet_angle_test.BREP | passed | 37.888 | 4.538 | 42.425 |  |
| 365 | import_part_fillet_test.BREP | passed | 1715.749 | 67.037 | 1782.786 |  |
| 366 | import_part_import_TEst.part.part | passed | 30.543 | 4.631 | 35.174 |  |
| 367 | import_part_medium_fillets.BREP | passed | 504.669 | 25.166 | 529.835 |  |
| 368 | import_part_sketch_throttel_testing.BREP | passed | 14.416 | 3.452 | 17.868 |  |
| 369 | import_part_slowsketch | passed | 1901.848 | 31.806 | 1933.655 |  |
| 370 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 17.265 | 0.847 | 18.112 |  |
| 371 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 7.458 | 0.858 | 8.316 |  |
| 372 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 993.765 | 3.956 | 997.722 |  |

Failure details:

1. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32)
```

2. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32)
```

3. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G2_SW_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G4_SW, E2:S1:G5_SW_END, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW_END
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1944:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1823:32)
```
