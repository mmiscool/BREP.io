# BREP Test Run Log

log_version: 1
status: failed
filter: all
planned_tests: 298
tests_run: 298
passed: 295
handled_errors: 0
failed: 3
total_elapsed_ms: 170516.569

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 6.550 | 10.037 | 16.588 |  |
| 2 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.731 | 2.084 | 3.815 |  |
| 3 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.343 | 1.568 | 2.911 |  |
| 4 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 0.878 | 1.498 | 2.376 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 1.396 | 1.993 | 3.389 |  |
| 6 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.776 | 1.257 | 2.033 |  |
| 7 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.666 | 1.174 | 1.840 |  |
| 8 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 5.398 | 1.024 | 6.422 |  |
| 9 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 0.866 | 1.749 | 2.615 |  |
| 10 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.518 | 1.754 | 3.272 |  |
| 11 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.528 | 1.253 | 3.781 |  |
| 12 | test_cppSolidMirror_preserves_face_metadata | passed | 5.141 | 1.091 | 6.232 |  |
| 13 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 2.071 | 2.014 | 4.085 |  |
| 14 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 64.004 | 1.352 | 65.356 |  |
| 15 | test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep | passed | 10.208 | 1.181 | 11.389 |  |
| 16 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 6.874 | 1.616 | 8.491 |  |
| 17 | test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit | passed | 61.510 | 7.273 | 68.783 |  |
| 18 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.432 | 1.121 | 1.553 |  |
| 19 | test_remesh_simplify_imported_fixture_stl | passed | 1394.990 | 385.277 | 1780.267 |  |
| 20 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 6.927 | 1.095 | 8.022 |  |
| 21 | test_revolve_after_union_preserves_face_reference_resolution | passed | 122.881 | 4.572 | 127.453 |  |
| 22 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 0.766 | 1.179 | 1.945 |  |
| 23 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.970 | 1.565 | 2.535 |  |
| 24 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.599 | 1.190 | 1.789 |  |
| 25 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 0.970 | 0.742 | 1.712 |  |
| 26 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 1.233 | 0.921 | 2.155 |  |
| 27 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 0.752 | 1.091 | 1.843 |  |
| 28 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.614 | 1.037 | 1.651 |  |
| 29 | test_cppSolidNative_deduplicateFaceNames_reassigns_duplicate_triangles_to_first_id | passed | 0.311 | 1.195 | 1.505 |  |
| 30 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.668 | 1.325 | 1.993 |  |
| 31 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.738 | 1.344 | 2.082 |  |
| 32 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.650 | 0.974 | 2.624 |  |
| 33 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 1.738 | 0.802 | 2.539 |  |
| 34 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 16.588 | 1.266 | 17.855 |  |
| 35 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 14.440 | 3.412 | 17.852 |  |
| 36 | test_cppSolidNative_filletEdge_inflate_offsets_edge_wedge_corner_in_both_tangent_directions | passed | 16.421 | 0.840 | 17.260 |  |
| 37 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 14.336 | 1.051 | 15.387 |  |
| 38 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 12.149 | 0.695 | 12.844 |  |
| 39 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 14.482 | 0.766 | 15.248 |  |
| 40 | test_cppSolidNative_solidFillet_preserves_tube_centerline_aux_edge | passed | 8.250 | 1.049 | 9.300 |  |
| 41 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 7.573 | 0.984 | 8.558 |  |
| 42 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 7.857 | 0.915 | 8.772 |  |
| 43 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.941 | 1.416 | 2.357 |  |
| 44 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 2.444 | 1.278 | 3.722 |  |
| 45 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 1.130 | 0.795 | 1.925 |  |
| 46 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 1.109 | 0.777 | 1.887 |  |
| 47 | test_cppSolidNative_collapseFilletSideWallFaces_moves_shared_endcap_edge_vertices | passed | 1.325 | 0.747 | 2.072 |  |
| 48 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.798 | 0.804 | 1.603 |  |
| 49 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 10.279 | 0.925 | 11.204 |  |
| 50 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 31.928 | 0.838 | 32.766 |  |
| 51 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 15.118 | 0.818 | 15.937 |  |
| 52 | test_cppTube_slow_fallback_union_preserves_external_cap_label | passed | 19.794 | 0.884 | 20.678 |  |
| 53 | test_cppTube_native_builder_reports_selected_build_mode | passed | 6.594 | 0.748 | 7.342 |  |
| 54 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 14.514 | 1.053 | 15.568 |  |
| 55 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 4.267 | 0.573 | 4.841 |  |
| 56 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.261 | 0.525 | 0.787 |  |
| 57 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 0.936 | 0.753 | 1.689 |  |
| 58 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.210 | 0.542 | 1.752 |  |
| 59 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 10.204 | 0.748 | 10.952 |  |
| 60 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 2.392 | 0.722 | 3.114 |  |
| 61 | test_configurator_expressions | passed | 1.443 | 1.280 | 2.723 |  |
| 62 | test_manifoldPlus_sum | passed | 0.415 | 1.198 | 1.613 |  |
| 63 | test_plane | passed | 2.403 | 1.215 | 3.618 |  |
| 64 | test_primitiveCube | passed | 2.801 | 1.726 | 4.526 |  |
| 65 | test_primitivePyramid | passed | 2.043 | 1.393 | 3.435 |  |
| 66 | test_primitiveCylinder | passed | 8.003 | 3.030 | 11.033 |  |
| 67 | test_face_source_feature_seed | passed | 7.794 | 3.479 | 11.274 |  |
| 68 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 3.501 | 0.641 | 4.142 |  |
| 69 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.646 | 0.528 | 1.174 |  |
| 70 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 9.502 | 4.170 | 13.672 |  |
| 71 | test_offsetFace_preserves_individual_edges | passed | 6.230 | 1.110 | 7.340 |  |
| 72 | test_face_thicken_planar_profile | passed | 14.976 | 1.315 | 16.290 |  |
| 73 | test_face_thicken_hole_profile | passed | 14.880 | 1.368 | 16.248 |  |
| 74 | test_face_thicken_curved_cylinder_side | passed | 123.423 | 3.463 | 126.886 |  |
| 75 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 1056.996 | 9.267 | 1066.262 |  |
| 76 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 2.633 | 0.703 | 3.335 |  |
| 77 | test_face_thicken_connected_patch_preserves_source_cap_faces | passed | 3.884 | 0.783 | 4.668 |  |
| 78 | test_face_thicken_groups_curved_patch_by_shared_edge_normals | passed | 3.467 | 0.693 | 4.159 |  |
| 79 | test_face_thicken_selected_adjacent_normals_accept_relaxed_angle_threshold | passed | 4.145 | 0.821 | 4.966 |  |
| 80 | test_face_thicken_selected_adjacent_normals_match_shared_offset_edge | passed | 3.653 | 0.904 | 4.558 |  |
| 81 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 64.175 | 3.740 | 67.915 |  |
| 82 | test_face_thicken_self_overlap_cylinder_side | passed | 41.713 | 1.752 | 43.465 |  |
| 83 | test_thicken_sphere_torus_union | passed | 2140.225 | 48.393 | 2188.618 |  |
| 84 | test_offsetShell_thickens_all_faces_except_selected | passed | 27.744 | 2.508 | 30.252 |  |
| 85 | test_offsetShell_negative_distance_rounds_unselected_solid_edges | passed | 202.822 | 7.251 | 210.073 |  |
| 86 | test_offsetShell_negative_distance_skips_edges_without_union_sidewall | passed | 103.612 | 0.813 | 104.424 |  |
| 87 | test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor | passed | 0.521 | 0.600 | 1.121 |  |
| 88 | test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap | passed | 0.428 | 0.792 | 1.220 |  |
| 89 | test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor | passed | 0.676 | 1.200 | 1.876 |  |
| 90 | test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge | passed | 1.210 | 0.498 | 1.708 |  |
| 91 | test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices | passed | 0.473 | 0.659 | 1.132 |  |
| 92 | test_offsetShell_repro_20260607082324_removes_area_loss_sidewall | passed | 2331.373 | 50.721 | 2382.093 |  |
| 93 | test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces | passed | 2198.994 | 28.942 | 2227.937 |  |
| 94 | test_offsetShell_debug_separates_rounded_tube_remainder | passed | 173.791 | 13.381 | 187.173 |  |
| 95 | test_offsetShell_preserves_source_centerlines | passed | 523.662 | 2.661 | 526.324 |  |
| 96 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.145 | 0.593 | 0.738 |  |
| 97 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 14.469 | 1.324 | 15.793 |  |
| 98 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 19.031 | 1.944 | 20.975 |  |
| 99 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 25.210 | 2.856 | 28.067 |  |
| 100 | test_face_id_repair_uses_metadata_roles_without_name_suffixes | passed | 0.609 | 0.757 | 1.367 |  |
| 101 | test_face_id_repair_accepts_feature_scoped_metadata_roles | passed | 0.190 | 0.587 | 0.777 |  |
| 102 | test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes | passed | 0.452 | 0.762 | 1.213 |  |
| 103 | test_visualize_does_not_repair_face_ids | passed | 0.405 | 1.045 | 1.450 |  |
| 104 | test_primitiveCone | passed | 6.927 | 3.405 | 10.332 |  |
| 105 | test_primitiveTorus | passed | 50.271 | 24.140 | 74.411 |  |
| 106 | test_primitiveSphere | passed | 4.806 | 3.180 | 7.986 |  |
| 107 | test_feature_dimension_overlay_supports_port | passed | 0.118 | 0.568 | 0.686 |  |
| 108 | test_feature_dimension_registry_support_and_transform_toggle_agree | passed | 0.108 | 0.498 | 0.606 |  |
| 109 | test_feature_dimension_annotation_builder_dispatches_registered_primitive | passed | 0.363 | 0.558 | 0.921 |  |
| 110 | test_reference_snapshot_store_uses_generic_reference_snapshots_key | passed | 0.217 | 0.521 | 0.739 |  |
| 111 | test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis | passed | 0.336 | 0.530 | 0.866 |  |
| 112 | test_part_history_prevent_remove_survives_multi_child_scene_clear | passed | 0.331 | 0.723 | 1.054 |  |
| 113 | test_transform_control_scene_binding_readds_and_removes_overlay_roots | passed | 0.801 | 1.075 | 1.877 |  |
| 114 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.329 | 0.679 | 1.007 |  |
| 115 | test_transform_reference_sanitize_preserves_metadata | passed | 0.183 | 0.580 | 0.763 |  |
| 116 | test_transform_reference_base_uses_face_pick_point | passed | 0.499 | 0.660 | 1.159 |  |
| 117 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.191 | 2.138 | 2.329 |  |
| 118 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.672 | 1.769 | 2.441 |  |
| 119 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.393 | 2.406 | 2.799 |  |
| 120 | test_boolean_subtract | passed | 57.274 | 4.058 | 61.332 |  |
| 121 | test_boolean_face_metadata_preserved | passed | 144.412 | 1.225 | 145.637 |  |
| 122 | test_primitive_boolean_union_preserves_face_grouping | passed | 62.384 | 5.366 | 67.750 |  |
| 123 | test_boolean_operation_target_name_preserved | passed | 18.105 | 3.524 | 21.628 |  |
| 124 | test_stlLoader | passed | 70.299 | 16.647 | 86.947 |  |
| 125 | test_import3d_decimation_reduces_triangle_count | passed | 31.030 | 24.119 | 55.148 |  |
| 126 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 21.345 | 5.050 | 26.395 |  |
| 127 | test_import3d_decimation_99_is_near_full_detail | passed | 47.388 | 32.725 | 80.112 |  |
| 128 | test_import3d_decimation_100_restores_original_geometry | passed | 41.726 | 20.469 | 62.195 |  |
| 129 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 46.627 | 5.385 | 52.012 |  |
| 130 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 41.946 | 12.288 | 54.234 |  |
| 131 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.051 | 3.328 | 5.379 |  |
| 132 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 0.475 | 0.751 | 1.226 |  |
| 133 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 0.366 | 0.599 | 0.964 |  |
| 134 | test_import3d_fixture_merges_faces_4_and_34 | passed | 1205.867 | 522.077 | 1727.944 |  |
| 135 | test_import3d_extract_multiple_solids_toggle | passed | 18.361 | 3.887 | 22.248 |  |
| 136 | test_SweepFace | passed | 75.878 | 6.241 | 82.119 |  |
| 137 | test_SweepFace_pathAlign_multi_loop_islands | passed | 29.722 | 3.840 | 33.562 |  |
| 138 | test_tube | passed | 153.442 | 31.705 | 185.146 |  |
| 139 | test_tube_closedLoop | passed | 63.233 | 21.525 | 84.758 |  |
| 140 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.278 | 0.614 | 0.892 |  |
| 141 | test_wire_harness_connection_endpoint_resolution | passed | 0.684 | 0.615 | 1.298 |  |
| 142 | test_sheet_custom_size_persists | passed | 0.846 | 0.713 | 1.559 |  |
| 143 | test_sheet_metadata_updated_at_is_stable_on_read | passed | 0.496 | 0.720 | 1.216 |  |
| 144 | test_pmi_view_text_size_setting_normalizes | passed | 0.356 | 0.769 | 1.125 |  |
| 145 | test_pmi_view_visibility_state_normalizes | passed | 0.160 | 0.775 | 0.935 |  |
| 146 | test_pmi_view_visibility_state_round_trip | passed | 3.635 | 1.012 | 4.647 |  |
| 147 | test_pmi_linear_dimension_face_target_measures_perpendicular_to_face | passed | 0.886 | 0.576 | 1.462 |  |
| 148 | test_pmi_linear_dimension_parallel_faces_measure_plane_spacing | passed | 0.259 | 1.423 | 1.681 |  |
| 149 | test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line | passed | 0.465 | 0.978 | 1.443 |  |
| 150 | test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge | passed | 1.082 | 1.229 | 2.310 |  |
| 151 | test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing | passed | 0.502 | 1.291 | 1.792 |  |
| 152 | test_pmi_linear_dimension_single_edge_still_measures_edge_length | passed | 0.489 | 1.653 | 2.141 |  |
| 153 | test_pmi_linear_dimension_limits_targets_to_two | passed | 0.765 | 1.292 | 2.057 |  |
| 154 | test_pmi_annotation_failure_status_is_visible | passed | 0.434 | 1.270 | 1.704 |  |
| 155 | test_pmi_radial_dimension_accepts_pipe_aux_path_face | passed | 1.593 | 1.173 | 2.766 |  |
| 156 | test_pmi_radial_dimension_uses_fillet_pipe_radius_override | passed | 0.524 | 1.384 | 1.908 |  |
| 157 | test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override | passed | 0.543 | 1.620 | 2.163 |  |
| 158 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 1.527 | 1.848 | 3.376 |  |
| 159 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.168 | 1.293 | 1.461 |  |
| 160 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.225 | 1.193 | 1.418 |  |
| 161 | test_pmi_export_render_context_applies_visibility_state | passed | 1.008 | 15.574 | 16.582 |  |
| 162 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.227 | 0.866 | 1.093 |  |
| 163 | test_sheet_clipboard_image_utils | passed | 0.753 | 0.803 | 1.556 |  |
| 164 | test_wire_harness_formboard_insert | passed | 6.556 | 1.007 | 7.563 |  |
| 165 | test_wire_harness_sheet_table_insert | passed | 1.572 | 0.693 | 2.265 |  |
| 166 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.234 | 0.566 | 1.800 |  |
| 167 | test_wire_harness_routes_render_as_scene_solids | passed | 5.462 | 0.918 | 6.381 |  |
| 168 | test_wire_harness_route_results_persist_in_model_json | passed | 1.777 | 1.135 | 2.912 |  |
| 169 | test_sketch_openLoop | passed | 3.923 | 1.115 | 5.038 |  |
| 170 | test_sketch_snapshot_restore_selection_handlers | passed | 5.390 | 1.168 | 6.557 |  |
| 171 | test_sketch_face_attachment_alignment | passed | 621.306 | 14.522 | 635.828 |  |
| 172 | test_sketch_solver_topology_rect_shared_points | passed | 8.555 | 0.800 | 9.355 |  |
| 173 | test_sketch_solver_topology_coincident_chain | passed | 12.616 | 0.856 | 13.472 |  |
| 174 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 13.466 | 2.272 | 15.738 |  |
| 175 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 15.350 | 0.712 | 16.062 |  |
| 176 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 33.953 | 0.923 | 34.875 |  |
| 177 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.053 | 0.587 | 1.640 |  |
| 178 | test_sketch_solver_line_to_point_distance_constraint | passed | 3.162 | 0.591 | 3.754 |  |
| 179 | test_extrude_negative_distance_cap_alignment | passed | 7.872 | 1.655 | 9.526 |  |
| 180 | test_extrude_intersect_coplanar_face_merge | passed | 1814.189 | 16.609 | 1830.799 |  |
| 181 | test_ExtrudeFace | passed | 32.280 | 3.442 | 35.722 |  |
| 182 | test_extrude_solid_face_uses_boundary_edge_sidewalls | passed | 6.102 | 2.078 | 8.180 |  |
| 183 | test_Fillet | passed | 551.325 | 36.449 | 587.774 |  |
| 184 | test_fillet_angle | passed | 12.811 | 3.589 | 16.400 |  |
| 185 | test_fillet_corner_bridge | passed | 38.647 | 2.902 | 41.549 |  |
| 186 | test_fillet_rebuild_re_resolves_stale_edge_object | passed | 40.648 | 1.645 | 42.293 |  |
| 187 | test_history_delete_restores_removed_upstream_solid_from_source_feature | passed | 35.617 | 1.110 | 36.727 |  |
| 188 | test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache | passed | 23.535 | 1.705 | 25.240 |  |
| 189 | test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges | passed | 107.149 | 11.003 | 118.152 |  |
| 190 | test_fillet_edge_degenerate_segment | passed | 1769.363 | 48.562 | 1817.925 |  |
| 191 | test_sketch_profile_tolerant_loop_join | passed | 1544.360 | 9.686 | 1554.046 |  |
| 192 | test_fillet_compound_snapshot_resolution | passed | 1989.697 | 17.850 | 2007.547 |  |
| 193 | test_fillet_generated_history_20260321144106 | passed | 5174.923 | 210.023 | 5384.946 |  |
| 194 | test_generated_history_20260322220620 | passed | 10401.674 | 287.458 | 10689.132 |  |
| 195 | test_generated_history_20260322222832 | passed | 96.708 | 9.805 | 106.513 |  |
| 196 | test_generated_history_20260418030116 | passed | 1187.905 | 46.128 | 1234.033 |  |
| 197 | test_generated_history_20260427005357 | passed | 3669.341 | 81.528 | 3750.869 |  |
| 198 | test_generated_history_20260427005357_three_face_thicken | passed | 22290.005 | 31.703 | 22321.709 |  |
| 199 | test_generated_history_20260427005357_nine_face_thicken | passed | 3498.087 | 75.056 | 3573.143 |  |
| 200 | test_generated_history_20260523000414 | passed | 1802.329 | 92.299 | 1894.628 |  |
| 201 | test_generated_history_20260531201126 | passed | 258.174 | 18.343 | 276.516 |  |
| 202 | test_generated_history_20260606004152 | passed | 13749.150 | 385.384 | 14134.534 |  |
| 203 | test_generated_history_20260607180752_offset_shell_negative_half_is_manifold | passed | 6665.770 | 2.425 | 6668.195 |  |
| 204 | test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup | passed | 6790.053 | 3.131 | 6793.184 |  |
| 205 | test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse | passed | 6681.560 | 3.110 | 6684.671 |  |
| 206 | test_generated_history_20260612230031 | passed | 72.568 | 5.873 | 78.440 |  |
| 207 | test_generated_history_20260612232755 | passed | 650.239 | 22.802 | 673.041 |  |
| 208 | test_generated_history_20260613000139 | passed | 91.847 | 7.371 | 99.218 |  |
| 209 | test_generated_history_20260613003952 | passed | 11269.030 | 316.389 | 11585.419 |  |
| 210 | test_fillet_preserves_original_face_names | passed | 663.027 | 26.999 | 690.026 |  |
| 211 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 699.073 | 25.612 | 724.686 |  |
| 212 | test_Fillet_NonClosed | passed | 16.696 | 2.780 | 19.477 |  |
| 213 | test_fillets_more_dificult | passed | 1748.058 | 135.749 | 1883.806 |  |
| 214 | test_Chamfer | passed | 10.465 | 1.754 | 12.219 |  |
| 215 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 3.317 | 0.725 | 4.042 |  |
| 216 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 2.809 | 0.863 | 3.672 |  |
| 217 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 253.530 | 11.300 | 264.830 |  |
| 218 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | passed | 331.532 | 10.190 | 341.722 |  |
| 219 | test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane | passed | 228.716 | 10.165 | 238.881 |  |
| 220 | test_cppChamfer_debug_emits_cross_section_face_per_sample | passed | 258.141 | 14.950 | 273.091 |  |
| 221 | test_cppChamfer_debug_sections_materialize_as_sketch_profiles | passed | 242.490 | 12.192 | 254.683 |  |
| 222 | test_edge_smooth_curve_fit | passed | 0.550 | 0.654 | 1.204 |  |
| 223 | test_edge_smooth_curve_fit_closed_loop | passed | 0.406 | 0.556 | 0.961 |  |
| 224 | test_edge_smooth_constraints_prevent_triangle_foldback | passed | 0.417 | 0.524 | 0.941 |  |
| 225 | test_edge_smooth_closed_loop_feature_selection | passed | 1.246 | 0.566 | 1.811 |  |
| 226 | test_edge_smooth_whole_solid_selection | passed | 0.354 | 0.488 | 0.842 |  |
| 227 | test_edge_smooth_face_selection | passed | 0.278 | 0.473 | 0.751 |  |
| 228 | test_smooth_with_subdivision_replaces_source_solid | passed | 31.608 | 2.580 | 34.188 |  |
| 229 | test_smooth_with_subdivision_preserves_centered_ring_symmetry | passed | 27.626 | 1.485 | 29.112 |  |
| 230 | test_smooth_with_subdivision_preserves_mirrored_union_symmetry | passed | 60.879 | 4.317 | 65.196 |  |
| 231 | test_hole_through | passed | 40.203 | 4.113 | 44.316 |  |
| 232 | test_hole_countersink | passed | 63.812 | 5.974 | 69.786 |  |
| 233 | test_hole_counterbore | passed | 96.360 | 8.206 | 104.566 |  |
| 234 | test_hole_multi_point_cloned_cutter | passed | 171.212 | 10.124 | 181.336 |  |
| 235 | test_hole_thread_symbolic | passed | 94.878 | 5.532 | 100.410 |  |
| 236 | test_hole_thread_modeled | passed | 502.967 | 43.700 | 546.667 |  |
| 237 | test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge | passed | 10.216 | 1.082 | 11.298 |  |
| 238 | test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls | passed | 21.323 | 3.953 | 25.276 |  |
| 239 | test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool | passed | 0.275 | 0.803 | 1.078 |  |
| 240 | test_run_history_calls_are_serialized | passed | 45.656 | 1.230 | 46.887 |  |
| 241 | test_subtract_extrude_preserves_rectangle_tool_sidewall_faces | passed | 17.144 | 1.286 | 18.430 |  |
| 242 | test_subtract_restore_rejects_raw_tool_added_snapshot | passed | 27.818 | 1.582 | 29.400 |  |
| 243 | test_generated_history_20260609042734_preserves_s22_subtract_sidewalls | passed | 7670.531 | 72.748 | 7743.279 |  |
| 244 | test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result | failed | 7948.528 | 0.000 | 7948.528 | Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0:      at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at assertSingleBoundaryBetweenFaces (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:520:3)     at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:703:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28) |
| 245 | test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces | failed | 10273.383 | 0.000 | 10273.383 | Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7     at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:795:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28) |
| 246 | test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face | failed | 10466.344 | 0.000 | 10466.344 | Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G2_SW_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G4_SW, E2:S1:G5_SW_END, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW\|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW\|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G4_SW\|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW\|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW_END     at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)     at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:860:3)     at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)     at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28) |
| 247 | test_pushFace_feature | passed | 4.388 | 12.673 | 17.061 |  |
| 248 | test_pushFace | passed | 46.126 | 5.856 | 51.981 |  |
| 249 | test_mirror | passed | 4.409 | 1.788 | 6.197 |  |
| 250 | test_history_features_basic | passed | 79.961 | 11.608 | 91.569 |  |
| 251 | test_history_expand_does_not_dirty | passed | 14.847 | 0.838 | 15.685 |  |
| 252 | test_history_test_snippet_persistent_data_allowlist | passed | 0.597 | 0.476 | 1.072 |  |
| 253 | test_selection_owning_feature_resolution | passed | 0.360 | 0.457 | 0.816 |  |
| 254 | test_selection_line2_resolution_repair | passed | 1.212 | 0.459 | 1.671 |  |
| 255 | test_selection_hover_material_restores_before_dispose | passed | 0.249 | 0.471 | 0.720 |  |
| 256 | test_selection_profile_named_solid_face_hover_does_not_tint_shared_face_material | passed | 0.196 | 0.513 | 0.709 |  |
| 257 | test_selection_sketch_hover_tints_material_in_place | passed | 0.252 | 0.474 | 0.726 |  |
| 258 | test_selection_filter_empty_hover_clears_in_place_sketch_hover | passed | 0.382 | 0.491 | 0.873 |  |
| 259 | test_solid_overlap_diagnostics_detects_coplanar_overlap | passed | 0.488 | 0.579 | 1.066 |  |
| 260 | test_solid_overlap_diagnostics_ignores_boundary_touching_faces | passed | 0.190 | 0.466 | 0.656 |  |
| 261 | test_solid_overlap_diagnostics_detects_cross_solid_overlap | passed | 0.345 | 0.457 | 0.802 |  |
| 262 | test_boolean_overlap_conditioning_union_enabled_by_default | passed | 7.299 | 0.517 | 7.816 |  |
| 263 | test_boolean_overlap_conditioning_union_can_be_disabled | passed | 7.802 | 4.441 | 12.243 |  |
| 264 | test_boolean_overlap_conditioning_subtract_enabled_by_default | passed | 9.799 | 0.845 | 10.644 |  |
| 265 | test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward | passed | 7.033 | 0.673 | 7.706 |  |
| 266 | test_boolean_overlap_conditioning_subtract_can_be_disabled | passed | 7.644 | 1.012 | 8.656 |  |
| 267 | test_boolean_overlap_conditioning_direct_api_enabled_by_default | passed | 16.489 | 0.864 | 17.354 |  |
| 268 | test_boolean_overlap_conditioning_direct_api_can_be_disabled | passed | 1.991 | 0.691 | 2.682 |  |
| 269 | test_visibility_hidden_state_persistence | passed | 6.974 | 1.311 | 8.285 |  |
| 270 | test_sketch_feature_scene_visibility | passed | 0.138 | 0.804 | 0.941 |  |
| 271 | test_textToFace | passed | 46.121 | 10.890 | 57.011 |  |
| 272 | test_sheetMetal_nonManifold_sm_f18 | passed | 199.688 | 2.394 | 202.081 |  |
| 273 | test_sheetMetal_tab_circular_hole_wall | passed | 20.256 | 0.906 | 21.161 |  |
| 274 | test_sheetMetal_flat_pattern_files_use_model_and_feature_names | passed | 10.289 | 0.913 | 11.202 |  |
| 275 | test_sheetMetal_flat_pattern_preview_visualize_is_idempotent | passed | 5.351 | 1.215 | 6.566 |  |
| 276 | test_sheetMetal_bend_face_cylindrical_metadata | passed | 170.905 | 1.047 | 171.952 |  |
| 277 | test_sheetMetal_cutout_context_button | passed | 0.223 | 1.031 | 1.253 |  |
| 278 | test_sheetMetal_contour_flange_context_button_prefers_sketch | passed | 0.203 | 0.698 | 0.901 |  |
| 279 | test_sheetMetal_contour_flange_whole_sketch_selection | passed | 54.107 | 6.862 | 60.969 |  |
| 280 | test_sheetMetal_cutoutEdge_flange_controls | passed | 5.098 | 0.733 | 5.831 |  |
| 281 | test_sheetMetal_corner_fillet | passed | 279.883 | 1.695 | 281.577 |  |
| 282 | test_sheetMetal_corner_fillet_face_cylindrical_metadata | passed | 255.968 | 1.326 | 257.293 |  |
| 283 | test_sheetMetal_corner_fillet_selection_resolution | passed | 500.223 | 0.859 | 501.081 |  |
| 284 | test_sheetMetal_corner_fillet_compound_reference | passed | 437.106 | 3.115 | 440.221 |  |
| 285 | test_solidPointMinGap | passed | 0.682 | 0.585 | 1.266 |  |
| 286 | test_solidMetrics | passed | 3.046 | 1.427 | 4.473 |  |
| 287 | import_part_badBoolean | passed | 82.322 | 7.103 | 89.425 |  |
| 288 | import_part_extrudeTest | passed | 25.246 | 5.256 | 30.502 |  |
| 289 | import_part_filletFail | passed | 19.248 | 2.627 | 21.876 |  |
| 290 | import_part_fillet_angle_test.BREP | passed | 38.109 | 4.901 | 43.010 |  |
| 291 | import_part_fillet_test.BREP | passed | 1976.145 | 89.722 | 2065.867 |  |
| 292 | import_part_import_TEst.part.part | passed | 36.861 | 6.722 | 43.583 |  |
| 293 | import_part_medium_fillets.BREP | passed | 595.764 | 38.654 | 634.418 |  |
| 294 | import_part_sketch_throttel_testing.BREP | passed | 16.317 | 4.042 | 20.359 |  |
| 295 | import_part_slowsketch | passed | 1971.519 | 39.772 | 2011.291 |  |
| 296 | test_sketch_solver_fixture_coincident_chain_fixture | passed | 14.677 | 3.639 | 18.317 |  |
| 297 | test_sketch_solver_fixture_rect_width_height_fixture | passed | 6.832 | 0.648 | 7.480 |  |
| 298 | test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture | passed | 980.853 | 2.806 | 983.659 |  |

