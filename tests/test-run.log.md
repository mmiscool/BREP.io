# BREP Test Run Log

log_version: 1
status: failed
started_at: 2026-06-03T04:22:20.162Z
finished_at: 2026-06-03T04:23:06.130Z
filter: all
planned_tests: 223
tests_run: 161
passed: 160
handled_errors: 0
failed: 1
total_elapsed_ms: 45967.528

| # | test | status | test_ms | artifact_ms | total_ms | notes |
|---:|---|---|---:|---:|---:|---|
| 1 | test_cppNative_prepareManifoldMesh_matches_legacy_js_reference | passed | 7.036 | 10.419 | 17.454 |  |
| 2 | test_cppSolidCore_preserves_face_ids_and_metadata | passed | 1.797 | 2.369 | 4.166 |  |
| 3 | test_cppSolidCore_setAuthoringState_and_bakeTransform | passed | 1.213 | 1.711 | 2.924 |  |
| 4 | test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers | passed | 1.038 | 1.318 | 2.356 |  |
| 5 | test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance | passed | 1.164 | 1.440 | 2.604 |  |
| 6 | test_cppSolidCore_pushFace_moves_vertices_for_face | passed | 0.594 | 1.504 | 2.098 |  |
| 7 | test_cppSolidCore_prepareManifoldMesh_repairs_orientation | passed | 0.562 | 1.310 | 1.872 |  |
| 8 | test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads | passed | 4.984 | 1.611 | 6.595 |  |
| 9 | test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh | passed | 1.274 | 2.126 | 3.399 |  |
| 10 | test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells | passed | 1.453 | 1.417 | 2.870 |  |
| 11 | test_cppSolidBakeTransform_updates_solid_authoring_state | passed | 2.799 | 1.325 | 4.123 |  |
| 12 | test_cppSolidMirror_preserves_face_metadata | passed | 5.314 | 1.584 | 6.898 |  |
| 13 | test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole | passed | 1.952 | 1.448 | 3.400 |  |
| 14 | test_revolve_feature_resolves_face_and_edge_string_references | passed | 68.625 | 1.254 | 69.879 |  |
| 15 | test_revolve_generates_manifold_native_faces_for_axis_edge_profile | passed | 6.783 | 1.057 | 7.840 |  |
| 16 | test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld | passed | 0.562 | 1.158 | 1.720 |  |
| 17 | test_remesh_simplify_imported_fixture_stl | passed | 1628.349 | 391.988 | 2020.337 |  |
| 18 | test_solid_simplify_preserves_face_tags_and_metadata | passed | 7.194 | 1.154 | 8.349 |  |
| 19 | test_revolve_after_union_preserves_face_reference_resolution | passed | 82.386 | 3.893 | 86.280 |  |
| 20 | test_cppSolidNative_setEpsilon_welds_vertices | passed | 0.557 | 0.988 | 1.545 |  |
| 21 | test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold | passed | 0.522 | 0.866 | 1.389 |  |
| 22 | test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata | passed | 0.308 | 1.022 | 1.330 |  |
| 23 | test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata | passed | 0.966 | 3.773 | 4.739 |  |
| 24 | test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face | passed | 1.357 | 0.584 | 1.941 |  |
| 25 | test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell | passed | 0.641 | 0.661 | 1.303 |  |
| 26 | test_cppSolidNative_pushFace_updates_planar_face_vertices | passed | 0.515 | 0.700 | 1.215 |  |
| 27 | test_cppSolidNative_getFaceNormal_reports_planar_face_normal | passed | 0.438 | 0.626 | 1.065 |  |
| 28 | test_cppSolidNative_manifoldize_repairs_incoherent_winding | passed | 0.410 | 0.497 | 0.907 |  |
| 29 | test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset | passed | 1.084 | 0.580 | 1.664 |  |
| 30 | test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata | passed | 1.533 | 0.534 | 2.068 |  |
| 31 | test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon | passed | 13.393 | 0.604 | 13.997 |  |
| 32 | test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots | passed | 12.273 | 0.952 | 13.225 |  |
| 33 | test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata | passed | 14.801 | 0.732 | 15.532 |  |
| 34 | test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices | passed | 12.702 | 0.815 | 13.517 |  |
| 35 | test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps | passed | 11.259 | 0.724 | 11.983 |  |
| 36 | test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge | passed | 8.057 | 0.915 | 8.971 |  |
| 37 | test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor | passed | 2.940 | 0.657 | 3.598 |  |
| 38 | test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls | passed | 0.665 | 0.676 | 1.341 |  |
| 39 | test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary | passed | 1.170 | 0.633 | 1.803 |  |
| 40 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices | passed | 0.924 | 0.624 | 1.547 |  |
| 41 | test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face | passed | 0.772 | 0.613 | 1.384 |  |
| 42 | test_cppSolidNative_collapseFilletSideWallFaces_preserves_shared_endpoint_junctions | passed | 0.786 | 0.635 | 1.421 |  |
| 43 | test_cppTube_open_tube_preserves_expected_face_labels | passed | 9.912 | 0.840 | 10.752 |  |
| 44 | test_cppTube_closed_hollow_tube_preserves_expected_face_labels | passed | 28.422 | 0.822 | 29.243 |  |
| 45 | test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots | passed | 13.379 | 0.680 | 14.059 |  |
| 46 | test_cppTube_native_builder_reports_selected_build_mode | passed | 6.955 | 0.741 | 7.696 |  |
| 47 | test_cppTube_native_auto_falls_back_to_slow_on_foldback_path | passed | 19.456 | 1.140 | 20.596 |  |
| 48 | test_cppTube_feature_inner_cutter_nudges_open_end_caps | passed | 6.290 | 0.755 | 7.045 |  |
| 49 | test_cppPrimitive_cube_preserves_expected_face_labels | passed | 0.375 | 0.977 | 1.352 |  |
| 50 | test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata | passed | 0.903 | 0.723 | 1.626 |  |
| 51 | test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata | passed | 1.327 | 0.631 | 1.958 |  |
| 52 | test_cppPrimitive_torus_and_pyramid_preserve_face_labels | passed | 8.553 | 0.722 | 9.274 |  |
| 53 | test_cppPrimitive_sphere_preserves_single_face_label | passed | 2.789 | 0.718 | 3.507 |  |
| 54 | test_configurator_expressions | passed | 1.405 | 0.803 | 2.208 |  |
| 55 | test_manifoldPlus_sum | passed | 0.186 | 0.760 | 0.945 |  |
| 56 | test_plane | passed | 1.167 | 0.852 | 2.019 |  |
| 57 | test_primitiveCube | passed | 3.084 | 2.287 | 5.371 |  |
| 58 | test_primitivePyramid | passed | 1.913 | 1.400 | 3.313 |  |
| 59 | test_primitiveCylinder | passed | 5.393 | 3.836 | 9.229 |  |
| 60 | test_face_source_feature_seed | passed | 5.441 | 1.971 | 7.412 |  |
| 61 | test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges | passed | 3.536 | 0.744 | 4.280 |  |
| 62 | test_mesh_cleanup_split_point_intersection_inserts_vertex | passed | 0.716 | 0.868 | 1.585 |  |
| 63 | test_mesh_cleanup_split_then_winding_removes_internal_overlap | passed | 8.450 | 3.220 | 11.670 |  |
| 64 | test_offsetFace_preserves_individual_edges | passed | 5.720 | 1.253 | 6.973 |  |
| 65 | test_face_thicken_planar_profile | passed | 9.707 | 1.003 | 10.710 |  |
| 66 | test_face_thicken_hole_profile | passed | 8.008 | 1.054 | 9.062 |  |
| 67 | test_face_thicken_curved_cylinder_side | passed | 103.840 | 3.651 | 107.491 |  |
| 68 | test_face_thicken_partial_torus_side_avoids_internal_voids | passed | 932.997 | 9.027 | 942.024 |  |
| 69 | test_face_thicken_boundary_uses_smooth_adjacent_face_normals | passed | 2.353 | 0.665 | 3.018 |  |
| 70 | test_face_thicken_filleted_planar_face_keeps_clean_boundaries | passed | 55.493 | 2.045 | 57.538 |  |
| 71 | test_face_thicken_self_overlap_cylinder_side | passed | 39.811 | 2.819 | 42.630 |  |
| 72 | test_thicken_sphere_torus_union | passed | 1929.738 | 47.197 | 1976.935 |  |
| 73 | test_offsetShell_thickens_all_faces_except_selected | passed | 114.104 | 2.148 | 116.252 |  |
| 74 | test_offsetShell_preserves_source_centerlines | passed | 59.910 | 0.709 | 60.619 |  |
| 75 | test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches | passed | 0.144 | 0.623 | 0.767 |  |
| 76 | test_thicken_feature_serializes_and_replays_planar_profile | passed | 6.545 | 0.925 | 7.470 |  |
| 77 | test_thicken_feature_multiple_faces_produce_multiple_solids | passed | 11.235 | 1.173 | 12.408 |  |
| 78 | test_thicken_feature_connected_faces_remain_individual_solids | passed | 10.916 | 1.444 | 12.360 |  |
| 79 | test_primitiveCone | passed | 3.467 | 2.035 | 5.502 |  |
| 80 | test_primitiveTorus | passed | 30.950 | 19.405 | 50.356 |  |
| 81 | test_primitiveSphere | passed | 3.389 | 2.352 | 5.741 |  |
| 82 | test_feature_dimension_overlay_supports_port | passed | 0.099 | 0.613 | 0.712 |  |
| 83 | test_port_extension_annotation_geometry_preserves_extension_value | passed | 0.238 | 0.651 | 0.889 |  |
| 84 | test_transform_reference_sanitize_preserves_metadata | passed | 0.134 | 0.591 | 0.725 |  |
| 85 | test_transform_reference_base_uses_face_pick_point | passed | 0.364 | 0.553 | 0.917 |  |
| 86 | test_referenced_transform_matrix_uses_vertex_reference_origin | passed | 0.225 | 0.655 | 0.880 |  |
| 87 | test_port_definition_uses_transform_reference_without_anchor | passed | 0.731 | 0.617 | 1.348 |  |
| 88 | test_port_definition_uses_transform_reference_and_direction_reference | passed | 0.360 | 0.907 | 1.267 |  |
| 89 | test_boolean_subtract | passed | 22.345 | 1.840 | 24.185 |  |
| 90 | test_boolean_face_metadata_preserved | passed | 113.812 | 0.676 | 114.489 |  |
| 91 | test_primitive_boolean_union_preserves_face_grouping | passed | 56.660 | 5.946 | 62.606 |  |
| 92 | test_boolean_operation_target_name_preserved | passed | 14.266 | 2.144 | 16.411 |  |
| 93 | test_stlLoader | passed | 78.379 | 11.322 | 89.701 |  |
| 94 | test_import3d_decimation_reduces_triangle_count | passed | 28.773 | 19.045 | 47.818 |  |
| 95 | test_import3d_decimation_reapplies_from_cached_source_mesh | passed | 23.676 | 8.564 | 32.241 |  |
| 96 | test_import3d_decimation_99_is_near_full_detail | passed | 58.546 | 33.212 | 91.758 |  |
| 97 | test_import3d_decimation_100_restores_original_geometry | passed | 43.138 | 14.848 | 57.986 |  |
| 98 | test_import3d_decimation_seeds_source_snapshot_for_legacy_cache | passed | 61.361 | 6.395 | 67.756 |  |
| 99 | test_import3d_decimation_preserves_source_snapshot_without_json_clone | passed | 46.385 | 16.092 | 62.477 |  |
| 100 | test_import3d_planar_extraction_merges_sliver_bridge | passed | 2.164 | 5.325 | 7.488 |  |
| 101 | test_import3d_planar_extraction_keeps_small_flat_patch_edges | passed | 1.869 | 1.497 | 3.367 |  |
| 102 | test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor | passed | 1.306 | 0.909 | 2.215 |  |
| 103 | test_import3d_fixture_merges_faces_4_and_34 | passed | 1141.893 | 427.380 | 1569.274 |  |
| 104 | test_import3d_extract_multiple_solids_toggle | passed | 11.783 | 2.068 | 13.851 |  |
| 105 | test_SweepFace | passed | 39.143 | 3.758 | 42.901 |  |
| 106 | test_SweepFace_pathAlign_multi_loop_islands | passed | 10.239 | 1.852 | 12.091 |  |
| 107 | test_tube | passed | 113.507 | 25.447 | 138.954 |  |
| 108 | test_tube_closedLoop | passed | 55.539 | 15.866 | 71.406 |  |
| 109 | test_wire_harness_formboard_reuses_only_formboard_sheet | passed | 0.255 | 0.668 | 0.924 |  |
| 110 | test_wire_harness_connection_endpoint_resolution | passed | 0.836 | 0.554 | 1.390 |  |
| 111 | test_sheet_custom_size_persists | passed | 0.711 | 0.620 | 1.331 |  |
| 112 | test_pmi_view_text_size_setting_normalizes | passed | 0.291 | 0.629 | 0.920 |  |
| 113 | test_pmi_view_visibility_state_normalizes | passed | 0.134 | 0.631 | 0.765 |  |
| 114 | test_pmi_view_visibility_state_round_trip | passed | 2.470 | 0.902 | 3.372 |  |
| 115 | test_pmi_monochrome_label_svg_uses_backdrop_color | passed | 0.830 | 0.549 | 1.379 |  |
| 116 | test_pmi_monochrome_label_layout_is_tighter_than_shaded | passed | 0.082 | 0.599 | 0.682 |  |
| 117 | test_pmi_enter_edit_mode_reuses_shared_flow | passed | 0.163 | 0.635 | 0.798 |  |
| 118 | test_pmi_export_render_context_applies_visibility_state | passed | 0.896 | 0.581 | 1.477 |  |
| 119 | test_pmi_effective_visibility_respects_hidden_ancestor | passed | 0.108 | 0.548 | 0.656 |  |
| 120 | test_sheet_clipboard_image_utils | passed | 0.597 | 0.591 | 1.188 |  |
| 121 | test_wire_harness_formboard_insert | passed | 4.569 | 0.537 | 5.106 |  |
| 122 | test_wire_harness_sheet_table_insert | passed | 1.407 | 0.522 | 1.930 |  |
| 123 | test_wire_harness_infers_endpoint_side_from_spline_direction | passed | 1.400 | 0.575 | 1.974 |  |
| 124 | test_wire_harness_routes_render_as_scene_solids | passed | 7.017 | 0.660 | 7.677 |  |
| 125 | test_wire_harness_route_results_persist_in_model_json | passed | 0.843 | 0.559 | 1.402 |  |
| 126 | test_sketch_openLoop | passed | 0.946 | 0.719 | 1.665 |  |
| 127 | test_sketch_face_attachment_alignment | passed | 167.771 | 1.970 | 169.741 |  |
| 128 | test_sketch_solver_topology_rect_shared_points | passed | 9.055 | 1.319 | 10.375 |  |
| 129 | test_sketch_solver_topology_coincident_chain | passed | 15.322 | 0.706 | 16.028 |  |
| 130 | test_sketch_solver_topology_coincident_loop_no_flip | passed | 13.535 | 2.804 | 16.339 |  |
| 131 | test_sketch_solver_topology_rect_round_trip_sequence | passed | 17.186 | 0.701 | 17.887 |  |
| 132 | test_sketch_solver_topology_coincident_chain_multi_step | passed | 30.666 | 0.666 | 31.331 |  |
| 133 | test_sketch_solver_distance_slide_large_drop_settles_single_solve | passed | 1.155 | 0.555 | 1.710 |  |
| 134 | test_sketch_solver_line_to_point_distance_constraint | passed | 2.954 | 0.535 | 3.489 |  |
| 135 | test_extrude_negative_distance_cap_alignment | passed | 4.220 | 1.732 | 5.953 |  |
| 136 | test_extrude_intersect_coplanar_face_merge | passed | 1454.402 | 22.165 | 1476.567 |  |
| 137 | test_ExtrudeFace | passed | 29.006 | 3.261 | 32.267 |  |
| 138 | test_Fillet | passed | 347.798 | 35.323 | 383.121 |  |
| 139 | test_fillet_angle | passed | 11.047 | 3.273 | 14.320 |  |
| 140 | test_fillet_corner_bridge | passed | 48.942 | 5.015 | 53.957 |  |
| 141 | test_fillet_edge_degenerate_segment | passed | 1638.723 | 48.708 | 1687.430 |  |
| 142 | test_sketch_profile_tolerant_loop_join | passed | 1358.032 | 8.285 | 1366.317 |  |
| 143 | test_fillet_compound_snapshot_resolution | passed | 1756.630 | 14.963 | 1771.593 |  |
| 144 | test_fillet_generated_history_20260321144106 | passed | 5291.783 | 153.604 | 5445.386 |  |
| 145 | test_generated_history_20260322220620 | passed | 11140.122 | 209.349 | 11349.471 |  |
| 146 | test_generated_history_20260322222832 | passed | 75.839 | 9.653 | 85.493 |  |
| 147 | test_generated_history_20260418030116 | passed | 1304.145 | 48.001 | 1352.146 |  |
| 148 | test_generated_history_20260427005357 | passed | 2493.544 | 56.879 | 2550.423 |  |
| 149 | test_generated_history_20260427005357_three_face_thicken | passed | 349.343 | 45.851 | 395.194 |  |
| 150 | test_generated_history_20260427005357_nine_face_thicken | passed | 2453.177 | 45.288 | 2498.466 |  |
| 151 | test_generated_history_20260523000414 | passed | 1598.847 | 78.759 | 1677.606 |  |
| 152 | test_generated_history_20260531201126 | passed | 189.186 | 13.499 | 202.685 |  |
| 153 | test_fillet_preserves_original_face_names | passed | 630.522 | 22.356 | 652.878 |  |
| 154 | test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild | passed | 625.645 | 24.516 | 650.161 |  |
| 155 | test_Fillet_NonClosed | passed | 15.671 | 2.809 | 18.480 |  |
| 156 | test_fillets_more_dificult | passed | 2834.380 | 149.335 | 2983.715 |  |
| 157 | test_Chamfer | passed | 6.506 | 1.515 | 8.021 |  |
| 158 | test_cppChamfer_single_edge_builds_native_named_tool_and_result | passed | 4.315 | 1.320 | 5.635 |  |
| 159 | test_cppChamfer_auto_direction_uses_native_classifier | passed | 4.288 | 0.781 | 5.069 |  |
| 160 | test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting | passed | 155.602 | 10.805 | 166.407 |  |
| 161 | test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps | failed | 280.877 | 0.000 | 280.877 | Expected native chamfer workflow to add at least one tangent cap bridge; received 0. |

