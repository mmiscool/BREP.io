# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 375
tests_run: 375
passed: 372
handled_errors: 0
skipped: 0
failed: 3
total_elapsed_ms: 130445.456

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_browser_skip_metadata_for_local_file_tests | passed | 6.263 | 9.234 | 15.497 |  |
| 2 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 5.999 | 2.298 | 8.296 |  |
| 3 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.844 | 1.922 | 3.765 |  |
| 4 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.264 | 1.682 | 2.947 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 0.938 | 1.336 | 2.274 |  |
| 6 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 0.841 | 1.605 | 2.446 |  |
| 7 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.591 | 1.290 | 1.880 |  |
| 8 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.605 | 1.167 | 1.772 |  |
| 9 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 6.305 | 1.402 | 7.707 |  |
| 10 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 1.110 | 1.738 | 2.848 |  |
| 11 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.183 | 1.162 | 2.345 |  |
| 12 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.818 | 1.281 | 4.099 |  |
| 13 | test_cppSolidMirror_preserves_face_metadata | passed | 5.372 | 1.214 | 6.586 |  |
| 14 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 2.257 | 1.342 | 3.599 |  |
| 15 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 58.714 | 1.398 | 60.113 |  |
| 16 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 8.311 | 1.240 | 9.552 |  |
| 17 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 7.313 | 1.408 | 8.721 |  |
| 18 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 65.002 | 3.519 | 68.522 |  |
| 19 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.636 | 1.274 | 1.909 |  |
| 20 | test_remesh_simplify_imported_fixture_stl | passed | 959.021 | 375.549 | 1334.570 |  |
| 21 | test_self_intersection_cleanup_feature_splits_selected_solid | passed | 7.979 | 1.124 | 9.103 |  |
| 22 | test_self_intersection_cleanup_feature_context_button_for_single_solid | passed | 0.187 | 1.218 | 1.406 |  |
| 23 | test_self_intersection_cleanup_feature_is_available_in_modeling_and_surfacing | passed | 0.179 | 1.415 | 1.594 |  |
| 24 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 5.782 | 1.313 | 7.095 |  |
| 25 | test_revolve_after_union_preserves_face_reference_resolution | passed | 109.744 | 6.640 | 116.384 |  |
| 26 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 0.957 | 1.075 | 2.031 |  |
| 27 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.807 | 0.922 | 1.729 |  |
| 28 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.423 | 0.804 | 1.227 |  |
| 29 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 0.934 | 0.754 | 1.688 |  |
| 30 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 10.149 | 1.272 | 11.421 |  |
| 31 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 1.045 | 0.937 | 1.982 |  |
| 32 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.875 | 0.811 | 1.686 |  |
| 33 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.321 | 0.853 | 1.174 |  |
| 34 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.587 | 0.932 | 1.519 |  |
| 35 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.574 | 0.964 | 1.539 |  |
| 36 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.865 | 0.964 | 2.828 |  |
| 37 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 1.844 | 0.960 | 2.804 |  |
| 38 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 16.434 | 1.185 | 17.619 |  |
| 39 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 13.818 | 0.988 | 14.806 |  |
| 40 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 14.951 | 1.036 | 15.987 |  |
| 41 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 14.791 | 1.030 | 15.822 |  |
| 42 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 11.684 | 1.111 | 12.795 |  |
| 43 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 15.388 | 1.135 | 16.523 |  |
| 44 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 9.026 | 0.892 | 9.918 |  |
| 45 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 8.711 | 0.907 | 9.618 |  |
| 46 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 7.656 | 0.927 | 8.583 |  |
| 47 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.818 | 0.894 | 1.711 |  |
| 48 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.527 | 1.012 | 2.538 |  |
| 49 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.056 | 0.800 | 1.857 |  |
| 50 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.936 | 1.116 | 2.052 |  |
| 51 | test_cppSolidNative_collapseFilletSideWallFaces_moves_shared_endcap_edge_vertices | passed | 1.874 | 0.834 | 2.709 |  |
| 52 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.876 | 0.894 | 1.770 |  |
| 53 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 10.454 | 1.222 | 11.676 |  |
| 54 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 32.574 | 1.474 | 34.048 |  |
| 55 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 16.388 | 1.109 | 17.497 |  |
| 56 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 22.597 | 1.340 | 23.937 |  |
| 57 | test_cppTube_native_builder_reports_selected_build_mode | passed | 7.341 | 1.191 | 8.531 |  |
| 58 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 16.500 | 1.372 | 17.872 |  |
| 59 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 5.138 | 1.247 | 6.385 |  |
| 60 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.744 | 1.038 | 1.782 |  |
| 61 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.777 | 1.476 | 3.253 |  |
| 62 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 2.397 | 1.263 | 3.660 |  |
| 63 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 17.111 | 1.335 | 18.446 |  |
| 64 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 3.595 | 1.272 | 4.867 |  |
| 65 | test_configurator_expressions | passed | 1.718 | 2.471 | 4.189 |  |
| 66 | test_manifoldPlus_sum | passed | 0.293 | 2.443 | 2.736 |  |
| 67 | test_plane | passed | 1.706 | 2.452 | 4.159 |  |
| 68 | test_primitiveCube | passed | 6.747 | 9.364 | 16.111 |  |
| 69 | test_primitivePyramid | passed | 4.527 | 2.176 | 6.703 |  |
| 70 | test_primitiveCylinder | passed | 6.770 | 3.165 | 9.935 |  |
| 71 | test_face_source_feature_seed | passed | 11.423 | 1.793 | 13.216 |  |
| 72 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 1.212 | 0.994 | 2.206 |  |
| 73 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.678 | 1.175 | 1.853 |  |
| 74 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 9.244 | 1.052 | 10.296 |  |
| 75 | test_mesh_cleanup_find_one_triangle_intersected_by_multiple_triangles | passed | 1.515 | 0.861 | 2.377 |  |
| 76 | test_mesh_cleanup_two_cut_segments_cross_inside_same_triangle | passed | 1.476 | 0.841 | 2.317 |  |
| 77 | test_mesh_cleanup_intersection_endpoint_on_shared_mesh_edge | passed | 0.532 | 0.816 | 1.349 |  |
| 78 | test_mesh_cleanup_detects_coplanar_partial_triangle_overlap | passed | 0.772 | 0.837 | 1.609 |  |
| 79 | test_mesh_cleanup_removes_geometrically_duplicate_triangles | passed | 0.751 | 0.842 | 1.593 |  |
| 80 | test_mesh_cleanup_removes_closed_box_completely_inside_another | passed | 2.825 | 1.127 | 3.952 |  |
| 81 | test_mesh_cleanup_overlapping_boxes_volume_equals_union | passed | 13.573 | 1.212 | 14.785 |  |
| 82 | test_mesh_cleanup_disjoint_closed_boxes_are_preserved | passed | 2.554 | 0.944 | 3.498 |  |
| 83 | test_mesh_cleanup_preserves_face_ids_after_splitting | passed | 0.522 | 0.856 | 1.378 |  |
| 84 | test_mesh_cleanup_complete_operation_is_idempotent | passed | 16.506 | 0.984 | 17.490 |  |
| 85 | test_offsetFace_preserves_individual_edges | passed | 8.998 | 1.606 | 10.604 |  |
| 86 | test_face_thicken_planar_profile | passed | 15.767 | 1.375 | 17.142 |  |
| 87 | test_face_thicken_hole_profile | passed | 18.899 | 1.203 | 20.102 |  |
| 88 | test_face_thicken_curved_cylinder_side | passed | 86.202 | 3.130 | 89.332 |  |
| 89 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 310.094 | 6.237 | 316.331 |  |
| 90 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 3.048 | 1.327 | 4.374 |  |
| 91 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 4.164 | 1.065 | 5.229 |  |
| 92 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 4.729 | 1.093 | 5.822 |  |
| 93 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 4.541 | 0.819 | 5.360 |  |
| 94 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 5.052 | 0.904 | 5.956 |  |
| 95 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 67.333 | 2.232 | 69.565 |  |
| 96 | test_face_thicken_self_overlap_cylinder_side | passed | 39.793 | 1.774 | 41.568 |  |
| 97 | test_thicken_sphere_torus_union | passed | 808.143 | 29.610 | 837.753 |  |
| 98 | test_offsetShell_thickens_all_faces_except_selected | passed | 27.808 | 2.328 | 30.136 |  |
| 99 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 199.783 | 4.297 | 204.081 |  |
| 100 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 107.505 | 1.009 | 108.514 |  |
| 101 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.541 | 0.823 | 1.364 |  |
| 102 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.474 | 0.896 | 1.370 |  |
| 103 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.746 | 1.012 | 1.758 |  |
| 104 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.275 | 0.798 | 2.073 |  |
| 105 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 0.730 | 0.820 | 1.549 |  |
| 106 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 1894.687 | 27.812 | 1922.498 |  |
| 107 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 1927.255 | 34.957 | 1962.212 |  |
| 108 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 179.441 | 7.068 | 186.509 |  |
| 109 | test_offsetShell_preserves_source_centerlines | passed | 456.424 | 0.898 | 457.322 |  |
| 110 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.157 | 1.060 | 1.217 |  |
| 111 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 17.487 | 2.311 | 19.798 |  |
| 112 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 25.523 | 1.979 | 27.502 |  |
| 113 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 23.344 | 1.927 | 25.271 |  |
| 114 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.503 | 0.792 | 1.295 |  |
| 115 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.270 | 0.762 | 1.032 |  |
| 116 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.464 | 0.708 | 1.172 |  |
| 117 | test_visualize_does_not_repair_face_ids | passed | 0.394 | 0.818 | 1.212 |  |
| 118 | test_primitiveCone | passed | 6.785 | 2.722 | 9.507 |  |
| 119 | test_primitiveTorus | passed | 46.708 | 18.852 | 65.560 |  |
| 120 | test_primitiveSphere | passed | 5.449 | 2.349 | 7.797 |  |
| 121 | test_feature_dimension_overlay_supports_port | passed | 0.128 | 0.747 | 0.875 |  |
| 122 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.135 | 0.759 | 0.894 |  |
| 123 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.506 | 0.789 | 1.295 |  |
| 124 | test_feature_dimension_annotation_builder_dispatches_pattern | passed | 1.359 | 0.886 | 2.246 |  |
| 125 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.317 | 0.768 | 1.085 |  |
| 126 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.451 | 0.782 | 1.233 |  |
| 127 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.549 | 0.806 | 1.355 |  |
| 128 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.815 | 0.937 | 1.752 |  |
| 129 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.296 | 0.882 | 1.177 |  |
| 130 | test_transform_reference_sanitize_preserves_metadata | passed | 0.185 | 0.800 | 0.985 |  |
| 131 | test_transform_reference_base_uses_face_pick_point | passed | 0.461 | 0.813 | 1.273 |  |
| 132 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.299 | 2.258 | 2.557 |  |
| 133 | test_port_definition_uses_transform_reference_without_anchor | passed | 1.142 | 2.335 | 3.477 |  |
| 134 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.472 | 2.437 | 2.908 |  |
| 135 | test_boolean_subtract | passed | 37.071 | 9.835 | 46.906 |  |
| 136 | test_boolean_face_metadata_preserved | passed | 141.390 | 1.236 | 142.626 |  |
| 137 | test_primitive_boolean_union_preserves_face_grouping | passed | 61.003 | 2.558 | 63.562 |  |
| 138 | test_boolean_operation_target_name_preserved | passed | 17.602 | 4.164 | 21.766 |  |
| 139 | test_stlLoader | passed | 66.203 | 17.345 | 83.548 |  |
| 140 | test_import3d_decimation_reduces_triangle_count | passed | 25.905 | 17.932 | 43.837 |  |
| 141 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 21.570 | 6.780 | 28.350 |  |
| 142 | test_import3d_decimation_99_is_near_full_detail | passed | 43.134 | 29.141 | 72.275 |  |
| 143 | test_import3d_decimation_100_restores_original_geometry | passed | 36.790 | 15.990 | 52.779 |  |
| 144 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 41.306 | 7.292 | 48.598 |  |
| 145 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 39.238 | 12.587 | 51.825 |  |
| 146 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.003 | 2.200 | 4.203 |  |
| 147 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.391 | 0.808 | 1.199 |  |
| 148 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.325 | 0.792 | 1.118 |  |
| 149 | test_import3d_fixture_merges_faces_4_and_34 | passed | 874.549 | 507.115 | 1381.664 |  |
| 150 | test_import3d_extract_multiple_solids_toggle | passed | 26.056 | 8.413 | 34.469 |  |
| 151 | test_SweepFace | passed | 73.255 | 5.185 | 78.440 |  |
| 152 | test_SweepFace_pathAlign_multi_loop_islands | passed | 32.752 | 4.794 | 37.547 |  |
| 153 | test_tube | passed | 135.340 | 20.651 | 155.991 |  |
| 154 | test_tube_closedLoop | passed | 67.860 | 17.975 | 85.835 |  |
| 155 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.396 | 0.962 | 1.358 |  |
| 156 | test_wire_harness_connection_endpoint_resolution | passed | 1.134 | 1.038 | 2.172 |  |
| 157 | test_sheet_custom_size_persists | passed | 1.267 | 1.242 | 2.509 |  |
| 158 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.539 | 0.917 | 1.456 |  |
| 159 | test_pmi_view_text_size_setting_normalizes | passed | 0.368 | 0.987 | 1.355 |  |
| 160 | test_pmi_view_visibility_state_normalizes | passed | 0.198 | 0.818 | 1.016 |  |
| 161 | test_pmi_view_visibility_state_round_trip | passed | 5.225 | 1.284 | 6.509 |  |
| 162 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 1.738 | 1.333 | 3.070 |  |
| 163 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.389 | 0.793 | 1.182 |  |
| 164 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.425 | 0.842 | 1.267 |  |
| 165 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 1.031 | 0.948 | 1.979 |  |
| 166 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.334 | 0.812 | 1.146 |  |
| 167 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.291 | 0.697 | 0.988 |  |
| 168 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.489 | 0.805 | 1.294 |  |
| 169 | test_pmi_annotation_failure_status_is_visible | passed | 0.464 | 1.026 | 1.490 |  |
| 170 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 2.069 | 1.280 | 3.348 |  |
| 171 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.791 | 1.307 | 2.098 |  |
| 172 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.462 | 1.050 | 1.512 |  |
| 173 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 1.366 | 0.854 | 2.220 |  |
| 174 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.127 | 0.786 | 0.913 |  |
| 175 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.196 | 0.759 | 0.956 |  |
| 176 | test_pmi_export_render_context_applies_visibility_state | passed | 1.076 | 0.911 | 1.988 |  |
| 177 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.186 | 0.840 | 1.026 |  |
| 178 | test_sheet_clipboard_image_utils | passed | 0.686 | 0.940 | 1.626 |  |
| 179 | test_wire_harness_formboard_insert | passed | 7.174 | 0.945 | 8.119 |  |
| 180 | test_wire_harness_sheet_table_insert | passed | 1.861 | 0.857 | 2.718 |  |
| 181 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.953 | 1.012 | 2.964 |  |
| 182 | test_wire_harness_routes_render_as_scene_solids | passed | 6.636 | 1.395 | 8.031 |  |
| 183 | test_wire_harness_route_results_persist_in_model_json | passed | 1.091 | 0.888 | 1.979 |  |
| 184 | test_sketch_openLoop | passed | 3.339 | 1.302 | 4.641 |  |
| 185 | test_sketch_snapshot_restore_selection_handlers | passed | 11.192 | 1.195 | 12.387 |  |
| 186 | test_sketch_face_attachment_alignment | passed | 641.984 | 9.307 | 651.290 |  |
| 187 | test_sketch_solver_topology_rect_shared_points | passed | 10.858 | 1.062 | 11.919 |  |
| 188 | test_sketch_solver_topology_coincident_chain | passed | 13.563 | 1.245 | 14.808 |  |
| 189 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 18.388 | 0.975 | 19.363 |  |
| 190 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 17.644 | 1.088 | 18.732 |  |
| 191 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 39.027 | 0.949 | 39.976 |  |
| 192 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.718 | 1.159 | 2.876 |  |
| 193 | test_sketch_solver_line_to_point_distance_constraint | passed | 5.145 | 3.456 | 8.601 |  |
| 194 | test_extrude_negative_distance_cap_alignment | passed | 9.561 | 1.854 | 11.415 |  |
| 195 | test_extrude_intersect_coplanar_face_merge | passed | 1846.413 | 14.718 | 1861.131 |  |
| 196 | test_ExtrudeFace | passed | 26.890 | 5.992 | 32.882 |  |
| 197 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 8.361 | 1.368 | 9.729 |  |
| 198 | test_Fillet | passed | 476.710 | 34.019 | 510.730 |  |
| 199 | test_fillet_angle | passed | 15.399 | 2.669 | 18.068 |  |
| 200 | test_fillet_corner_bridge | passed | 43.215 | 5.585 | 48.800 |  |
| 201 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 43.359 | 1.763 | 45.122 |  |
| 202 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 36.902 | 6.033 | 42.935 |  |
| 203 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 31.174 | 1.566 | 32.740 |  |
| 204 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 106.473 | 12.175 | 118.648 |  |
| 205 | test_fillet_edge_degenerate_segment | passed | 1418.794 | 32.918 | 1451.711 |  |
| 206 | test_sketch_profile_tolerant_loop_join | passed | 1612.946 | 10.107 | 1623.052 |  |
| 207 | test_fillet_compound_snapshot_resolution | passed | 2104.244 | 21.489 | 2125.732 |  |
| 208 | test_fillet_generated_history_20260321144106 | passed | 4134.313 | 150.065 | 4284.378 |  |
| 209 | test_generated_history_20260709065543 | passed | 443.975 | 120.570 | 564.545 |  |
| 210 | test_generated_history_20260709065543_base_thickness | passed | 260.225 | 118.945 | 379.170 |  |
| 211 | test_generated_history_20260322220620 | passed | 9374.240 | 202.668 | 9576.909 |  |
| 212 | test_generated_history_20260322222832 | passed | 86.998 | 5.713 | 92.711 |  |
| 213 | test_generated_history_20260418030116 | passed | 986.593 | 38.448 | 1025.041 |  |
| 214 | test_generated_history_20260427005357 | passed | 2487.979 | 45.186 | 2533.165 |  |
| 215 | test_generated_history_20260427005357_three_face_thicken | passed | 648.924 | 24.211 | 673.134 |  |
| 216 | test_generated_history_20260427005357_nine_face_thicken | passed | 1976.617 | 35.583 | 2012.200 |  |
| 217 | test_generated_history_20260523000414 | passed | 1595.254 | 73.667 | 1668.921 |  |
| 218 | test_generated_history_20260531201126 | passed | 215.805 | 19.400 | 235.204 |  |
| 219 | test_generated_history_20260606004152 | passed | 11446.072 | 308.789 | 11754.861 |  |
| 220 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 4896.357 | 3.930 | 4900.288 |  |
| 221 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 5342.199 | 6.320 | 5348.518 |  |
| 222 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 6227.746 | 6.996 | 6234.742 |  |
| 223 | test_generated_history_20260709035143_offset_shell_prefers_source_face_names | passed | 5438.555 | 58.946 | 5497.501 |  |
| 224 | test_generated_history_20260612230031 | passed | 67.089 | 4.155 | 71.245 |  |
| 225 | test_generated_history_20260612232755 | passed | 553.785 | 19.845 | 573.630 |  |
| 226 | test_generated_history_20260613000139 | passed | 78.567 | 3.709 | 82.276 |  |
| 227 | test_generated_history_20260613003952 | passed | 7944.254 | 199.496 | 8143.750 |  |
| 228 | test_fillet_preserves_original_face_names | passed | 560.185 | 20.002 | 580.188 |  |
| 229 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 552.822 | 20.022 | 572.844 |  |
| 230 | test_Fillet_NonClosed | passed | 19.291 | 2.696 | 21.987 |  |
| 231 | test_fillets_more_dificult | passed | 1829.675 | 98.774 | 1928.449 |  |
| 232 | test_Chamfer | passed | 13.414 | 1.958 | 15.372 |  |
| 233 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 4.188 | 1.014 | 5.203 |  |
| 234 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 3.734 | 0.905 | 4.639 |  |
| 235 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 226.335 | 13.884 | 240.219 |  |
| 236 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 360.171 | 9.882 | 370.053 |  |
| 237 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 238.752 | 13.147 | 251.899 |  |
| 238 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 246.427 | 10.617 | 257.044 |  |
| 239 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 262.552 | 10.525 | 273.077 |  |
| 240 | test_edge_smooth_curve_fit | passed | 0.737 | 0.897 | 1.635 |  |
| 241 | test_edge_smooth_curve_fit_closed_loop | passed | 0.626 | 0.899 | 1.525 |  |
| 242 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.701 | 0.821 | 1.522 |  |
| 243 | test_edge_smooth_closed_loop_feature_selection | passed | 1.824 | 0.826 | 2.650 |  |
| 244 | test_edge_smooth_whole_solid_selection | passed | 0.477 | 0.782 | 1.258 |  |
| 245 | test_edge_smooth_face_selection | passed | 0.394 | 0.802 | 1.197 |  |
| 246 | test_smooth_with_subdivision_replaces_source_solid | passed | 47.171 | 2.136 | 49.306 |  |
| 247 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 37.658 | 5.684 | 43.342 |  |
| 248 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 94.513 | 5.209 | 99.721 |  |
| 249 | test_hole_through | passed | 49.638 | 4.454 | 54.092 |  |
| 250 | test_hole_countersink | passed | 65.438 | 6.191 | 71.630 |  |
| 251 | test_hole_counterbore | passed | 95.017 | 6.863 | 101.880 |  |
| 252 | test_hole_multi_point_cloned_cutter | passed | 186.880 | 11.693 | 198.573 |  |
| 253 | test_hole_thread_symbolic | passed | 106.282 | 5.632 | 111.914 |  |
| 254 | test_hole_thread_modeled | passed | 488.602 | 38.571 | 527.173 |  |
| 255 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 15.978 | 1.364 | 17.342 |  |
| 256 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 36.248 | 1.793 | 38.041 |  |
| 257 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.319 | 0.907 | 1.226 |  |
| 258 | test_run_history_calls_are_serialized | passed | 49.962 | 1.162 | 51.124 |  |
| 259 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 32.079 | 2.381 | 34.460 |  |
| 260 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 53.919 | 3.121 | 57.040 |  |
| 261 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 5227.171 | 50.630 | 5277.801 |  |
| 262 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 6486.145 | 0.000 | 6486.145 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32) |
| 263 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 8275.728 | 0.000 | 8275.728 | Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32) |
| 264 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 7989.240 | 0.000 | 7989.240 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32) |
| 265 | test_pushFace_feature | passed | 6.635 | 15.113 | 21.748 |  |
| 266 | test_pushFace | passed | 49.852 | 4.680 | 54.532 |  |
| 267 | test_mirror | passed | 8.191 | 2.073 | 10.264 |  |
| 268 | test_pattern_circular_count_pitch_uses_angle_as_step | passed | 0.950 | 0.816 | 1.765 |  |
| 269 | test_history_features_basic | passed | 108.551 | 11.963 | 120.515 |  |
| 270 | test_history_expand_does_not_dirty | passed | 20.463 | 1.428 | 21.890 |  |
| 271 | test_history_test_snippet_persistent_data_allowlist | passed | 0.979 | 0.842 | 1.821 |  |
| 272 | test_history_test_snippet_includes_cam_operations | passed | 0.585 | 0.746 | 1.331 |  |
| 273 | test_history_test_snippet_toolbar_snapshot_compacts_cam_generated_data | passed | 0.607 | 0.790 | 1.397 |  |
| 274 | test_history_test_snippet_omits_empty_cam_state | passed | 0.149 | 0.764 | 0.913 |  |
| 275 | test_history_test_snippet_includes_global_cam_state_without_operations | passed | 0.167 | 0.778 | 0.945 |  |
| 276 | test_selection_owning_feature_resolution | passed | 0.567 | 0.739 | 1.305 |  |
| 277 | test_selection_line2_resolution_repair | passed | 3.713 | 0.884 | 4.597 |  |
| 278 | test_selection_hover_material_restores_before_dispose | passed | 0.463 | 0.801 | 1.264 |  |
| 279 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.477 | 0.964 | 1.440 |  |
| 280 | test_selection_sketch_hover_tints_material_in_place | passed | 0.473 | 0.770 | 1.243 |  |
| 281 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.677 | 0.762 | 1.439 |  |
| 282 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.745 | 0.772 | 1.517 |  |
| 283 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.282 | 0.741 | 1.022 |  |
| 284 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.505 | 0.756 | 1.261 |  |
| 285 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 10.993 | 0.924 | 11.917 |  |
| 286 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 9.044 | 0.969 | 10.013 |  |
| 287 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 11.564 | 6.635 | 18.199 |  |
| 288 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 9.070 | 1.061 | 10.130 |  |
| 289 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 9.293 | 0.968 | 10.261 |  |
| 290 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 19.037 | 1.078 | 20.115 |  |
| 291 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.241 | 0.825 | 3.065 |  |
| 292 | test_cam_plan_manager_preserves_operations_and_profiles | passed | 1.138 | 0.882 | 2.021 |  |
| 293 | test_cam_plan_manager_async_generation_reports_progress_steps | passed | 73.118 | 0.970 | 74.088 |  |
| 294 | test_cam_plan_manager_strips_legacy_generated_data | passed | 0.454 | 0.882 | 1.336 |  |
| 295 | test_cam_shadow_cutter_generated_history_20260704000935_keeps_outer_loop | passed | 297.728 | 3.444 | 301.172 |  |
| 296 | test_cam_shadow_cutter_cuts_each_loop_to_depth_before_next_loop | passed | 5.836 | 1.714 | 7.550 |  |
| 297 | test_cam_shadow_cutter_generates_clear_hole_loop | passed | 4.935 | 2.170 | 7.105 |  |
| 298 | test_cam_shadow_cutter_generates_outer_and_hole_for_nonconvex_profile | passed | 6.989 | 1.644 | 8.633 |  |
| 299 | test_cam_shadow_cutter_history_item_generates_toolpath | passed | 1.838 | 1.614 | 3.451 |  |
| 300 | test_cam_shadow_cutter_ignores_raised_cap_loops_as_holes | passed | 5.312 | 1.713 | 7.025 |  |
| 301 | test_cam_shadow_cutter_offset_keeps_l_shape_inside_corner_clear | passed | 1.432 | 1.339 | 2.771 |  |
| 302 | test_cam_shadow_cutter_offset_stays_outside_concave_shadow | passed | 2.125 | 1.387 | 3.512 |  |
| 303 | test_cam_roughing_history_item_generates_sliced_toolpaths | passed | 8.671 | 1.669 | 10.340 |  |
| 304 | test_cam_roughing_debug_slices_emit_layer_solids | passed | 4.259 | 1.607 | 5.867 |  |
| 305 | test_cam_roughing_debug_slices_create_real_scene_solids | passed | 27.713 | 1.164 | 28.878 |  |
| 306 | test_cam_roughing_debug_slices_survive_combined_cam_plan | passed | 10.571 | 3.357 | 13.928 |  |
| 307 | test_cam_roughing_sloped_slab_generates_each_step | passed | 3.380 | 1.189 | 4.569 |  |
| 308 | test_cam_roughing_unions_curved_slice_shadow_before_pathing | passed | 27.504 | 1.151 | 28.655 |  |
| 309 | test_cam_roughing_uses_each_slice_shadow | passed | 2.782 | 1.555 | 4.337 |  |
| 310 | test_cam_roughing_vertical_wall_slice_matches_shadow_cutter_loop | passed | 11.445 | 4.909 | 16.354 |  |
| 311 | test_cam_surfacing_adaptive_sampling_inserts_points_on_curved_face | passed | 22.916 | 1.629 | 24.544 |  |
| 312 | test_cam_surfacing_applies_parent_transform_to_direct_face_geometry | passed | 10.605 | 1.173 | 11.778 |  |
| 313 | test_cam_surfacing_both_raster_directions_emit_x_and_y_paths | passed | 49.288 | 1.423 | 50.711 |  |
| 314 | test_cam_surfacing_clearance_link_samples_narrow_preserved_geometry | passed | 6.275 | 0.922 | 7.197 |  |
| 315 | test_cam_surfacing_combined_gcode_posts_single_runnable_program | passed | 9.444 | 0.989 | 10.433 |  |
| 316 | test_cam_surfacing_combined_gcode_reissues_feed_after_roughing | passed | 8.287 | 0.936 | 9.223 |  |
| 317 | test_cam_surfacing_detects_narrow_preserved_island_between_coarse_samples | passed | 22.125 | 1.037 | 23.161 |  |
| 318 | test_cam_surfacing_does_not_cut_across_selected_face_hole | passed | 56.641 | 1.030 | 57.672 |  |
| 319 | test_cam_surfacing_does_not_duplicate_direct_face_with_owner_metadata | passed | 9.239 | 1.126 | 10.364 |  |
| 320 | test_cam_surfacing_flat_path_tolerance_zero_respects_sample_spacing | passed | 5.921 | 1.071 | 6.992 |  |
| 321 | test_cam_surfacing_history_item_generates_ball_endmill_raster | passed | 23.099 | 2.877 | 25.976 |  |
| 322 | test_cam_surfacing_follows_sloped_face_with_drop_cutter | passed | 10.193 | 1.335 | 11.528 |  |
| 323 | test_cam_surfacing_reaches_edge_beside_coplanar_preserved_face | passed | 13.354 | 1.292 | 14.646 |  |
| 324 | test_cam_surfacing_reports_warning_when_raster_too_dense | passed | 4.265 | 1.006 | 5.271 |  |
| 325 | test_cam_surfacing_resolves_solid_owned_face_reference | passed | 9.451 | 1.082 | 10.533 |  |
| 326 | test_cam_surfacing_uses_explicit_solid_owner_for_shared_face_name | passed | 9.906 | 1.211 | 11.117 |  |
| 327 | test_cam_surfacing_splits_runs_around_preserved_island | passed | 15.920 | 1.327 | 17.247 |  |
| 328 | test_cam_surfacing_stops_before_higher_adjacent_preserved_face | passed | 4.066 | 0.957 | 5.022 |  |
| 329 | test_cam_surfacing_stock_allowance_leaves_material_on_selected_face | passed | 8.975 | 1.034 | 10.010 |  |
| 330 | test_cam_surfacing_ui_reference_metadata_preserves_shared_face_owner | passed | 32.074 | 3.945 | 36.019 |  |
| 331 | test_cam_surfacing_uses_low_clearance_links_between_separate_face_spans | passed | 7.290 | 0.881 | 8.171 |  |
| 332 | test_cam_surfacing_falls_back_to_full_retract_when_low_hop_reaches_safe_height | passed | 5.348 | 1.027 | 6.375 |  |
| 333 | test_cam_surfacing_uses_userdata_solid_owner_for_shared_face_name | passed | 8.639 | 0.998 | 9.637 |  |
| 334 | test_cam_surfacing_y_raster_reaches_selected_face_edges | passed | 13.014 | 1.076 | 14.090 |  |
| 335 | test_cam_surfacing_zero_sample_spacing_uses_automatic_spacing | passed | 10.450 | 3.593 | 14.043 |  |
| 336 | test_cam_surfacing_rejects_vertical_face_without_projected_area | passed | 0.658 | 1.001 | 1.659 |  |
| 337 | test_cam_shadow_cutter_single_solid_does_not_require_target_selection | passed | 0.911 | 1.214 | 2.125 |  |
| 338 | test_cam_toolpath_simulator_displays_ball_endmill_round_tip | passed | 7.606 | 1.045 | 8.651 |  |
| 339 | test_cam_toolpath_simulator_visualizes_program_and_moves_head | passed | 1.139 | 1.358 | 2.497 |  |
| 340 | test_cam_shadow_cutter_uses_projected_outline_not_convex_hull | passed | 0.987 | 1.065 | 2.052 |  |
| 341 | test_cam_workbench_exit_clears_scene_artifacts | passed | 76.571 | 1.469 | 78.041 |  |
| 342 | test_cam_workbench_registers_shadow_cutter_and_roughing_operations | passed | 0.225 | 0.879 | 1.104 |  |
| 343 | test_cam_workbench_registers_and_persists_part_history_state | passed | 0.462 | 0.785 | 1.247 |  |
| 344 | test_visibility_hidden_state_persistence | passed | 11.231 | 6.701 | 17.932 |  |
| 345 | test_sketch_feature_scene_visibility | passed | 0.235 | 0.887 | 1.121 |  |
| 346 | test_textToFace | passed | 45.737 | 12.675 | 58.412 |  |
| 347 | test_sheetMetal_nonManifold_sm_f18 | passed | 155.735 | 4.686 | 160.421 |  |
| 348 | test_sheetMetal_tab_circular_hole_wall | passed | 34.761 | 1.981 | 36.742 |  |
| 349 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 39.826 | 1.279 | 41.105 |  |
| 350 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 6.336 | 1.105 | 7.441 |  |
| 351 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 130.252 | 4.042 | 134.294 |  |
| 352 | test_sheetMetal_tab_and_flange_context_buttons | passed | 0.765 | 1.382 | 2.146 |  |
| 353 | test_sheetMetal_cutout_preserves_multiple_profile_loops | passed | 164.058 | 9.468 | 173.526 |  |
| 354 | test_sheetMetal_cutout_context_button | passed | 0.263 | 0.933 | 1.196 |  |
| 355 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.219 | 0.879 | 1.098 |  |
| 356 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 42.695 | 5.602 | 48.297 |  |
| 357 | test_sheetMetal_cutoutEdge_flange_controls | passed | 6.732 | 1.109 | 7.841 |  |
| 358 | test_sheetMetal_corner_fillet | passed | 194.966 | 1.211 | 196.177 |  |
| 359 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 189.031 | 1.102 | 190.132 |  |
| 360 | test_sheetMetal_corner_fillet_selection_resolution | passed | 414.802 | 1.487 | 416.290 |  |
| 361 | test_sheetMetal_corner_fillet_compound_reference | passed | 332.862 | 1.677 | 334.539 |  |
| 362 | test_solidPointMinGap | passed | 0.955 | 0.903 | 1.858 |  |
| 363 | test_solidMetrics | passed | 5.712 | 1.682 | 7.394 |  |
| 364 | import_part_badBoolean | passed | 91.279 | 8.930 | 100.209 |  |
| 365 | import_part_extrudeTest | passed | 28.356 | 2.561 | 30.918 |  |
| 366 | import_part_filletFail | passed | 21.786 | 2.675 | 24.461 |  |
| 367 | import_part_fillet_angle_test.BREP | passed | 39.450 | 4.725 | 44.176 |  |
| 368 | import_part_fillet_test.BREP | passed | 2505.303 | 80.139 | 2585.442 |  |
| 369 | import_part_import_TEst.part.part | passed | 32.434 | 4.812 | 37.246 |  |
| 370 | import_part_medium_fillets.BREP | passed | 644.621 | 34.497 | 679.119 |  |
| 371 | import_part_sketch_throttel_testing.BREP | passed | 19.504 | 4.365 | 23.869 |  |
| 372 | import_part_slowsketch | passed | 2433.014 | 39.650 | 2472.665 |  |
| 373 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 21.188 | 1.017 | 22.205 |  |
| 374 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 9.424 | 1.364 | 10.789 |  |
| 375 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 1440.328 | 4.970 | 1445.298 |  |

Failure details:

1. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32)
```

2. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32)
```

3. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1973:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1852:32)
```
