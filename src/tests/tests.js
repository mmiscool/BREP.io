import { generate3MF } from '../exporters/threeMF.js';
import { fs } from '../fs.proxy.js';
import { PartHistory } from "../PartHistory.js";
import { posix as path } from '../path.proxy.js';
import { registerSketchSolverTopologyFixtureTests } from './sketchSolverTopologyFixtureLoader.js';
import { test_boolean_subtract } from './test_boolean_subtract.js';
import {
    afterRun_boolean_operation_target_name_preserved,
    test_boolean_operation_target_name_preserved,
} from './test_boolean_operation_target_name.js';
import { test_boolean_face_metadata_preserved } from './test_boolean_face_metadata_preserved.js';
import {
    test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward,
    test_boolean_overlap_conditioning_subtract_can_be_disabled,
    test_boolean_overlap_conditioning_subtract_enabled_by_default,
    test_boolean_overlap_conditioning_union_can_be_disabled,
    test_boolean_overlap_conditioning_union_enabled_by_default,
} from './test_boolean_overlap_conditioning.js';
import { test_Chamfer } from './test_chamfer.js';
import {
    test_cppChamfer_auto_direction_uses_native_classifier,
    test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps,
    test_cppChamfer_debug_emits_cross_section_face_per_sample,
    test_cppChamfer_debug_sections_materialize_as_sketch_profiles,
    test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane,
    test_cppChamfer_single_edge_builds_native_named_tool_and_result,
    test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting,
} from './test_cppChamfer.js';
import {
    test_edge_smooth_constraints_prevent_triangle_foldback,
    test_edge_smooth_curve_fit,
    test_edge_smooth_curve_fit_closed_loop,
    test_edge_smooth_face_selection,
    test_edge_smooth_whole_solid_selection,
} from './test_edge_smooth_curve_fit.js';
import {
    afterRun_extrude_negative_distance_cap_alignment,
    test_extrude_negative_distance_cap_alignment,
} from './test_extrude_negative_distance.js';
import {
    afterRun_extrude_intersect_coplanar_face_merge,
    test_extrude_intersect_coplanar_face_merge,
} from './test_extrude_intersect_coplanar_face_merge.js';
import { test_face_source_feature_seed } from './test_face_source_feature_seed.js';
import { test_ExtrudeFace } from './test_extrudeFace.js';
import { test_Fillet } from './test_fillet.js';
import { afterRun_fillet_angle, test_fillet_angle } from './test_fillet_angle.js';
import {
    afterRun_fillet_edge_degenerate_segment,
    test_fillet_edge_degenerate_segment,
} from './test_fillet_edge_degenerate_segment.js';
import {
    afterRun_sketch_profile_tolerant_loop_join,
    test_sketch_profile_tolerant_loop_join,
} from './test_sketch_profile_tolerant_loop_join.js';
import {
    afterRun_fillet_compound_snapshot_resolution,
    test_fillet_compound_snapshot_resolution,
} from './test_fillet_compound_snapshot_resolution.js';
import {
    afterRun_fillet_generated_history_20260321144106,
    test_fillet_generated_history_20260321144106,
} from './test_fillet_generated_history_20260321144106.js';
import {
    afterRun_generated_history_20260322220620,
    test_generated_history_20260322220620,
} from './test_generated_history_20260322220620.js';
import {
    afterRun_generated_history_20260322222832,
    test_generated_history_20260322222832,
} from './test_generated_history_20260322222832.js';
import {
    afterRun_generated_history_20260418030116,
    test_generated_history_20260418030116,
} from './test_generated_history_20260418030116.js';
import {
    afterRun_fillet_preserves_original_face_names,
    test_fillet_preserves_original_face_names,
} from './test_fillet_preserves_original_face_names.js';
import {
    afterRun_fillet_corner_bridge,
    test_fillet_corner_bridge,
} from './test_fillet_corner_bridge.js';
import { afterRun_Fillet_NonClosed, test_Fillet_NonClosed } from './test_fillet_nonClosed.js';
import { test_fillets_more_dificult } from './test_filletsMoreDifficult.js';
import { afterRun_history_expand_does_not_dirty, test_history_expand_does_not_dirty } from './test_history_expand_does_not_dirty.js';
import { afterRun_history_features_basic, test_history_features_basic } from './test_history_features_basic.js';
import {
    afterRun_hole_counterbore,
    afterRun_hole_countersink,
    afterRun_hole_thread_modeled,
    afterRun_hole_thread_symbolic,
    afterRun_hole_through,
    test_hole_counterbore,
    test_hole_countersink,
    test_hole_thread_modeled,
    test_hole_thread_symbolic,
    test_hole_through,
} from './test_hole.js';
import {
    afterRun_import3d_decimation_100_restores_original_geometry,
    afterRun_import3d_decimation_preserves_source_snapshot_without_json_clone,
    afterRun_import3d_decimation_reapplies_from_cached_source_mesh,
    afterRun_import3d_decimation_reduces_triangle_count,
    afterRun_import3d_decimation_seeds_source_snapshot_for_legacy_cache,
    test_import3d_decimation_100_restores_original_geometry,
    test_import3d_decimation_preserves_source_snapshot_without_json_clone,
    test_import3d_decimation_reapplies_from_cached_source_mesh,
    test_import3d_decimation_reduces_triangle_count,
    test_import3d_decimation_seeds_source_snapshot_for_legacy_cache,
} from './test_import3dDecimation.js';
import {
    afterRun_import3d_extract_multiple_solids_toggle,
    test_import3d_extract_multiple_solids_toggle,
} from './test_import3dMultipleSolids.js';
import {
    afterRun_import3d_planar_extraction_merges_sliver_bridge,
    test_import3d_planar_extraction_merges_sliver_bridge,
} from './test_import3dPlanarExtraction.js';
import { test_mirror } from './test_mirror.js';
import {
    afterRun_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild,
    test_cppNative_prepareManifoldMesh_matches_legacy_js_reference,
    test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild,
} from './test_cppFaceNamingRegression.js';
import { test_configurator_expressions } from './test_configuratorExpressions.js';
import {
    test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh,
    test_cppSolidCore_offsetFace_moves_vertices_for_face,
    test_cppSolidCore_preserves_face_ids_and_metadata,
    test_cppSolidCore_prepareManifoldMesh_repairs_orientation,
    test_cppSolidCore_pushFace_moves_vertices_for_face,
    test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells,
    test_cppSolidCore_setAuthoringState_and_bakeTransform,
    test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads,
    test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers,
    test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance,
} from './test_cppSolidCore.js';
import {
    test_cppSolidBakeTransform_updates_solid_authoring_state,
    test_cppSolidMirror_preserves_face_metadata,
} from './test_cppSolidBakeTransform.js';
import {
    test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata,
    test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon,
    test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots,
    test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata,
    test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata,
    test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices,
    test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset,
    test_cppSolidNative_getFaceNormal_reports_planar_face_normal,
    test_cppSolidNative_invertNormals_and_manifoldize_rebuilds_coherent_mesh,
    test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face,
    test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor,
    test_cppSolidNative_offsetFace_updates_planar_face_vertices,
    test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps,
    test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge,
    test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary,
    test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls,
    test_cppSolidNative_pushFace_updates_planar_face_vertices,
    test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell,
    test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata,
    test_cppSolidNative_setEpsilon_welds_vertices,
    test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold,
} from './test_cppSolidNativeOps.js';
import {
    test_cppTube_closed_hollow_tube_preserves_expected_face_labels,
    test_cppTube_native_auto_falls_back_to_slow_on_foldback_path,
    test_cppTube_native_builder_reports_selected_build_mode,
    test_cppTube_open_tube_preserves_expected_face_labels,
    test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots,
} from './test_cppTube.js';
import {
    test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata,
    test_cppPrimitive_cube_preserves_expected_face_labels,
    test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata,
    test_cppPrimitive_sphere_preserves_single_face_label,
    test_cppPrimitive_torus_and_pyramid_preserve_face_labels,
} from './test_cppPrimitives.js';
import { test_manifoldPlus_sum } from './test_manifoldPlus.js';
import {
    afterRun_offsetFace_preserves_individual_edges,
    test_offsetFace_preserves_individual_edges,
} from './test_offsetFace_preserves_individual_edges.js';
import {
    afterRun_thicken_feature_multiple_faces_produce_multiple_solids,
    afterRun_thicken_feature_serializes_and_replays_planar_profile,
    test_face_thicken_curved_cylinder_side,
    test_face_thicken_hole_profile,
    test_face_thicken_planar_profile,
    test_face_thicken_self_overlap_cylinder_side,
    test_thicken_feature_multiple_faces_produce_multiple_solids,
    test_thicken_feature_serializes_and_replays_planar_profile,
} from './test_thickenFeature.js';
import {
    test_offsetShell_polyhedral_exact_preserves_sharp_cube_faces,
    test_offsetShell_polyhedral_exact_supports_non_convex_planar_solids,
    test_offsetShell_generic_mesh_face_uses_tangent_supports,
    test_offsetShell_support_surfaces_handle_cylinder_and_cone,
    test_offsetShell_support_surfaces_handle_sphere_and_torus,
    afterRun_offsetShell_repro_20260423023524_keeps_negative_open_face_shell_with_union_boss,
    afterRun_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source,
    afterRun_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward,
    test_offsetShell_vertex_tangent_normals_preserve_generic_sphere_inset_direction,
    afterRun_offsetShell_repro_20260422215549_can_keep_original_solid,
    afterRun_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face,
    test_offsetShell_repro_20260423023524_keeps_negative_open_face_shell_with_union_boss,
    test_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source,
    test_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward,
    test_offsetShell_repro_20260422215549_can_keep_original_solid,
    test_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face,
} from './test_offsetShellPolyhedralExact.js';
import { test_plane } from './test_plane.js';
import { test_primitiveCone } from './test_primitiveCone.js';
import { test_primitiveCube } from './test_primitiveCube.js';
import { test_primitiveCylinder } from './test_primitiveCylinder.js';
import { test_primitivePyramid } from './test_primitivePyramid.js';
import { test_primitiveSphere } from './test_primitiveSphere.js';
import { test_primitiveTorus } from './test_primitiveTorus.js';
import { afterRun_pushFace_feature, test_pushFace_feature } from './test_pushFace_feature.js';
import { afterRun_pushFace, test_pushFace } from './test_pushFace.js';
import { test_sheetMetal_corner_fillet } from './test_sheetMetal_corner_fillet.js';
import { test_sheetMetal_corner_fillet_face_cylindrical_metadata } from './test_sheetMetal_corner_fillet_face_cylindrical_metadata.js';
import { test_sheetMetal_bend_face_cylindrical_metadata } from './test_sheetMetal_bend_face_cylindrical_metadata.js';
import { test_sheet_clipboard_image_utils } from './test_sheetClipboardImageUtils.js';
import { test_sheetMetal_corner_fillet_compound_reference } from './test_sheetMetal_corner_fillet_compound_reference.js';
import { test_sheetMetal_corner_fillet_selection_resolution } from './test_sheetMetal_corner_fillet_selection_resolution.js';
import { test_sheetMetal_cutout_context_button } from './test_sheetMetal_cutout_context_button.js';
import { test_sheetMetal_cutoutEdge_flange_controls } from './test_sheetMetal_cutoutEdge_flange_controls.js';
import { test_sheetMetal_nonManifold_sm_f18 } from './test_sheetMetal_nonManifold_sm_f18.js';
import { afterRun_sketch_openLoop, test_sketch_openLoop } from './test_sketch_openLoop.js';
import {
    afterRun_sketch_face_attachment_alignment,
    test_sketch_face_attachment_alignment,
} from './test_sketch_face_attachment_alignment.js';
import {
    test_sketch_solver_distance_slide_large_drop_settles_single_solve,
    test_sketch_solver_line_to_point_distance_constraint,
    test_sketch_solver_topology_coincident_chain,
    test_sketch_solver_topology_coincident_chain_multi_step,
    test_sketch_solver_topology_coincident_loop_no_flip,
    test_sketch_solver_topology_rect_round_trip_sequence,
    test_sketch_solver_topology_rect_shared_points,
} from './test_sketch_solver_topology_stability.js';
import { afterRun_solidMetrics, test_solidMetrics } from './test_solidMetrics.js';
import { test_stlLoader } from './test_stlLoader.js';
import { test_selection_owning_feature_resolution } from './test_selection_owning_feature.js';
import {
    test_solid_overlap_diagnostics_detects_cross_solid_overlap,
    test_solid_overlap_diagnostics_detects_coplanar_overlap,
    test_solid_overlap_diagnostics_ignores_boundary_touching_faces,
} from './test_solid_overlap_diagnostics.js';
import {
    afterRun_smooth_with_subdivision_preserves_mirrored_union_symmetry,
    afterRun_smooth_with_subdivision_preserves_centered_ring_symmetry,
    afterRun_smooth_with_subdivision_replaces_source_solid,
    test_smooth_with_subdivision_preserves_mirrored_union_symmetry,
    test_smooth_with_subdivision_preserves_centered_ring_symmetry,
    test_smooth_with_subdivision_replaces_source_solid,
} from './test_smooth_with_subdivision.js';
import {
    afterRun_sweepFace_pathAlign_multi_loop_islands,
    test_SweepFace,
    test_SweepFace_pathAlign_multi_loop_islands,
} from './test_sweepFace.js';
import { afterRun_textToFace, test_textToFace } from './test_textToFace.js';
import { test_tube } from './test_tube.js';
import { test_tube_closedLoop } from './test_tube_closedLoop.js';
import { test_wire_harness_formboard_reuses_only_formboard_sheet } from './test_wireHarnessConnectionsWidget.js';
import { test_wire_harness_connection_endpoint_resolution } from './test_wireHarnessConnectionEndpoints.js';
import {
    test_sheet_custom_size_persists,
    test_wire_harness_formboard_insert,
} from './test_wireHarnessFormboard.js';
import {
    test_pmi_view_text_size_setting_normalizes,
    test_pmi_view_visibility_state_normalizes,
} from './test_pmiViewsManager.js';
import {
    afterRun_pmi_view_visibility_state_round_trip,
    test_pmi_view_visibility_state_round_trip,
} from './test_pmiViewVisibilityState.js';
import {
    test_pmi_enter_edit_mode_reuses_shared_flow,
    test_pmi_effective_visibility_respects_hidden_ancestor,
    test_pmi_export_render_context_applies_visibility_state,
    test_pmi_monochrome_label_layout_is_tighter_than_shaded,
    test_pmi_monochrome_label_svg_uses_backdrop_color,
} from './test_pmiViewsWidget.js';
import {
    test_feature_dimension_overlay_supports_port,
    test_port_extension_annotation_geometry_preserves_extension_value,
} from './test_featureDimensionOverlay.js';
import {
    test_port_definition_uses_transform_reference_and_direction_reference,
    test_port_definition_uses_transform_reference_without_anchor,
    test_referenced_transform_matrix_uses_vertex_reference_origin,
    test_transform_reference_base_uses_face_pick_point,
    test_transform_reference_sanitize_preserves_metadata,
} from './test_transformReferenceUtils.js';
import { test_wire_harness_sheet_table_insert } from './test_wireHarnessSheetTable.js';
import {
    test_wire_harness_infers_endpoint_side_from_spline_direction,
} from './test_wireHarnessRoutingReuse.js';
import { test_wire_harness_routes_render_as_scene_solids } from './test_wireHarnessRouteGeometry.js';
import { test_wire_harness_route_results_persist_in_model_json } from './test_wireHarnessPersistence.js';
import {
    afterRun_visibility_hidden_state_persistence,
    test_visibility_hidden_state_persistence,
} from './test_visibility_hidden_state_persistence.js';
import { test_sketch_feature_scene_visibility } from './test_sketchFeatureVisibility.js';
import { test_revolve_feature_resolves_face_and_edge_string_references } from './test_revolveFeature.js';
import { test_remesh_simplify_welds_by_tolerance_before_simplify } from './test_remeshFeature.js';
import { test_revolve_after_union_preserves_face_reference_resolution } from './test_revolve_after_union_face_reference.js';
import {
    afterRun_primitive_boolean_union_preserves_face_grouping,
    test_primitive_boolean_union_preserves_face_grouping,
} from './test_primitive_boolean_face_grouping.js';

