# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 293
tests_run: 293
passed: 288
handled_errors: 0
failed: 5
total_elapsed_ms: 155130.769

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 6.983 | 9.708 | 16.691 |  |
| 2 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.742 | 2.203 | 3.946 |  |
| 3 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.168 | 1.588 | 2.755 |  |
| 4 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 0.983 | 5.344 | 6.327 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 1.402 | 1.509 | 2.911 |  |
| 6 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.747 | 5.207 | 5.954 |  |
| 7 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.868 | 1.795 | 2.663 |  |
| 8 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 6.128 | 1.291 | 7.419 |  |
| 9 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 0.956 | 1.422 | 2.378 |  |
| 10 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.198 | 1.385 | 2.582 |  |
| 11 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 4.566 | 2.099 | 6.665 |  |
| 12 | test_cppSolidMirror_preserves_face_metadata | passed | 5.863 | 1.622 | 7.485 |  |
| 13 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 2.154 | 1.290 | 3.444 |  |
| 14 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 76.511 | 1.390 | 77.901 |  |
| 15 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 15.948 | 1.575 | 17.523 |  |
| 16 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 8.682 | 1.758 | 10.440 |  |
| 17 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 93.329 | 6.588 | 99.917 |  |
| 18 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.494 | 1.469 | 1.963 |  |
| 19 | test_remesh_simplify_imported_fixture_stl | passed | 1966.239 | 366.601 | 2332.840 |  |
| 20 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 6.803 | 2.545 | 9.347 |  |
| 21 | test_revolve_after_union_preserves_face_reference_resolution | passed | 125.631 | 5.633 | 131.264 |  |
| 22 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 1.033 | 1.088 | 2.121 |  |
| 23 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.571 | 0.733 | 1.305 |  |
| 24 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.352 | 1.029 | 1.381 |  |
| 25 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 0.836 | 0.669 | 1.505 |  |
| 26 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 1.342 | 0.799 | 2.141 |  |
| 27 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 0.800 | 0.839 | 1.639 |  |
| 28 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.432 | 0.708 | 1.140 |  |
| 29 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.233 | 0.706 | 0.940 |  |
| 30 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.437 | 0.927 | 1.364 |  |
| 31 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.505 | 0.746 | 1.251 |  |
| 32 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.178 | 0.635 | 1.813 |  |
| 33 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 1.762 | 0.684 | 2.446 |  |
| 34 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 16.750 | 0.836 | 17.586 |  |
| 35 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 13.763 | 0.864 | 14.627 |  |
| 36 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 17.209 | 0.996 | 18.205 |  |
| 37 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 14.521 | 0.756 | 15.276 |  |
| 38 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 14.204 | 0.699 | 14.904 |  |
| 39 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 15.704 | 0.794 | 16.498 |  |
| 40 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 10.060 | 0.890 | 10.951 |  |
| 41 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 12.819 | 0.977 | 13.796 |  |
| 42 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 8.254 | 0.824 | 9.078 |  |
| 43 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.729 | 0.972 | 1.700 |  |
| 44 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.095 | 2.321 | 3.416 |  |
| 45 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.463 | 0.820 | 2.282 |  |
| 46 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 1.275 | 1.086 | 2.361 |  |
| 47 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.984 | 0.764 | 1.748 |  |
| 48 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 11.580 | 0.991 | 12.571 |  |
| 49 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 36.992 | 0.886 | 37.878 |  |
| 50 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 16.000 | 0.762 | 16.762 |  |
| 51 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 23.312 | 0.861 | 24.173 |  |
| 52 | test_cppTube_native_builder_reports_selected_build_mode | passed | 8.019 | 0.817 | 8.836 |  |
| 53 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 18.395 | 0.817 | 19.213 |  |
| 54 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 5.560 | 0.706 | 6.266 |  |
| 55 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.365 | 0.684 | 1.049 |  |
| 56 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 1.235 | 0.732 | 1.967 |  |
| 57 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.307 | 0.671 | 1.978 |  |
| 58 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 9.465 | 0.712 | 10.176 |  |
| 59 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 2.917 | 0.768 | 3.685 |  |
| 60 | test_configurator_expressions | passed | 1.750 | 0.741 | 2.491 |  |
| 61 | test_manifoldPlus_sum | passed | 0.141 | 0.655 | 0.796 |  |
| 62 | test_plane | passed | 1.377 | 0.726 | 2.103 |  |
| 63 | test_primitiveCube | passed | 3.104 | 2.433 | 5.537 |  |
| 64 | test_primitivePyramid | passed | 2.278 | 1.694 | 3.972 |  |
| 65 | test_primitiveCylinder | passed | 7.227 | 5.196 | 12.422 |  |
| 66 | test_face_source_feature_seed | passed | 9.764 | 2.336 | 12.100 |  |
| 67 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 4.969 | 0.860 | 5.830 |  |
| 68 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.893 | 0.795 | 1.687 |  |
| 69 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | failed | 11.490 | 0.000 | 11.490 | Error: [mesh-cleanup overlap] Expected no boundary edges, received 11.     at assert (file:///home/user/projects/BREP/src/tests/test_meshCleanupSelfIntersection.js:4:25)     at Object.test_mesh_cleanup_split_then_winding_removes_internal_overlap [as test] (file:///home/user/projects/BREP/src/tests/test_meshCleanupSelfIntersection.js:102:3)     at runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:28)     at runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:34) |
| 70 | test_offsetFace_preserves_individual_edges | passed | 8.449 | 1.586 | 10.035 |  |
| 71 | test_face_thicken_planar_profile | passed | 16.365 | 3.355 | 19.720 |  |
| 72 | test_face_thicken_hole_profile | passed | 16.741 | 1.092 | 17.833 |  |
| 73 | test_face_thicken_curved_cylinder_side | passed | 122.481 | 4.377 | 126.857 |  |
| 74 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 995.636 | 9.944 | 1005.580 |  |
| 75 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 2.893 | 0.783 | 3.676 |  |
| 76 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 3.417 | 0.690 | 4.107 |  |
| 77 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 3.514 | 0.698 | 4.212 |  |
| 78 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 3.719 | 0.587 | 4.306 |  |
| 79 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 5.150 | 0.608 | 5.758 |  |
| 80 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 66.800 | 3.768 | 70.568 |  |
| 81 | test_face_thicken_self_overlap_cylinder_side | passed | 42.039 | 3.071 | 45.110 |  |
| 82 | test_thicken_sphere_torus_union | passed | 2179.120 | 53.088 | 2232.208 |  |
| 83 | test_offsetShell_thickens_all_faces_except_selected | passed | 25.384 | 2.635 | 28.019 |  |
| 84 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 212.953 | 7.062 | 220.016 |  |
| 85 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 98.461 | 0.890 | 99.351 |  |
| 86 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.580 | 0.774 | 1.355 |  |
| 87 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.295 | 0.643 | 0.938 |  |
| 88 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.465 | 0.678 | 1.142 |  |
| 89 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.150 | 0.749 | 1.899 |  |
| 90 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 0.609 | 0.679 | 1.288 |  |
| 91 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 2354.929 | 48.103 | 2403.033 |  |
| 92 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 2308.325 | 30.659 | 2338.984 |  |
| 93 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 150.016 | 9.403 | 159.419 |  |
| 94 | test_offsetShell_preserves_source_centerlines | passed | 559.877 | 0.717 | 560.594 |  |
| 95 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.181 | 0.576 | 0.758 |  |
| 96 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 13.021 | 1.383 | 14.404 |  |
| 97 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 17.553 | 1.524 | 19.077 |  |
| 98 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 17.043 | 1.972 | 19.015 |  |
| 99 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.405 | 0.620 | 1.025 |  |
| 100 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.205 | 0.648 | 0.853 |  |
| 101 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.409 | 0.678 | 1.087 |  |
| 102 | test_visualize_does_not_repair_face_ids | passed | 0.282 | 0.693 | 0.975 |  |
| 103 | test_primitiveCone | passed | 5.170 | 2.802 | 7.972 |  |
| 104 | test_primitiveTorus | passed | 43.516 | 23.754 | 67.270 |  |
| 105 | test_primitiveSphere | passed | 4.593 | 3.536 | 8.129 |  |
| 106 | test_feature_dimension_overlay_supports_port | passed | 0.154 | 0.926 | 1.080 |  |
| 107 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.175 | 0.664 | 0.839 |  |
| 108 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.421 | 0.642 | 1.063 |  |
| 109 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.289 | 0.611 | 0.900 |  |
| 110 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.423 | 0.659 | 1.082 |  |
| 111 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.415 | 0.649 | 1.064 |  |
| 112 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.627 | 0.640 | 1.267 |  |
| 113 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.274 | 0.603 | 0.876 |  |
| 114 | test_transform_reference_sanitize_preserves_metadata | passed | 0.151 | 0.681 | 0.832 |  |
| 115 | test_transform_reference_base_uses_face_pick_point | passed | 0.453 | 0.658 | 1.111 |  |
| 116 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.248 | 2.522 | 2.771 |  |
| 117 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.862 | 1.699 | 2.561 |  |
| 118 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.372 | 2.148 | 2.520 |  |
| 119 | test_boolean_subtract | passed | 38.804 | 9.603 | 48.407 |  |
| 120 | test_boolean_face_metadata_preserved | passed | 120.238 | 0.842 | 121.080 |  |
| 121 | test_primitive_boolean_union_preserves_face_grouping | passed | 61.629 | 4.169 | 65.799 |  |
| 122 | test_boolean_operation_target_name_preserved | passed | 14.655 | 3.595 | 18.249 |  |
| 123 | test_stlLoader | passed | 78.472 | 13.412 | 91.884 |  |
| 124 | test_import3d_decimation_reduces_triangle_count | passed | 37.735 | 19.228 | 56.964 |  |
| 125 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 24.450 | 5.826 | 30.276 |  |
| 126 | test_import3d_decimation_99_is_near_full_detail | passed | 48.821 | 32.617 | 81.439 |  |
| 127 | test_import3d_decimation_100_restores_original_geometry | passed | 38.610 | 20.845 | 59.455 |  |
| 128 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 53.681 | 6.219 | 59.900 |  |
| 129 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 38.482 | 16.553 | 55.035 |  |
| 130 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.187 | 1.840 | 4.027 |  |
| 131 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.720 | 0.743 | 1.463 |  |
| 132 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.531 | 0.713 | 1.244 |  |
| 133 | test_import3d_fixture_merges_faces_4_and_34 | passed | 1419.697 | 495.249 | 1914.947 |  |
| 134 | test_import3d_extract_multiple_solids_toggle | passed | 17.674 | 2.575 | 20.249 |  |
| 135 | test_SweepFace | passed | 44.890 | 4.680 | 49.570 |  |
| 136 | test_SweepFace_pathAlign_multi_loop_islands | passed | 23.610 | 3.429 | 27.039 |  |
| 137 | test_tube | passed | 145.510 | 34.166 | 179.676 |  |
| 138 | test_tube_closedLoop | passed | 67.199 | 23.681 | 90.879 |  |
| 139 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.314 | 1.130 | 1.445 |  |
| 140 | test_wire_harness_connection_endpoint_resolution | passed | 1.153 | 0.714 | 1.867 |  |
| 141 | test_sheet_custom_size_persists | passed | 0.857 | 0.805 | 1.662 |  |
| 142 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.637 | 1.125 | 1.762 |  |
| 143 | test_pmi_view_text_size_setting_normalizes | passed | 0.323 | 0.860 | 1.183 |  |
| 144 | test_pmi_view_visibility_state_normalizes | passed | 0.209 | 0.926 | 1.135 |  |
| 145 | test_pmi_view_visibility_state_round_trip | passed | 4.236 | 1.753 | 5.989 |  |
| 146 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 1.507 | 0.788 | 2.295 |  |
| 147 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.360 | 0.774 | 1.134 |  |
| 148 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.441 | 0.903 | 1.345 |  |
| 149 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 1.020 | 0.739 | 1.759 |  |
| 150 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.325 | 0.757 | 1.082 |  |
| 151 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.280 | 0.717 | 0.998 |  |
| 152 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.547 | 0.761 | 1.308 |  |
| 153 | test_pmi_annotation_failure_status_is_visible | passed | 0.420 | 0.770 | 1.190 |  |
| 154 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 1.698 | 0.893 | 2.590 |  |
| 155 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.487 | 1.302 | 1.789 |  |
| 156 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.449 | 1.048 | 1.498 |  |
| 157 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 1.412 | 1.023 | 2.434 |  |
| 158 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.145 | 0.824 | 0.968 |  |
| 159 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.252 | 0.801 | 1.054 |  |
| 160 | test_pmi_export_render_context_applies_visibility_state | passed | 1.107 | 0.816 | 1.923 |  |
| 161 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.095 | 0.672 | 0.766 |  |
| 162 | test_sheet_clipboard_image_utils | passed | 0.722 | 0.865 | 1.587 |  |
| 163 | test_wire_harness_formboard_insert | passed | 6.634 | 1.185 | 7.819 |  |
| 164 | test_wire_harness_sheet_table_insert | passed | 1.997 | 0.913 | 2.911 |  |
| 165 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 2.409 | 0.913 | 3.323 |  |
| 166 | test_wire_harness_routes_render_as_scene_solids | passed | 7.371 | 1.115 | 8.487 |  |
| 167 | test_wire_harness_route_results_persist_in_model_json | passed | 1.408 | 0.779 | 2.187 |  |
| 168 | test_sketch_openLoop | passed | 2.647 | 0.973 | 3.621 |  |
| 169 | test_sketch_snapshot_restore_selection_handlers | passed | 7.586 | 1.199 | 8.785 |  |
| 170 | test_sketch_face_attachment_alignment | passed | 736.265 | 18.771 | 755.036 |  |
| 171 | test_sketch_solver_topology_rect_shared_points | passed | 8.224 | 0.908 | 9.132 |  |
| 172 | test_sketch_solver_topology_coincident_chain | passed | 11.621 | 0.863 | 12.485 |  |
| 173 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 13.533 | 2.604 | 16.138 |  |
| 174 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 16.012 | 0.834 | 16.846 |  |
| 175 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 35.406 | 1.157 | 36.564 |  |
| 176 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 2.331 | 1.407 | 3.739 |  |
| 177 | test_sketch_solver_line_to_point_distance_constraint | passed | 3.968 | 0.726 | 4.694 |  |
| 178 | test_extrude_negative_distance_cap_alignment | passed | 7.435 | 2.182 | 9.616 |  |
| 179 | test_extrude_intersect_coplanar_face_merge | passed | 1789.658 | 19.070 | 1808.728 |  |
| 180 | test_ExtrudeFace | passed | 32.593 | 4.560 | 37.153 |  |
| 181 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 6.952 | 1.598 | 8.550 |  |
| 182 | test_Fillet | passed | 351.328 | 36.003 | 387.331 |  |
| 183 | test_fillet_angle | passed | 18.868 | 3.973 | 22.841 |  |
| 184 | test_fillet_corner_bridge | passed | 68.357 | 3.413 | 71.770 |  |
| 185 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 48.617 | 3.033 | 51.650 |  |
| 186 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 37.590 | 1.413 | 39.003 |  |
| 187 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 28.526 | 2.306 | 30.832 |  |
| 188 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 101.131 | 4.728 | 105.859 |  |
| 189 | test_fillet_edge_degenerate_segment | passed | 1741.878 | 61.804 | 1803.682 |  |
| 190 | test_sketch_profile_tolerant_loop_join | passed | 1616.692 | 12.662 | 1629.354 |  |
| 191 | test_fillet_compound_snapshot_resolution | passed | 2044.160 | 21.014 | 2065.175 |  |
| 192 | test_fillet_generated_history_20260321144106 | passed | 2859.627 | 172.766 | 3032.392 |  |
| 193 | test_generated_history_20260322220620 | passed | 5835.611 | 193.648 | 6029.259 |  |
| 194 | test_generated_history_20260322222832 | passed | 73.101 | 10.003 | 83.104 |  |
| 195 | test_generated_history_20260418030116 | passed | 927.234 | 60.506 | 987.740 |  |
| 196 | test_generated_history_20260427005357 | passed | 3436.547 | 67.690 | 3504.237 |  |
| 197 | test_generated_history_20260427005357_three_face_thicken | passed | 29869.423 | 30.651 | 29900.074 |  |
| 198 | test_generated_history_20260427005357_nine_face_thicken | passed | 3095.938 | 60.192 | 3156.130 |  |
| 199 | test_generated_history_20260523000414 | failed | 1135.270 | 0.000 | 1135.270 | Error: [generated_history_20260523000414] Expected fillet tiny-face island cleanup to reassign triangles.     at Object.test_generated_history_20260523000414 [as test] (file:///home/user/projects/BREP/src/tests/test_generated_history_20260523000414.js:238:11)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28) |
| 200 | test_generated_history_20260531201126 | passed | 250.367 | 22.900 | 273.267 |  |
| 201 | test_generated_history_20260606004152 | passed | 10148.271 | 469.558 | 10617.829 |  |
| 202 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 6549.602 | 4.998 | 6554.600 |  |
| 203 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 7622.935 | 4.347 | 7627.282 |  |
| 204 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 7115.824 | 1.747 | 7117.571 |  |
| 205 | test_fillet_preserves_original_face_names | passed | 658.602 | 28.288 | 686.890 |  |
| 206 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 655.905 | 31.212 | 687.117 |  |
| 207 | test_Fillet_NonClosed | passed | 24.038 | 4.339 | 28.376 |  |
| 208 | test_fillets_more_dificult | passed | 1630.322 | 140.141 | 1770.463 |  |
| 209 | test_Chamfer | passed | 11.888 | 2.338 | 14.226 |  |
| 210 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 4.043 | 1.067 | 5.110 |  |
| 211 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 4.759 | 1.025 | 5.784 |  |
| 212 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 263.381 | 13.536 | 276.917 |  |
| 213 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 407.703 | 14.035 | 421.738 |  |
| 214 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 250.461 | 12.190 | 262.652 |  |
| 215 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 275.519 | 16.751 | 292.270 |  |
| 216 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 302.353 | 14.809 | 317.162 |  |
| 217 | test_edge_smooth_curve_fit | passed | 0.726 | 0.914 | 1.640 |  |
| 218 | test_edge_smooth_curve_fit_closed_loop | passed | 0.594 | 0.833 | 1.427 |  |
| 219 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.690 | 0.834 | 1.524 |  |
| 220 | test_edge_smooth_closed_loop_feature_selection | passed | 2.086 | 0.947 | 3.033 |  |
| 221 | test_edge_smooth_whole_solid_selection | passed | 0.403 | 0.700 | 1.102 |  |
| 222 | test_edge_smooth_face_selection | passed | 0.331 | 0.699 | 1.030 |  |
| 223 | test_smooth_with_subdivision_replaces_source_solid | passed | 50.679 | 5.357 | 56.037 |  |
| 224 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 45.266 | 1.827 | 47.093 |  |
| 225 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 84.069 | 8.652 | 92.720 |  |
| 226 | test_hole_through | passed | 57.713 | 7.778 | 65.491 |  |
| 227 | test_hole_countersink | passed | 83.240 | 8.774 | 92.013 |  |
| 228 | test_hole_counterbore | passed | 114.393 | 11.321 | 125.714 |  |
| 229 | test_hole_multi_point_cloned_cutter | passed | 237.766 | 13.747 | 251.513 |  |
| 230 | test_hole_thread_symbolic | passed | 116.827 | 11.710 | 128.537 |  |
| 231 | test_hole_thread_modeled | passed | 590.258 | 60.868 | 651.126 |  |
| 232 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 13.981 | 1.878 | 15.859 |  |
| 233 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 33.170 | 1.983 | 35.153 |  |
| 234 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.266 | 0.821 | 1.087 |  |
| 235 | test_run_history_calls_are_serialized | passed | 48.622 | 1.611 | 50.232 |  |
| 236 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 29.348 | 2.077 | 31.426 |  |
| 237 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 46.445 | 6.748 | 53.193 |  |
| 238 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 7226.392 | 84.737 | 7311.130 |  |
| 239 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 8097.577 | 0.000 | 8097.577 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at assertSingleBoundaryBetweenFaces (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:703:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28) |
| 240 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 10243.937 | 0.000 | 10243.937 | Error: [generated 20260609074231] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:PROFILE_END, O.S17_ROUND_PIPE_1_CapEnd, E2:S1:G4_SW_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW, E23:S22:G4_SW, E2:S1:G5_SW_END, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E23:S22:G1_SW, O.S17_ROUND_PIPE_2_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G3_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G3_SW_END, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END     at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:807:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28) |
| 241 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 10288.613 | 0.000 | 10288.613 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G6_SW, O.S17_ROUND_PIPE_1_CapEnd, E2:S1:G4_SW_END, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E23:S22:G1_SW, E2:S1:G3_SW, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E23:S22:G2_SW, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, O.S17_ROUND_PIPE_3_Outer, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G3_SW     at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:860:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28) |
| 242 | test_pushFace_feature | passed | 5.007 | 9.582 | 14.588 |  |
| 243 | test_pushFace | passed | 55.555 | 7.931 | 63.486 |  |
| 244 | test_mirror | passed | 6.200 | 2.158 | 8.358 |  |
| 245 | test_history_features_basic | passed | 89.204 | 18.925 | 108.129 |  |
| 246 | test_history_expand_does_not_dirty | passed | 17.450 | 1.435 | 18.885 |  |
| 247 | test_history_test_snippet_persistent_data_allowlist | passed | 0.986 | 0.952 | 1.937 |  |
| 248 | test_selection_owning_feature_resolution | passed | 0.727 | 0.916 | 1.643 |  |
| 249 | test_selection_line2_resolution_repair | passed | 2.273 | 1.102 | 3.375 |  |
| 250 | test_selection_hover_material_restores_before_dispose | passed | 0.449 | 0.768 | 1.218 |  |
| 251 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.273 | 0.749 | 1.022 |  |
| 252 | test_selection_sketch_hover_tints_material_in_place | passed | 0.458 | 0.769 | 1.226 |  |
| 253 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.576 | 0.941 | 1.517 |  |
| 254 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.732 | 4.958 | 5.691 |  |
| 255 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.447 | 0.890 | 1.337 |  |
| 256 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.716 | 0.825 | 1.541 |  |
| 257 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 11.298 | 0.846 | 12.145 |  |
| 258 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 9.359 | 0.859 | 10.218 |  |
| 259 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 10.809 | 0.851 | 11.661 |  |
| 260 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 8.615 | 0.822 | 9.437 |  |
| 261 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 8.021 | 1.159 | 9.179 |  |
| 262 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 14.786 | 0.890 | 15.676 |  |
| 263 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 2.203 | 0.790 | 2.993 |  |
| 264 | test_visibility_hidden_state_persistence | passed | 7.087 | 1.646 | 8.732 |  |
| 265 | test_sketch_feature_scene_visibility | passed | 0.155 | 0.680 | 0.835 |  |
| 266 | test_textToFace | passed | 44.856 | 11.554 | 56.409 |  |
| 267 | test_sheetMetal_nonManifold_sm_f18 | passed | 181.718 | 1.285 | 183.003 |  |
| 268 | test_sheetMetal_tab_circular_hole_wall | passed | 20.848 | 0.753 | 21.601 |  |
| 269 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 9.632 | 0.975 | 10.606 |  |
| 270 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 4.021 | 0.830 | 4.851 |  |
| 271 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 150.740 | 0.897 | 151.637 |  |
| 272 | test_sheetMetal_cutout_context_button | passed | 0.211 | 0.795 | 1.006 |  |
| 273 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.182 | 0.720 | 0.902 |  |
| 274 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 43.868 | 7.234 | 51.102 |  |
| 275 | test_sheetMetal_cutoutEdge_flange_controls | passed | 4.679 | 0.792 | 5.471 |  |
| 276 | test_sheetMetal_corner_fillet | passed | 251.196 | 1.197 | 252.393 |  |
| 277 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 208.027 | 0.932 | 208.959 |  |
| 278 | test_sheetMetal_corner_fillet_selection_resolution | passed | 501.478 | 2.987 | 504.464 |  |
| 279 | test_sheetMetal_corner_fillet_compound_reference | passed | 433.496 | 1.876 | 435.372 |  |
| 280 | test_solidPointMinGap | passed | 0.832 | 0.773 | 1.604 |  |
| 281 | test_solidMetrics | passed | 3.597 | 1.403 | 5.000 |  |
| 282 | import_part_badBoolean | passed | 80.746 | 8.103 | 88.849 |  |
| 283 | import_part_extrudeTest | passed | 24.419 | 5.136 | 29.555 |  |
| 284 | import_part_filletFail | passed | 20.330 | 2.966 | 23.296 |  |
| 285 | import_part_fillet_angle_test.BREP | passed | 27.878 | 5.765 | 33.643 |  |
| 286 | import_part_fillet_test.BREP | passed | 1926.428 | 81.660 | 2008.088 |  |
| 287 | import_part_import_TEst.part.part | passed | 21.684 | 9.819 | 31.503 |  |
| 288 | import_part_medium_fillets.BREP | passed | 543.089 | 36.911 | 580.000 |  |
| 289 | import_part_sketch_throttel_testing.BREP | passed | 13.666 | 4.559 | 18.225 |  |
| 290 | import_part_slowsketch | passed | 1841.707 | 44.606 | 1886.314 |  |
| 291 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 17.416 | 3.411 | 20.826 |  |
| 292 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 8.566 | 0.861 | 9.427 |  |
| 293 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 994.958 | 1.773 | 996.731 |  |

