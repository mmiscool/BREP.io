# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 374
tests_run: 374
passed: 371
handled_errors: 0
skipped: 0
failed: 3
total_elapsed_ms: 105056.453

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_browser_skip_metadata_for_local_file_tests | passed | 6.218 | 8.578 | 14.796 |  |
| 2 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 4.697 | 2.043 | 6.740 |  |
| 3 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.479 | 1.695 | 3.174 |  |
| 4 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 0.990 | 1.241 | 2.231 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 0.971 | 1.349 | 2.320 |  |
| 6 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 0.662 | 1.501 | 2.163 |  |
| 7 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.733 | 1.401 | 2.134 |  |
| 8 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.644 | 1.245 | 1.889 |  |
| 9 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 4.967 | 1.069 | 6.036 |  |
| 10 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 0.888 | 1.527 | 2.414 |  |
| 11 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.289 | 1.439 | 2.728 |  |
| 12 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.832 | 1.273 | 4.105 |  |
| 13 | test_cppSolidMirror_preserves_face_metadata | passed | 5.147 | 1.247 | 6.394 |  |
| 14 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 2.018 | 1.349 | 3.368 |  |
| 15 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 57.045 | 1.149 | 58.194 |  |
| 16 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 11.343 | 1.515 | 12.858 |  |
| 17 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 6.075 | 1.268 | 7.343 |  |
| 18 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 72.228 | 3.792 | 76.020 |  |
| 19 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.530 | 1.266 | 1.796 |  |
| 20 | test_remesh_simplify_imported_fixture_stl | passed | 927.808 | 342.663 | 1270.471 |  |
| 21 | test_self_intersection_cleanup_feature_splits_selected_solid | passed | 6.742 | 1.051 | 7.793 |  |
| 22 | test_self_intersection_cleanup_feature_context_button_for_single_solid | passed | 0.198 | 1.135 | 1.333 |  |
| 23 | test_self_intersection_cleanup_feature_is_available_in_modeling_and_surfacing | passed | 0.164 | 1.185 | 1.349 |  |
| 24 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 5.801 | 1.144 | 6.945 |  |
| 25 | test_revolve_after_union_preserves_face_reference_resolution | passed | 106.101 | 10.085 | 116.186 |  |
| 26 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 1.234 | 1.315 | 2.549 |  |
| 27 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 1.020 | 1.180 | 2.200 |  |
| 28 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.446 | 0.809 | 1.255 |  |
| 29 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 0.988 | 0.775 | 1.763 |  |
| 30 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 10.319 | 1.176 | 11.495 |  |
| 31 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 1.283 | 0.954 | 2.237 |  |
| 32 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.879 | 0.803 | 1.682 |  |
| 33 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.319 | 0.790 | 1.110 |  |
| 34 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.513 | 0.824 | 1.337 |  |
| 35 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.513 | 0.875 | 1.388 |  |
| 36 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.658 | 1.205 | 2.863 |  |
| 37 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 2.427 | 0.930 | 3.358 |  |
| 38 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 17.274 | 1.271 | 18.545 |  |
| 39 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 14.572 | 1.151 | 15.723 |  |
| 40 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 15.739 | 1.377 | 17.116 |  |
| 41 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 12.492 | 1.037 | 13.529 |  |
| 42 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 12.035 | 0.957 | 12.992 |  |
| 43 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 12.308 | 0.938 | 13.246 |  |
| 44 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 8.329 | 0.848 | 9.177 |  |
| 45 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 7.203 | 0.810 | 8.014 |  |
| 46 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 6.673 | 0.804 | 7.478 |  |
| 47 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.741 | 0.741 | 1.482 |  |
| 48 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.423 | 0.785 | 2.207 |  |
| 49 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.203 | 0.803 | 2.006 |  |
| 50 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.981 | 0.796 | 1.777 |  |
| 51 | test_cppSolidNative_collapseFilletSideWallFaces_moves_shared_endcap_edge_vertices | passed | 1.581 | 0.807 | 2.388 |  |
| 52 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.886 | 0.868 | 1.754 |  |
| 53 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 8.688 | 0.828 | 9.516 |  |
| 54 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 29.044 | 1.053 | 30.096 |  |
| 55 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 14.369 | 1.103 | 15.472 |  |
| 56 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 20.528 | 1.266 | 21.794 |  |
| 57 | test_cppTube_native_builder_reports_selected_build_mode | passed | 6.867 | 1.276 | 8.143 |  |
| 58 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 15.483 | 1.494 | 16.977 |  |
| 59 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 4.866 | 1.175 | 6.041 |  |
| 60 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.754 | 1.212 | 1.966 |  |
| 61 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.924 | 1.514 | 3.437 |  |
| 62 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 2.320 | 1.328 | 3.648 |  |
| 63 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 17.650 | 1.558 | 19.208 |  |
| 64 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 3.397 | 1.164 | 4.561 |  |
| 65 | test_configurator_expressions | passed | 1.569 | 3.648 | 5.217 |  |
| 66 | test_manifoldPlus_sum | passed | 0.333 | 2.715 | 3.049 |  |
| 67 | test_plane | passed | 1.936 | 6.911 | 8.847 |  |
| 68 | test_primitiveCube | passed | 5.735 | 2.825 | 8.560 |  |
| 69 | test_primitivePyramid | passed | 3.403 | 1.505 | 4.907 |  |
| 70 | test_primitiveCylinder | passed | 7.196 | 3.568 | 10.764 |  |
| 71 | test_face_source_feature_seed | passed | 9.084 | 2.232 | 11.315 |  |
| 72 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 1.262 | 0.922 | 2.184 |  |
| 73 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.632 | 1.242 | 1.875 |  |
| 74 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 9.135 | 1.199 | 10.334 |  |
| 75 | test_mesh_cleanup_find_one_triangle_intersected_by_multiple_triangles | passed | 2.024 | 0.924 | 2.948 |  |
| 76 | test_mesh_cleanup_two_cut_segments_cross_inside_same_triangle | passed | 1.880 | 0.935 | 2.815 |  |
| 77 | test_mesh_cleanup_intersection_endpoint_on_shared_mesh_edge | passed | 0.496 | 0.753 | 1.249 |  |
| 78 | test_mesh_cleanup_detects_coplanar_partial_triangle_overlap | passed | 0.746 | 0.767 | 1.513 |  |
| 79 | test_mesh_cleanup_removes_geometrically_duplicate_triangles | passed | 0.769 | 0.801 | 1.571 |  |
| 80 | test_mesh_cleanup_removes_closed_box_completely_inside_another | passed | 2.623 | 0.924 | 3.547 |  |
| 81 | test_mesh_cleanup_overlapping_boxes_volume_equals_union | passed | 14.658 | 0.983 | 15.641 |  |
| 82 | test_mesh_cleanup_disjoint_closed_boxes_are_preserved | passed | 2.613 | 1.014 | 3.626 |  |
| 83 | test_mesh_cleanup_preserves_face_ids_after_splitting | passed | 0.508 | 0.842 | 1.350 |  |
| 84 | test_mesh_cleanup_complete_operation_is_idempotent | passed | 17.939 | 1.184 | 19.122 |  |
| 85 | test_offsetFace_preserves_individual_edges | passed | 9.650 | 1.632 | 11.282 |  |
| 86 | test_face_thicken_planar_profile | passed | 20.677 | 1.254 | 21.931 |  |
| 87 | test_face_thicken_hole_profile | passed | 21.331 | 1.236 | 22.568 |  |
| 88 | test_face_thicken_curved_cylinder_side | passed | 85.595 | 2.957 | 88.552 |  |
| 89 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 323.683 | 6.862 | 330.544 |  |
| 90 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 2.831 | 0.961 | 3.792 |  |
| 91 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 3.956 | 1.053 | 5.009 |  |
| 92 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 4.715 | 0.924 | 5.639 |  |
| 93 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 6.324 | 1.057 | 7.381 |  |
| 94 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 5.303 | 1.195 | 6.498 |  |
| 95 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 68.563 | 2.884 | 71.447 |  |
| 96 | test_face_thicken_self_overlap_cylinder_side | passed | 41.861 | 2.133 | 43.993 |  |
| 97 | test_thicken_sphere_torus_union | passed | 729.878 | 31.480 | 761.358 |  |
| 98 | test_offsetShell_thickens_all_faces_except_selected | passed | 27.743 | 1.991 | 29.733 |  |
| 99 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 203.184 | 4.961 | 208.145 |  |
| 100 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 109.476 | 1.064 | 110.540 |  |
| 101 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.712 | 0.929 | 1.641 |  |
| 102 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.655 | 1.019 | 1.675 |  |
| 103 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.606 | 0.988 | 1.594 |  |
| 104 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.338 | 0.863 | 2.201 |  |
| 105 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 0.747 | 0.933 | 1.680 |  |
| 106 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 1933.352 | 28.142 | 1961.494 |  |
| 107 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 1865.708 | 25.384 | 1891.091 |  |
| 108 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 161.916 | 6.453 | 168.368 |  |
| 109 | test_offsetShell_preserves_source_centerlines | passed | 439.574 | 0.758 | 440.332 |  |
| 110 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.126 | 0.653 | 0.778 |  |
| 111 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 15.054 | 1.391 | 16.445 |  |
| 112 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 21.932 | 1.479 | 23.411 |  |
| 113 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 20.211 | 1.566 | 21.777 |  |
| 114 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.458 | 0.782 | 1.240 |  |
| 115 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.275 | 0.741 | 1.016 |  |
| 116 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.435 | 0.766 | 1.201 |  |
| 117 | test_visualize_does_not_repair_face_ids | passed | 0.364 | 0.758 | 1.122 |  |
| 118 | test_primitiveCone | passed | 5.908 | 2.524 | 8.432 |  |
| 119 | test_primitiveTorus | passed | 34.174 | 20.327 | 54.501 |  |
| 120 | test_primitiveSphere | passed | 8.017 | 3.155 | 11.172 |  |
| 121 | test_feature_dimension_overlay_supports_port | passed | 0.158 | 0.979 | 1.137 |  |
| 122 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.180 | 0.835 | 1.015 |  |
| 123 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.569 | 0.736 | 1.305 |  |
| 124 | test_feature_dimension_annotation_builder_dispatches_pattern | passed | 1.316 | 0.864 | 2.180 |  |
| 125 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.297 | 0.716 | 1.013 |  |
| 126 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.386 | 0.795 | 1.181 |  |
| 127 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.737 | 0.881 | 1.618 |  |
| 128 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.813 | 0.937 | 1.750 |  |
| 129 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.330 | 0.951 | 1.282 |  |
| 130 | test_transform_reference_sanitize_preserves_metadata | passed | 0.190 | 0.778 | 0.969 |  |
| 131 | test_transform_reference_base_uses_face_pick_point | passed | 0.511 | 0.809 | 1.321 |  |
| 132 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.279 | 2.579 | 2.859 |  |
| 133 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.989 | 2.062 | 3.052 |  |
| 134 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.546 | 2.429 | 2.974 |  |
| 135 | test_boolean_subtract | passed | 38.064 | 9.053 | 47.117 |  |
| 136 | test_boolean_face_metadata_preserved | passed | 120.617 | 1.380 | 121.997 |  |
| 137 | test_primitive_boolean_union_preserves_face_grouping | passed | 59.845 | 2.928 | 62.773 |  |
| 138 | test_boolean_operation_target_name_preserved | passed | 18.962 | 3.191 | 22.153 |  |
| 139 | test_stlLoader | passed | 67.669 | 16.567 | 84.235 |  |
| 140 | test_import3d_decimation_reduces_triangle_count | passed | 27.016 | 18.451 | 45.466 |  |
| 141 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 21.603 | 7.552 | 29.156 |  |
| 142 | test_import3d_decimation_99_is_near_full_detail | passed | 40.672 | 29.920 | 70.592 |  |
| 143 | test_import3d_decimation_100_restores_original_geometry | passed | 33.253 | 14.735 | 47.988 |  |
| 144 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 39.290 | 6.204 | 45.495 |  |
| 145 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 37.246 | 11.062 | 48.307 |  |
| 146 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 1.870 | 2.095 | 3.965 |  |
| 147 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.404 | 0.823 | 1.228 |  |
| 148 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.322 | 0.907 | 1.229 |  |
| 149 | test_import3d_fixture_merges_faces_4_and_34 | passed | 857.875 | 380.578 | 1238.453 |  |
| 150 | test_import3d_extract_multiple_solids_toggle | passed | 23.646 | 5.844 | 29.490 |  |
| 151 | test_SweepFace | passed | 48.885 | 5.042 | 53.927 |  |
| 152 | test_SweepFace_pathAlign_multi_loop_islands | passed | 28.622 | 3.255 | 31.877 |  |
| 153 | test_tube | passed | 124.650 | 25.927 | 150.577 |  |
| 154 | test_tube_closedLoop | passed | 62.147 | 12.514 | 74.661 |  |
| 155 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.345 | 0.855 | 1.200 |  |
| 156 | test_wire_harness_connection_endpoint_resolution | passed | 0.998 | 0.800 | 1.798 |  |
| 157 | test_sheet_custom_size_persists | passed | 0.828 | 0.825 | 1.653 |  |
| 158 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.438 | 0.830 | 1.268 |  |
| 159 | test_pmi_view_text_size_setting_normalizes | passed | 0.323 | 0.767 | 1.090 |  |
| 160 | test_pmi_view_visibility_state_normalizes | passed | 0.152 | 0.833 | 0.985 |  |
| 161 | test_pmi_view_visibility_state_round_trip | passed | 5.020 | 1.124 | 6.144 |  |
| 162 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 1.264 | 0.815 | 2.079 |  |
| 163 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.306 | 0.767 | 1.073 |  |
| 164 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.384 | 0.728 | 1.112 |  |
| 165 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 0.817 | 0.759 | 1.575 |  |
| 166 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.361 | 0.816 | 1.177 |  |
| 167 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.268 | 0.767 | 1.035 |  |
| 168 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.463 | 0.810 | 1.273 |  |
| 169 | test_pmi_annotation_failure_status_is_visible | passed | 0.430 | 0.789 | 1.219 |  |
| 170 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 1.551 | 0.798 | 2.349 |  |
| 171 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.414 | 0.799 | 1.213 |  |
| 172 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.318 | 0.753 | 1.071 |  |
| 173 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 1.053 | 0.841 | 1.894 |  |
| 174 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.159 | 0.952 | 1.111 |  |
| 175 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.209 | 0.725 | 0.934 |  |
| 176 | test_pmi_export_render_context_applies_visibility_state | passed | 1.139 | 1.076 | 2.215 |  |
| 177 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.124 | 0.716 | 0.840 |  |
| 178 | test_sheet_clipboard_image_utils | passed | 0.634 | 0.789 | 1.423 |  |
| 179 | test_wire_harness_formboard_insert | passed | 5.875 | 0.849 | 6.724 |  |
| 180 | test_wire_harness_sheet_table_insert | passed | 1.877 | 0.818 | 2.695 |  |
| 181 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.852 | 0.835 | 2.687 |  |
| 182 | test_wire_harness_routes_render_as_scene_solids | passed | 6.083 | 0.934 | 7.017 |  |
| 183 | test_wire_harness_route_results_persist_in_model_json | passed | 1.206 | 0.894 | 2.100 |  |
| 184 | test_sketch_openLoop | passed | 3.291 | 1.004 | 4.295 |  |
| 185 | test_sketch_snapshot_restore_selection_handlers | passed | 7.511 | 1.127 | 8.638 |  |
| 186 | test_sketch_face_attachment_alignment | passed | 474.692 | 16.185 | 490.877 |  |
| 187 | test_sketch_solver_topology_rect_shared_points | passed | 11.031 | 1.497 | 12.528 |  |
| 188 | test_sketch_solver_topology_coincident_chain | passed | 15.511 | 1.198 | 16.709 |  |
| 189 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 14.343 | 1.302 | 15.645 |  |
| 190 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 19.506 | 3.266 | 22.772 |  |
| 191 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 37.099 | 2.364 | 39.463 |  |
| 192 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.761 | 0.972 | 2.732 |  |
| 193 | test_sketch_solver_line_to_point_distance_constraint | passed | 4.806 | 1.215 | 6.021 |  |
| 194 | test_extrude_negative_distance_cap_alignment | passed | 9.550 | 1.909 | 11.459 |  |
| 195 | test_extrude_intersect_coplanar_face_merge | passed | 1748.633 | 18.207 | 1766.840 |  |
| 196 | test_ExtrudeFace | passed | 37.404 | 3.308 | 40.712 |  |
| 197 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 10.243 | 1.415 | 11.658 |  |
| 198 | test_Fillet | passed | 468.170 | 29.345 | 497.515 |  |
| 199 | test_fillet_angle | passed | 12.755 | 2.800 | 15.555 |  |
| 200 | test_fillet_corner_bridge | passed | 34.188 | 3.178 | 37.366 |  |
| 201 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 39.698 | 1.632 | 41.330 |  |
| 202 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 30.348 | 5.302 | 35.650 |  |
| 203 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 30.163 | 1.451 | 31.614 |  |
| 204 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 89.716 | 10.396 | 100.112 |  |
| 205 | test_fillet_edge_degenerate_segment | passed | 1344.771 | 31.457 | 1376.229 |  |
| 206 | test_sketch_profile_tolerant_loop_join | passed | 1525.494 | 10.114 | 1535.609 |  |
| 207 | test_fillet_compound_snapshot_resolution | passed | 1764.722 | 20.402 | 1785.123 |  |
| 208 | test_fillet_generated_history_20260321144106 | passed | 3446.647 | 140.810 | 3587.458 |  |
| 209 | test_generated_history_20260709065543 | passed | 366.416 | 105.943 | 472.360 |  |
| 210 | test_generated_history_20260322220620 | passed | 6993.701 | 154.910 | 7148.610 |  |
| 211 | test_generated_history_20260322222832 | passed | 65.915 | 5.111 | 71.025 |  |
| 212 | test_generated_history_20260418030116 | passed | 865.113 | 34.772 | 899.885 |  |
| 213 | test_generated_history_20260427005357 | passed | 2147.639 | 47.081 | 2194.720 |  |
| 214 | test_generated_history_20260427005357_three_face_thicken | passed | 659.604 | 21.106 | 680.711 |  |
| 215 | test_generated_history_20260427005357_nine_face_thicken | passed | 1813.432 | 39.271 | 1852.703 |  |
| 216 | test_generated_history_20260523000414 | passed | 1566.151 | 60.750 | 1626.901 |  |
| 217 | test_generated_history_20260531201126 | passed | 191.937 | 19.035 | 210.973 |  |
| 218 | test_generated_history_20260606004152 | passed | 9582.377 | 224.882 | 9807.259 |  |
| 219 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 4334.971 | 1.650 | 4336.621 |  |
| 220 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 4288.349 | 0.953 | 4289.302 |  |
| 221 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 4336.010 | 1.524 | 4337.533 |  |
| 222 | test_generated_history_20260709035143_offset_shell_prefers_source_face_names | passed | 3466.510 | 40.134 | 3506.644 |  |
| 223 | test_generated_history_20260612230031 | passed | 62.632 | 3.242 | 65.874 |  |
| 224 | test_generated_history_20260612232755 | passed | 437.608 | 16.264 | 453.872 |  |
| 225 | test_generated_history_20260613000139 | passed | 64.852 | 4.359 | 69.211 |  |
| 226 | test_generated_history_20260613003952 | passed | 6748.948 | 172.657 | 6921.605 |  |
| 227 | test_fillet_preserves_original_face_names | passed | 468.504 | 17.635 | 486.139 |  |
| 228 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 461.757 | 18.308 | 480.065 |  |
| 229 | test_Fillet_NonClosed | passed | 15.940 | 2.798 | 18.738 |  |
| 230 | test_fillets_more_dificult | passed | 1411.681 | 99.021 | 1510.702 |  |
| 231 | test_Chamfer | passed | 12.158 | 1.705 | 13.864 |  |
| 232 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 4.172 | 0.853 | 5.025 |  |
| 233 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 3.564 | 0.857 | 4.422 |  |
| 234 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 189.639 | 12.097 | 201.735 |  |
| 235 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 270.530 | 10.212 | 280.742 |  |
| 236 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 184.608 | 11.971 | 196.578 |  |
| 237 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 182.478 | 12.890 | 195.368 |  |
| 238 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 201.745 | 12.635 | 214.380 |  |
| 239 | test_edge_smooth_curve_fit | passed | 0.691 | 1.158 | 1.849 |  |
| 240 | test_edge_smooth_curve_fit_closed_loop | passed | 0.535 | 0.769 | 1.304 |  |
| 241 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.712 | 0.741 | 1.453 |  |
| 242 | test_edge_smooth_closed_loop_feature_selection | passed | 1.833 | 0.752 | 2.585 |  |
| 243 | test_edge_smooth_whole_solid_selection | passed | 0.452 | 0.778 | 1.230 |  |
| 244 | test_edge_smooth_face_selection | passed | 0.405 | 0.709 | 1.114 |  |
| 245 | test_smooth_with_subdivision_replaces_source_solid | passed | 35.285 | 2.000 | 37.285 |  |
| 246 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 34.512 | 3.477 | 37.988 |  |
| 247 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 67.631 | 2.184 | 69.815 |  |
| 248 | test_hole_through | passed | 37.039 | 4.371 | 41.411 |  |
| 249 | test_hole_countersink | passed | 56.570 | 5.107 | 61.677 |  |
| 250 | test_hole_counterbore | passed | 84.080 | 7.151 | 91.232 |  |
| 251 | test_hole_multi_point_cloned_cutter | passed | 151.000 | 10.612 | 161.613 |  |
| 252 | test_hole_thread_symbolic | passed | 93.174 | 5.116 | 98.290 |  |
| 253 | test_hole_thread_modeled | passed | 401.528 | 35.365 | 436.893 |  |
| 254 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 12.627 | 1.179 | 13.806 |  |
| 255 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 34.333 | 1.528 | 35.861 |  |
| 256 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.284 | 1.001 | 1.285 |  |
| 257 | test_run_history_calls_are_serialized | passed | 46.654 | 0.878 | 47.532 |  |
| 258 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 23.928 | 1.638 | 25.565 |  |
| 259 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 45.658 | 1.787 | 47.445 |  |
| 260 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 4187.071 | 40.384 | 4227.455 |  |
| 261 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 4770.539 | 0.000 | 4770.539 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32) |
| 262 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 5865.279 | 0.000 | 5865.279 | Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32) |
| 263 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 5846.635 | 0.000 | 5846.635 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer     at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)     at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)     at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32) |
| 264 | test_pushFace_feature | passed | 5.958 | 8.858 | 14.816 |  |
| 265 | test_pushFace | passed | 74.808 | 4.963 | 79.771 |  |
| 266 | test_mirror | passed | 7.626 | 1.964 | 9.589 |  |
| 267 | test_pattern_circular_count_pitch_uses_angle_as_step | passed | 0.931 | 0.722 | 1.653 |  |
| 268 | test_history_features_basic | passed | 96.027 | 15.595 | 111.622 |  |
| 269 | test_history_expand_does_not_dirty | passed | 19.888 | 1.225 | 21.114 |  |
| 270 | test_history_test_snippet_persistent_data_allowlist | passed | 0.929 | 0.914 | 1.843 |  |
| 271 | test_history_test_snippet_includes_cam_operations | passed | 0.620 | 0.877 | 1.497 |  |
| 272 | test_history_test_snippet_toolbar_snapshot_compacts_cam_generated_data | passed | 0.499 | 0.768 | 1.268 |  |
| 273 | test_history_test_snippet_omits_empty_cam_state | passed | 0.149 | 0.752 | 0.901 |  |
| 274 | test_history_test_snippet_includes_global_cam_state_without_operations | passed | 0.180 | 0.819 | 0.999 |  |
| 275 | test_selection_owning_feature_resolution | passed | 0.519 | 0.773 | 1.292 |  |
| 276 | test_selection_line2_resolution_repair | passed | 3.207 | 0.900 | 4.106 |  |
| 277 | test_selection_hover_material_restores_before_dispose | passed | 0.479 | 0.835 | 1.313 |  |
| 278 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.358 | 0.845 | 1.203 |  |
| 279 | test_selection_sketch_hover_tints_material_in_place | passed | 0.492 | 0.902 | 1.394 |  |
| 280 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.644 | 0.780 | 1.425 |  |
| 281 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.794 | 0.871 | 1.665 |  |
| 282 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.300 | 0.799 | 1.099 |  |
| 283 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.546 | 0.823 | 1.368 |  |
| 284 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 12.138 | 0.972 | 13.110 |  |
| 285 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 8.567 | 0.858 | 9.425 |  |
| 286 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 10.262 | 0.983 | 11.246 |  |
| 287 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 9.590 | 0.993 | 10.582 |  |
| 288 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 10.679 | 1.545 | 12.224 |  |
| 289 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 22.746 | 7.256 | 30.002 |  |
| 290 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.557 | 0.953 | 3.509 |  |
| 291 | test_cam_plan_manager_preserves_operations_and_profiles | passed | 1.299 | 1.121 | 2.420 |  |
| 292 | test_cam_plan_manager_async_generation_reports_progress_steps | passed | 58.609 | 0.921 | 59.530 |  |
| 293 | test_cam_plan_manager_strips_legacy_generated_data | passed | 0.537 | 0.902 | 1.439 |  |
| 294 | test_cam_shadow_cutter_generated_history_20260704000935_keeps_outer_loop | passed | 235.766 | 1.278 | 237.045 |  |
| 295 | test_cam_shadow_cutter_cuts_each_loop_to_depth_before_next_loop | passed | 4.215 | 1.038 | 5.252 |  |
| 296 | test_cam_shadow_cutter_generates_clear_hole_loop | passed | 3.152 | 0.839 | 3.991 |  |
| 297 | test_cam_shadow_cutter_generates_outer_and_hole_for_nonconvex_profile | passed | 4.602 | 1.077 | 5.679 |  |
| 298 | test_cam_shadow_cutter_history_item_generates_toolpath | passed | 1.296 | 1.254 | 2.551 |  |
| 299 | test_cam_shadow_cutter_ignores_raised_cap_loops_as_holes | passed | 3.418 | 1.002 | 4.420 |  |
| 300 | test_cam_shadow_cutter_offset_keeps_l_shape_inside_corner_clear | passed | 0.883 | 1.207 | 2.091 |  |
| 301 | test_cam_shadow_cutter_offset_stays_outside_concave_shadow | passed | 1.406 | 1.036 | 2.442 |  |
| 302 | test_cam_roughing_history_item_generates_sliced_toolpaths | passed | 5.370 | 1.160 | 6.530 |  |
| 303 | test_cam_roughing_debug_slices_emit_layer_solids | passed | 2.597 | 0.949 | 3.546 |  |
| 304 | test_cam_roughing_debug_slices_create_real_scene_solids | passed | 19.400 | 0.948 | 20.347 |  |
| 305 | test_cam_roughing_debug_slices_survive_combined_cam_plan | passed | 9.344 | 1.067 | 10.411 |  |
| 306 | test_cam_roughing_sloped_slab_generates_each_step | passed | 3.276 | 0.983 | 4.259 |  |
| 307 | test_cam_roughing_unions_curved_slice_shadow_before_pathing | passed | 28.738 | 1.082 | 29.819 |  |
| 308 | test_cam_roughing_uses_each_slice_shadow | passed | 2.049 | 0.818 | 2.866 |  |
| 309 | test_cam_roughing_vertical_wall_slice_matches_shadow_cutter_loop | passed | 7.307 | 1.156 | 8.463 |  |
| 310 | test_cam_surfacing_adaptive_sampling_inserts_points_on_curved_face | passed | 15.273 | 1.508 | 16.781 |  |
| 311 | test_cam_surfacing_applies_parent_transform_to_direct_face_geometry | passed | 6.897 | 2.628 | 9.525 |  |
| 312 | test_cam_surfacing_both_raster_directions_emit_x_and_y_paths | passed | 40.506 | 1.150 | 41.657 |  |
| 313 | test_cam_surfacing_clearance_link_samples_narrow_preserved_geometry | passed | 6.820 | 2.366 | 9.186 |  |
| 314 | test_cam_surfacing_combined_gcode_posts_single_runnable_program | passed | 9.194 | 1.106 | 10.301 |  |
| 315 | test_cam_surfacing_combined_gcode_reissues_feed_after_roughing | passed | 8.685 | 1.144 | 9.829 |  |
| 316 | test_cam_surfacing_detects_narrow_preserved_island_between_coarse_samples | passed | 20.196 | 1.100 | 21.296 |  |
| 317 | test_cam_surfacing_does_not_cut_across_selected_face_hole | passed | 52.668 | 2.104 | 54.772 |  |
| 318 | test_cam_surfacing_does_not_duplicate_direct_face_with_owner_metadata | passed | 9.072 | 1.008 | 10.079 |  |
| 319 | test_cam_surfacing_flat_path_tolerance_zero_respects_sample_spacing | passed | 5.988 | 0.959 | 6.947 |  |
| 320 | test_cam_surfacing_history_item_generates_ball_endmill_raster | passed | 20.618 | 0.980 | 21.598 |  |
| 321 | test_cam_surfacing_follows_sloped_face_with_drop_cutter | passed | 9.381 | 1.150 | 10.531 |  |
| 322 | test_cam_surfacing_reaches_edge_beside_coplanar_preserved_face | passed | 13.937 | 1.128 | 15.065 |  |
| 323 | test_cam_surfacing_reports_warning_when_raster_too_dense | passed | 3.854 | 0.994 | 4.848 |  |
| 324 | test_cam_surfacing_resolves_solid_owned_face_reference | passed | 10.320 | 1.134 | 11.454 |  |
| 325 | test_cam_surfacing_uses_explicit_solid_owner_for_shared_face_name | passed | 9.550 | 1.160 | 10.711 |  |
| 326 | test_cam_surfacing_splits_runs_around_preserved_island | passed | 15.262 | 1.158 | 16.421 |  |
| 327 | test_cam_surfacing_stops_before_higher_adjacent_preserved_face | passed | 4.304 | 0.868 | 5.172 |  |
| 328 | test_cam_surfacing_stock_allowance_leaves_material_on_selected_face | passed | 9.823 | 2.936 | 12.758 |  |
| 329 | test_cam_surfacing_ui_reference_metadata_preserves_shared_face_owner | passed | 32.988 | 1.085 | 34.073 |  |
| 330 | test_cam_surfacing_uses_low_clearance_links_between_separate_face_spans | passed | 9.042 | 0.997 | 10.039 |  |
| 331 | test_cam_surfacing_falls_back_to_full_retract_when_low_hop_reaches_safe_height | passed | 6.172 | 3.078 | 9.250 |  |
| 332 | test_cam_surfacing_uses_userdata_solid_owner_for_shared_face_name | passed | 9.452 | 1.063 | 10.515 |  |
| 333 | test_cam_surfacing_y_raster_reaches_selected_face_edges | passed | 13.284 | 1.216 | 14.501 |  |
| 334 | test_cam_surfacing_zero_sample_spacing_uses_automatic_spacing | passed | 11.484 | 0.978 | 12.462 |  |
| 335 | test_cam_surfacing_rejects_vertical_face_without_projected_area | passed | 0.690 | 0.889 | 1.578 |  |
| 336 | test_cam_shadow_cutter_single_solid_does_not_require_target_selection | passed | 0.651 | 0.882 | 1.533 |  |
| 337 | test_cam_toolpath_simulator_displays_ball_endmill_round_tip | passed | 7.986 | 0.928 | 8.914 |  |
| 338 | test_cam_toolpath_simulator_visualizes_program_and_moves_head | passed | 1.107 | 0.840 | 1.947 |  |
| 339 | test_cam_shadow_cutter_uses_projected_outline_not_convex_hull | passed | 0.604 | 0.856 | 1.461 |  |
| 340 | test_cam_workbench_exit_clears_scene_artifacts | passed | 62.896 | 0.994 | 63.890 |  |
| 341 | test_cam_workbench_registers_shadow_cutter_and_roughing_operations | passed | 0.230 | 1.000 | 1.230 |  |
| 342 | test_cam_workbench_registers_and_persists_part_history_state | passed | 0.438 | 0.791 | 1.229 |  |
| 343 | test_visibility_hidden_state_persistence | passed | 11.712 | 1.457 | 13.169 |  |
| 344 | test_sketch_feature_scene_visibility | passed | 0.222 | 0.760 | 0.982 |  |
| 345 | test_textToFace | passed | 48.927 | 13.138 | 62.065 |  |
| 346 | test_sheetMetal_nonManifold_sm_f18 | passed | 149.406 | 1.094 | 150.500 |  |
| 347 | test_sheetMetal_tab_circular_hole_wall | passed | 17.026 | 1.054 | 18.080 |  |
| 348 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 11.618 | 1.183 | 12.801 |  |
| 349 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 5.247 | 0.883 | 6.129 |  |
| 350 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 111.404 | 2.077 | 113.481 |  |
| 351 | test_sheetMetal_tab_and_flange_context_buttons | passed | 0.442 | 0.863 | 1.304 |  |
| 352 | test_sheetMetal_cutout_preserves_multiple_profile_loops | passed | 134.783 | 8.262 | 143.045 |  |
| 353 | test_sheetMetal_cutout_context_button | passed | 0.279 | 0.975 | 1.254 |  |
| 354 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.251 | 0.956 | 1.206 |  |
| 355 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 39.240 | 8.058 | 47.298 |  |
| 356 | test_sheetMetal_cutoutEdge_flange_controls | passed | 5.438 | 0.869 | 6.307 |  |
| 357 | test_sheetMetal_corner_fillet | passed | 165.794 | 0.840 | 166.634 |  |
| 358 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 181.372 | 1.181 | 182.553 |  |
| 359 | test_sheetMetal_corner_fillet_selection_resolution | passed | 382.230 | 0.993 | 383.223 |  |
| 360 | test_sheetMetal_corner_fillet_compound_reference | passed | 306.781 | 0.954 | 307.735 |  |
| 361 | test_solidPointMinGap | passed | 0.939 | 0.888 | 1.826 |  |
| 362 | test_solidMetrics | passed | 4.689 | 1.572 | 6.261 |  |
| 363 | import_part_badBoolean | passed | 73.151 | 6.439 | 79.589 |  |
| 364 | import_part_extrudeTest | passed | 25.073 | 2.299 | 27.372 |  |
| 365 | import_part_filletFail | passed | 19.010 | 2.629 | 21.638 |  |
| 366 | import_part_fillet_angle_test.BREP | passed | 37.288 | 7.365 | 44.653 |  |
| 367 | import_part_fillet_test.BREP | passed | 1608.193 | 60.807 | 1669.000 |  |
| 368 | import_part_import_TEst.part.part | passed | 25.937 | 6.408 | 32.345 |  |
| 369 | import_part_medium_fillets.BREP | passed | 484.634 | 29.172 | 513.805 |  |
| 370 | import_part_sketch_throttel_testing.BREP | passed | 15.403 | 3.746 | 19.149 |  |
| 371 | import_part_slowsketch | passed | 1847.897 | 34.968 | 1882.865 |  |
| 372 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 17.162 | 0.824 | 17.986 |  |
| 373 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 9.407 | 4.779 | 14.185 |  |
| 374 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 1006.440 | 1.602 | 1008.042 |  |

Failure details:

1. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at assertSingleBoundaryBetweenFaces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:703:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32)
```

2. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:795:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32)
```

3. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G5_SW, E2:S1:G4_SW, E2:S1:G3_SW_END, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G4_SW_END, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, O.S17_ROUND_PIPE_1_Outer
    at assert (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (/home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.ts:860:3)
    at async runSingleTest (/home/user/projects/BREP/src/tests/tests.ts:1964:9)
    at async runTests (/home/user/projects/BREP/src/tests/tests.ts:1843:32)
```