const IS_NODE_RUNTIME = typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined';
const TEST_LOG_PATH = path.join('tests', 'test-run.log');


export const testFunctions = [
    { test: test_cppNative_prepareManifoldMesh_matches_legacy_js_reference, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_preserves_face_ids_and_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_setAuthoringState_and_bakeTransform, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_pushFace_moves_vertices_for_face, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_offsetFace_moves_vertices_for_face, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_prepareManifoldMesh_repairs_orientation, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidBakeTransform_updates_solid_authoring_state, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidMirror_preserves_face_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_revolve_feature_resolves_face_and_edge_string_references, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_remesh_simplify_welds_by_tolerance_before_simplify, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_revolve_after_union_preserves_face_reference_resolution, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_setEpsilon_welds_vertices, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_pushFace_updates_planar_face_vertices, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_getFaceNormal_reports_planar_face_normal, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_offsetFace_updates_planar_face_vertices, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_invertNormals_and_manifoldize_rebuilds_coherent_mesh, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppTube_open_tube_preserves_expected_face_labels, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppTube_closed_hollow_tube_preserves_expected_face_labels, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppTube_native_builder_reports_selected_build_mode, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppTube_native_auto_falls_back_to_slow_on_foldback_path, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppPrimitive_cube_preserves_expected_face_labels, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppPrimitive_torus_and_pyramid_preserve_face_labels, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppPrimitive_sphere_preserves_single_face_label, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_configurator_expressions, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_manifoldPlus_sum, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_plane, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_primitiveCube, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_primitivePyramid, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_primitiveCylinder, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_face_source_feature_seed, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_offsetFace_preserves_individual_edges,
        afterRun: afterRun_offsetFace_preserves_individual_edges,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    { test: test_face_thicken_planar_profile, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_face_thicken_hole_profile, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_face_thicken_curved_cylinder_side, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_face_thicken_self_overlap_cylinder_side, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_thicken_feature_serializes_and_replays_planar_profile,
        afterRun: afterRun_thicken_feature_serializes_and_replays_planar_profile,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_thicken_feature_multiple_faces_produce_multiple_solids,
        afterRun: afterRun_thicken_feature_multiple_faces_produce_multiple_solids,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    { test: test_primitiveCone, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_primitiveTorus, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_primitiveSphere, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_feature_dimension_overlay_supports_port, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_port_extension_annotation_geometry_preserves_extension_value, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_transform_reference_sanitize_preserves_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_transform_reference_base_uses_face_pick_point, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_referenced_transform_matrix_uses_vertex_reference_origin, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_port_definition_uses_transform_reference_without_anchor, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_port_definition_uses_transform_reference_and_direction_reference, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_subtract, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_boolean_face_metadata_preserved, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_primitive_boolean_union_preserves_face_grouping,
        afterRun: afterRun_primitive_boolean_union_preserves_face_grouping,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_boolean_operation_target_name_preserved,
        afterRun: afterRun_boolean_operation_target_name_preserved,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    { test: test_stlLoader, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    {
        test: test_import3d_decimation_reduces_triangle_count,
        afterRun: afterRun_import3d_decimation_reduces_triangle_count,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_decimation_reapplies_from_cached_source_mesh,
        afterRun: afterRun_import3d_decimation_reapplies_from_cached_source_mesh,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_decimation_100_restores_original_geometry,
        afterRun: afterRun_import3d_decimation_100_restores_original_geometry,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_decimation_seeds_source_snapshot_for_legacy_cache,
        afterRun: afterRun_import3d_decimation_seeds_source_snapshot_for_legacy_cache,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_decimation_preserves_source_snapshot_without_json_clone,
        afterRun: afterRun_import3d_decimation_preserves_source_snapshot_without_json_clone,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_planar_extraction_merges_sliver_bridge,
        afterRun: afterRun_import3d_planar_extraction_merges_sliver_bridge,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_import3d_extract_multiple_solids_toggle,
        afterRun: afterRun_import3d_extract_multiple_solids_toggle,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    { test: test_SweepFace, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    {
        test: test_SweepFace_pathAlign_multi_loop_islands,
        afterRun: afterRun_sweepFace_pathAlign_multi_loop_islands,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    { test: test_tube, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_tube_closedLoop, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_wire_harness_formboard_reuses_only_formboard_sheet, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_connection_endpoint_resolution, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheet_custom_size_persists, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_view_text_size_setting_normalizes, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_view_visibility_state_normalizes, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_view_visibility_state_round_trip, afterRun: afterRun_pmi_view_visibility_state_round_trip, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_monochrome_label_svg_uses_backdrop_color, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_monochrome_label_layout_is_tighter_than_shaded, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_enter_edit_mode_reuses_shared_flow, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_export_render_context_applies_visibility_state, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_pmi_effective_visibility_respects_hidden_ancestor, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheet_clipboard_image_utils, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_formboard_insert, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_sheet_table_insert, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_infers_endpoint_side_from_spline_direction, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_routes_render_as_scene_solids, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_wire_harness_route_results_persist_in_model_json, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_openLoop, afterRun: afterRun_sketch_openLoop, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_sketch_face_attachment_alignment,
        afterRun: afterRun_sketch_face_attachment_alignment,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    { test: test_sketch_solver_topology_rect_shared_points, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_topology_coincident_chain, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_topology_coincident_loop_no_flip, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_topology_rect_round_trip_sequence, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_topology_coincident_chain_multi_step, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_distance_slide_large_drop_settles_single_solve, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_solver_line_to_point_distance_constraint, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_polyhedral_exact_preserves_sharp_cube_faces, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_vertex_tangent_normals_preserve_generic_sphere_inset_direction, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_polyhedral_exact_supports_non_convex_planar_solids, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_support_surfaces_handle_cylinder_and_cone, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_support_surfaces_handle_sphere_and_torus, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_offsetShell_generic_mesh_face_uses_tangent_supports, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face,
        afterRun: afterRun_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_offsetShell_repro_20260422215549_can_keep_original_solid,
        afterRun: afterRun_offsetShell_repro_20260422215549_can_keep_original_solid,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source,
        afterRun: afterRun_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward,
        afterRun: afterRun_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_offsetShell_repro_20260423023524_keeps_negative_open_face_shell_with_union_boss,
        afterRun: afterRun_offsetShell_repro_20260423023524_keeps_negative_open_face_shell_with_union_boss,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_extrude_negative_distance_cap_alignment,
        afterRun: afterRun_extrude_negative_distance_cap_alignment,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_extrude_intersect_coplanar_face_merge,
        afterRun: afterRun_extrude_intersect_coplanar_face_merge,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    { test: test_ExtrudeFace, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_Fillet, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_fillet_angle, afterRun: afterRun_fillet_angle, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    {
        test: test_fillet_corner_bridge,
        afterRun: afterRun_fillet_corner_bridge,
        printArtifacts: false,
        exportFaces: true,
        exportSolids: true,
        resetHistory: true,
    },
    {
        test: test_fillet_edge_degenerate_segment,
        afterRun: afterRun_fillet_edge_degenerate_segment,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_sketch_profile_tolerant_loop_join,
        afterRun: afterRun_sketch_profile_tolerant_loop_join,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_fillet_compound_snapshot_resolution,
        afterRun: afterRun_fillet_compound_snapshot_resolution,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_fillet_generated_history_20260321144106,
        afterRun: afterRun_fillet_generated_history_20260321144106,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_generated_history_20260322220620,
        afterRun: afterRun_generated_history_20260322220620,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_generated_history_20260322222832,
        afterRun: afterRun_generated_history_20260322222832,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_generated_history_20260418030116,
        afterRun: afterRun_generated_history_20260418030116,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_fillet_preserves_original_face_names,
        afterRun: afterRun_fillet_preserves_original_face_names,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    {
        test: test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild,
        afterRun: afterRun_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild,
        printArtifacts: false,
        exportFaces: false,
        exportSolids: false,
        resetHistory: true,
    },
    { test: test_Fillet_NonClosed, afterRun: afterRun_Fillet_NonClosed, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_fillets_more_dificult, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_Chamfer, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_cppChamfer_single_edge_builds_native_named_tool_and_result, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_auto_direction_uses_native_classifier, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_debug_emits_cross_section_face_per_sample, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_cppChamfer_debug_sections_materialize_as_sketch_profiles, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_edge_smooth_curve_fit, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_edge_smooth_curve_fit_closed_loop, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_edge_smooth_constraints_prevent_triangle_foldback, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_edge_smooth_whole_solid_selection, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_edge_smooth_face_selection, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_smooth_with_subdivision_replaces_source_solid, afterRun: afterRun_smooth_with_subdivision_replaces_source_solid, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_smooth_with_subdivision_preserves_centered_ring_symmetry, afterRun: afterRun_smooth_with_subdivision_preserves_centered_ring_symmetry, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_smooth_with_subdivision_preserves_mirrored_union_symmetry, afterRun: afterRun_smooth_with_subdivision_preserves_mirrored_union_symmetry, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_hole_through, afterRun: afterRun_hole_through, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_hole_countersink, afterRun: afterRun_hole_countersink, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_hole_counterbore, afterRun: afterRun_hole_counterbore, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_hole_thread_symbolic, afterRun: afterRun_hole_thread_symbolic, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_hole_thread_modeled, afterRun: afterRun_hole_thread_modeled, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_pushFace_feature, afterRun: afterRun_pushFace_feature, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_pushFace, afterRun: afterRun_pushFace, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_mirror, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_history_features_basic, afterRun: afterRun_history_features_basic, printArtifacts: false, exportFaces: true, exportSolids: true, resetHistory: true },
    { test: test_history_expand_does_not_dirty, afterRun: afterRun_history_expand_does_not_dirty, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_selection_owning_feature_resolution, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_solid_overlap_diagnostics_detects_coplanar_overlap, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_solid_overlap_diagnostics_ignores_boundary_touching_faces, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_solid_overlap_diagnostics_detects_cross_solid_overlap, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_overlap_conditioning_union_enabled_by_default, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_overlap_conditioning_union_can_be_disabled, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_overlap_conditioning_subtract_enabled_by_default, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_boolean_overlap_conditioning_subtract_can_be_disabled, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_visibility_hidden_state_persistence, afterRun: afterRun_visibility_hidden_state_persistence, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sketch_feature_scene_visibility, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_textToFace, afterRun: afterRun_textToFace, printArtifacts: false, exportFaces: true, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_nonManifold_sm_f18, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_bend_face_cylindrical_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_cutout_context_button, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_cutoutEdge_flange_controls, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_corner_fillet, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_corner_fillet_face_cylindrical_metadata, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_corner_fillet_selection_resolution, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_sheetMetal_corner_fillet_compound_reference, printArtifacts: false, exportFaces: false, exportSolids: false, resetHistory: true },
    { test: test_solidMetrics, afterRun: afterRun_solidMetrics, printArtifacts: true, exportFaces: true, exportSolids: true, resetHistory: true },

];

// Dynamically register tests to import part files from src/tests/partFiles (Node only)
async function registerPartFileTests() {
    if (!(typeof process !== 'undefined' && process.versions && process.versions.node)) return;
    try {
        const partsDir = 'src/tests/partFiles';
        // Use async API to avoid ESM sync-fs readiness issues
        try {
            const entries = await fs.promises.readdir(partsDir);
            const files = entries.filter(f => typeof f === 'string' && f.toLowerCase().endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(partsDir, file);
                const baseName = String(file).replace(/\.[^.]+$/, '');
                const safeName = baseName.replace(/[^a-zA-Z0-9._-]+/g, '_').substring(0, 100);
                const testName = `import_part_${safeName}`;

                const importTest = async function (partHistory) {
                    // Read file and load into PartHistory
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    let payload = content;
                    try {
                        const obj = JSON.parse(content);
                        if (obj && typeof obj === 'object') {
                            if (Array.isArray(obj.features)) {
                                payload = JSON.stringify(obj);
                            } else if (obj.data) {
                                payload = (typeof obj.data === 'string') ? obj.data : JSON.stringify(obj.data);
                            }
                        }
                    } catch (_) {
                        // invalid JSON; let runSingleTest catch and report when fromJSON or runHistory runs
                    }
                    await partHistory.reset();
                    await partHistory.fromJSON(payload);
                    // runHistory will be called by runSingleTest()
                };
                try { Object.defineProperty(importTest, 'name', { value: testName, configurable: true }); } catch {}

                testFunctions.push({
                    test: importTest,
                    afterRun: null,
                    printArtifacts: false,
                    exportFaces: true,
                    exportSolids: true,
                    resetHistory: true,
                    allowErrors: true,
                    _sourceFile: filePath,
                });
            }
        } catch {
            // Directory may not exist; ignore silently in CI
        }
    } catch (e) {
        console.warn('Failed to register part file import tests:', e?.message || e);
    }
}



// call runTests automatically when executed under Node.js
if (IS_NODE_RUNTIME) {
    runTests()
        .then(() => {
            // ensure CLI exits promptly once the suite finishes
            process.exit(0);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}




export async function runTests(partHistory = new PartHistory(), callbackToRunBetweenTests = null) {
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
        //await console.clear();
    }

    if (IS_NODE_RUNTIME) {
        resetTestLog();
        logTestEvent('Test run started');
    }

    // delete the ./tests/results directory in an asynchronous way
    await fs.promises.rm('./tests/results', { recursive: true, force: true });

    // Discover and register part-file import tests (Node only)
    await registerPartFileTests();
    // Discover and register sketch solver topology fixtures (Node only)
    await registerSketchSolverTopologyFixtureTests(testFunctions);

    for (const testFunction of testFunctions) {
        const isLastTest = testFunction === testFunctions[testFunctions.length - 1];
        await partHistory.reset();

        if (testFunction.resetHistory) partHistory.features = [];

        const testName = (testFunction?.test?.name && String(testFunction.test.name)) || 'unnamed_test';
        if (IS_NODE_RUNTIME) logTestEvent(`Starting ${testName}`);

        let handledError = null;
        try {
            handledError = await runSingleTest(testFunction, partHistory);
        } catch (err) {
            if (IS_NODE_RUNTIME) logTestEvent(`Test ${testName} failed: ${stringifyError(err)}`);
            throw err;
        }

        if (IS_NODE_RUNTIME) {
            if (handledError) logTestEvent(`Test ${testName} completed with handled error: ${stringifyError(handledError)}`);
            else logTestEvent(`Test ${testName} completed successfully`);
        }

        if (typeof window !== "undefined") {
            if (typeof callbackToRunBetweenTests === 'function') {
                await callbackToRunBetweenTests(partHistory, isLastTest);
            }
        } else {
            // run each test and export the results to a folder ./tests/results/<testFunction name>/
            const exportName = testFunction.test.name;
            const exportPath = `./tests/results/${exportName}/`;
            // create the directory if it does not exist
            if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
            }

            // Collect SOLID nodes from the scene
            const solids = (partHistory.scene?.children || []).filter(o => o && o.type === 'SOLID' && typeof o.toSTL === 'function');

            // Export solids (triggered by either flag for convenience)
            if (testFunction.exportSolids || testFunction.printArtifacts) {
                solids.forEach((solid, idx) => {
                    const rawName = solid.name && String(solid.name).trim().length ? String(solid.name) : `solid_${idx}`;
                    const safeName = sanitizeFileName(rawName);
                    let stl = "";
                    try {
                        stl = solid.toSTL(safeName, 6);
                    } catch (e) {
                        console.warn(`[runTests] toSTL failed for solid ${rawName}:`, e?.message || e);
                        return;
                    }
                    const outPath = path.join(exportPath, `${safeName}.stl`);
                    writeFile(outPath, stl);
                });
            }

            // Export faces per solid
            if (testFunction.exportFaces) {
                solids.forEach((solid, sidx) => {
                    const rawName = solid.name && String(solid.name).trim().length ? String(solid.name) : `solid_${sidx}`;
                    const safeSolid = sanitizeFileName(rawName);
                    let faces = [];
                    try {
                        faces = typeof solid.getFaces === 'function' ? solid.getFaces(false) : [];
                    } catch {
                        faces = [];
                    }
                    faces.forEach(({ faceName, triangles }, fIdx) => {
                        if (!triangles || triangles.length === 0) return;
                        const rawFace = faceName || `face_${fIdx}`;
                        const safeFace = sanitizeFileName(rawFace);
                        const stl = trianglesToAsciiSTL(`${safeSolid}_${safeFace}`, triangles);
                        const outPath = path.join(exportPath, `${safeSolid}_${safeFace}.stl`);
                        writeFile(outPath, stl);
                    });
                });
            }

            // Export 3MF with embedded feature history
            await export3mfArtifact({
                partHistory,
                exportName,
                exportPath,
                solids,
            });

        }
    }

    if (IS_NODE_RUNTIME) logTestEvent('Test run finished');
}










export async function runSingleTest(testFunction, partHistory = new PartHistory()) {
    let error = null;
    try {
        await testFunction.test(partHistory);
        await partHistory.runHistory();
        // Optional per-test post-run hook for validations/metrics
        if (typeof testFunction.afterRun === 'function') {
            try { await testFunction.afterRun(partHistory); } catch (e) { console.warn('afterRun failed:', e?.message || e); }
        }
    } catch (e) {
        error = e;
        if (testFunction.allowErrors) {
            const name = (testFunction.test && testFunction.test.name) ? testFunction.test.name : 'unnamed_test';
            const exportPath = `./tests/results/${name}/`;
            try { if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath, { recursive: true }); } catch {}
            const msg = `${e?.message || e}\n\n${e?.stack || ''}`;
            try { writeFile(path.join(exportPath, 'error.txt'), msg); } catch {}
            console.error(`Error in test ${name}:`, e);
        } else {
            // rethrow to fail fast for normal tests
            throw e;
        }
    }
    // sleep for 1 second to allow any async operations to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    return error;
}


// function to write a file. If the path dose not exist it should make the folders needed.  
function writeFile(filePath, content) {
    // imediatly return if running in the browser
    if (typeof window !== "undefined") {
        //console.warn(`writeFile is not supported in the browser.`);
        return;
    }

    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
        console.log(`Error writing file ${filePath}:`, error);
    }
}

function writeBinaryFile(filePath, content) {
    if (typeof window !== "undefined") {
        return;
    }
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content);
    } catch (error) {
        console.log(`Error writing file ${filePath}:`, error);
    }
}

function appendToFile(filePath, content) {
    if (!IS_NODE_RUNTIME) return;
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(filePath, content, 'utf8');
    } catch (error) {
        console.log(`Error appending file ${filePath}:`, error);
    }
}

function resetTestLog() {
    if (!IS_NODE_RUNTIME) return;
    writeFile(TEST_LOG_PATH, '');
}

function logTestEvent(message) {
    if (!IS_NODE_RUNTIME) return;
    const timestamp = new Date().toISOString();
    appendToFile(TEST_LOG_PATH, `[${timestamp}] ${message}\n`);
}

function stringifyError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    const message = err?.message || err?.toString?.() || 'Unknown error';
    return err?.stack ? `${message}\n${err.stack}` : message;
}

// ---------------- Local helpers for artifact export (Node only) ----------------

function sanitizeFileName(name) {
    return String(name)
        .replace(/[^a-zA-Z0-9._-]+/g, '_')      // collapse invalid chars
        .replace(/^_+|_+$/g, '')                 // trim leading/trailing underscores
        .substring(0, 100) || 'artifact';        // cap length
}

function trianglesToAsciiSTL(name, tris) {
    const fmt = (n) => Number.isFinite(n) ? (Math.abs(n) < 1e-18 ? '0' : n.toFixed(6)) : '0';
    const out = [];
    out.push(`solid ${name}`);
    for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const p0 = t.p1, p1 = t.p2, p2 = t.p3;
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        out.push(`  facet normal ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}`);
        out.push(`    outer loop`);
        out.push(`      vertex ${fmt(p0[0])} ${fmt(p0[1])} ${fmt(p0[2])}`);
        out.push(`      vertex ${fmt(p1[0])} ${fmt(p1[1])} ${fmt(p1[2])}`);
        out.push(`      vertex ${fmt(p2[0])} ${fmt(p2[1])} ${fmt(p2[2])}`);
        out.push(`    endloop`);
        out.push(`  endfacet`);
    }
    out.push(`endsolid ${name}`);
    return out.join('\n');
}

async function export3mfArtifact({ partHistory, exportName, exportPath, solids }) {
    let historyJson = null;
    try {
        const json = await partHistory?.toJSON?.();
        if (json) historyJson = (typeof json === 'string') ? json : JSON.stringify(json);
    } catch (e) {
        console.warn(`[runTests] Failed to serialize feature history for ${exportName}:`, e?.message || e);
    }

    const additionalFiles = historyJson ? { 'Metadata/featureHistory.json': historyJson } : undefined;
    const modelMetadata = historyJson ? { featureHistoryPath: '/Metadata/featureHistory.json' } : undefined;
    const metadataManager = partHistory?.metadataManager || null;

    const solidsForExport = [];
    (solids || []).forEach((s, idx) => {
        try {
            const mesh = s?.getMesh?.();
            const canExport = !!(mesh && mesh.vertProperties && mesh.triVerts);
            if (mesh && typeof mesh.delete === 'function') {
                try { mesh.delete(); } catch { }
            }
            if (canExport) {
                solidsForExport.push(s);
            } else {
                const name = sanitizeFileName(s?.name || `solid_${idx}`);
                console.warn(`[runTests] Skipping non-manifold solid for 3MF: ${name}`);
            }
        } catch {
            const name = sanitizeFileName(s?.name || `solid_${idx}`);
            console.warn(`[runTests] Skipping solid that failed to export for 3MF: ${name}`);
        }
    });

    const safeName = sanitizeFileName(exportName || 'partHistory');
    const outPath = path.join(exportPath, `${safeName}.3mf`);
    try {
        let data = null;
        try {
            data = await generate3MF(solidsForExport, {
                unit: 'millimeter',
                precision: 6,
                scale: 1,
                additionalFiles,
                modelMetadata,
                metadataManager,
            });
        } catch {
            data = await generate3MF([], {
                unit: 'millimeter',
                precision: 6,
                scale: 1,
                additionalFiles,
                modelMetadata,
                metadataManager,
            });
        }
        if (data && data.length) {
            writeBinaryFile(outPath, data);
        } else {
            console.warn(`[runTests] 3MF export returned empty payload for ${exportName}`);
        }
    } catch (e) {
        console.warn(`[runTests] 3MF export failed for ${exportName}:`, e?.message || e);
    }
}