Failure details:

1. test_mesh_cleanup_split_then_winding_removes_internal_overlap (failed)

```
Error: [mesh-cleanup overlap] Expected no boundary edges, received 11.
    at assert (file:///home/user/projects/BREP/src/tests/test_meshCleanupSelfIntersection.js:4:25)
    at Object.test_mesh_cleanup_split_then_winding_removes_internal_overlap [as test] (file:///home/user/projects/BREP/src/tests/test_meshCleanupSelfIntersection.js:102:3)
    at runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:28)
    at runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:34)
```

2. test_generated_history_20260523000414 (failed)

```
Error: [generated_history_20260523000414] Expected fillet tiny-face island cleanup to reassign triangles.
    at Object.test_generated_history_20260523000414 [as test] (file:///home/user/projects/BREP/src/tests/test_generated_history_20260523000414.js:238:11)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28)
```

3. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at assertSingleBoundaryBetweenFaces (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:703:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28)
```

4. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:PROFILE_END, O.S17_ROUND_PIPE_1_CapEnd, E2:S1:G4_SW_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW, E23:S22:G4_SW, E2:S1:G5_SW_END, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E23:S22:G1_SW, O.S17_ROUND_PIPE_2_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G3_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G2_SW, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, E2:S1:G3_SW_END, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:807:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28)
```

5. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G6_SW, O.S17_ROUND_PIPE_1_CapEnd, E2:S1:G4_SW_END, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW_END, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E23:S22:G1_SW, E2:S1:G3_SW, E23:S22:G4_SW, E2:S1:G5_SW_END, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G2_SW, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E23:S22:G2_SW, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, O.S17_ROUND_PIPE_3_Outer, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G3_SW
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:860:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1318:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1240:28)
```