Pending tests:
162. test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane
163. test_cppChamfer_debug_emits_cross_section_face_per_sample
164. test_cppChamfer_debug_sections_materialize_as_sketch_profiles
165. test_edge_smooth_curve_fit
166. test_edge_smooth_curve_fit_closed_loop
167. test_edge_smooth_constraints_prevent_triangle_foldback
168. test_edge_smooth_closed_loop_feature_selection
169. test_edge_smooth_whole_solid_selection
170. test_edge_smooth_face_selection
171. test_smooth_with_subdivision_replaces_source_solid
172. test_smooth_with_subdivision_preserves_centered_ring_symmetry
173. test_smooth_with_subdivision_preserves_mirrored_union_symmetry
174. test_hole_through
175. test_hole_countersink
176. test_hole_counterbore
177. test_hole_multi_point_cloned_cutter
178. test_hole_thread_symbolic
179. test_hole_thread_modeled
180. test_pushFace_feature
181. test_pushFace
182. test_mirror
183. test_history_features_basic
184. test_history_expand_does_not_dirty
185. test_selection_owning_feature_resolution
186. test_solid_overlap_diagnostics_detects_coplanar_overlap
187. test_solid_overlap_diagnostics_ignores_boundary_touching_faces
188. test_solid_overlap_diagnostics_detects_cross_solid_overlap
189. test_boolean_overlap_conditioning_union_enabled_by_default
190. test_boolean_overlap_conditioning_union_can_be_disabled
191. test_boolean_overlap_conditioning_subtract_enabled_by_default
192. test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward
193. test_boolean_overlap_conditioning_subtract_can_be_disabled
194. test_boolean_overlap_conditioning_direct_api_enabled_by_default
195. test_boolean_overlap_conditioning_direct_api_can_be_disabled
196. test_visibility_hidden_state_persistence
197. test_sketch_feature_scene_visibility
198. test_textToFace
199. test_sheetMetal_nonManifold_sm_f18
200. test_sheetMetal_tab_circular_hole_wall
201. test_sheetMetal_bend_face_cylindrical_metadata
202. test_sheetMetal_cutout_context_button
203. test_sheetMetal_contour_flange_context_button_prefers_sketch
204. test_sheetMetal_contour_flange_whole_sketch_selection
205. test_sheetMetal_cutoutEdge_flange_controls
206. test_sheetMetal_corner_fillet
207. test_sheetMetal_corner_fillet_face_cylindrical_metadata
208. test_sheetMetal_corner_fillet_selection_resolution
209. test_sheetMetal_corner_fillet_compound_reference
210. test_solidPointMinGap
211. test_solidMetrics
212. import_part_badBoolean
213. import_part_extrudeTest
214. import_part_filletFail
215. import_part_fillet_angle_test.BREP
216. import_part_fillet_test.BREP
217. import_part_import_TEst.part.part
218. import_part_medium_fillets.BREP
219. import_part_sketch_throttel_testing.BREP
220. import_part_slowsketch
221. test_sketch_solver_fixture_coincident_chain_fixture
222. test_sketch_solver_fixture_rect_width_height_fixture
223. test_sketch_solver_fixture_sketch_throttel_expression_sequence_fixture