Failure details:

1. test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result (failed)

```
Error: [generated 20260609045351 full replay] Expected one boundary between E2:S1:G2_SW_START and E2:S1:G2_SW_END, found 0: 
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at assertSingleBoundaryBetweenFaces (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:520:3)
    at Object.test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:703:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28)
```

2. test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces (failed)

```
Error: [generated 20260609074231] Expected all F26 end caps adjacent to E2:S1:G3_SW_END to merge; remaining=F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_END_CAP_1 settle=7 merge=7
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at Object.test_generated_history_20260609074231_outset_fillet_end_caps_merge_into_planar_faces [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:795:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28)
```

3. test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face (failed)

```
Error: [generated 20260609150657] Expected adjacent planar face E2:S1:G3_SW_START to survive. Faces: E2:S1:G2_SW_END, E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, O.S17_ROUND_PIPE_3_Outer, E23:S22:G4_SW, E2:S1:G5_SW_END, E23:S22:G2_SW, E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G4_SW_80f5dd68_3_TUBE_Outer, E23:S22:G3_SW, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV, E2_S1_G4_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, F26_FILLET_E23_S22_G2_SW_E23_S22_G3_SW_1138d474_2_TUBE_Outer, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV, F26_FILLET_E23_S22_G3_SW_E23_S22_G4_SW_0b4b4a76_1_TUBE_Outer, O.S17_ROUND_PIPE_1_CapEnd, E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV_E2_S1_PROFILE_START_END_0_SW, E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV_END, E23:S22:G1_SW, F26_FILLET_E23_S22_G1_SW_E23_S22_G2_SW_085f311a_0_TUBE_Outer, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV_END, O.S17_ROUND_PIPE_2_Outer, E2:S1:PROFILE_END, E2:S1:G4_SW, E2:S1:G5_SW, E2:S1:G3_SW, E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW, E2:S1:G3_SW_END, O.S17_ROUND_PIPE_3_CapStart, E2:S1:G2_SW, O.S17_ROUND_PIPE_1_Outer, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW_END, E2:S1:PROFILE_END_END, E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV, E2:S1:G6_SW, E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV_END, E2:S1:G4_SW_END
    at assert (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:4:25)
    at Object.test_generated_history_20260609150657_outset_fillet_start_end_caps_merge_into_planar_face [as test] (file:///home/user/projects/BREP/src/tests/test_extrude_sidewall_face_tracking.js:860:3)
    at async runSingleTest (file:///home/user/projects/BREP/src/tests/tests.js:1368:9)
    at async runTests (file:///home/user/projects/BREP/src/tests/tests.js:1290:28)
```
