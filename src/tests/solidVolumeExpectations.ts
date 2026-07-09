// Captured expected final scene solid volumes for tests that leave SOLID objects.
// Numeric values are compared with the default tolerance in solidVolumeTestUtils.js.
export const solidVolumeExpectations = Object.freeze({
    test_generated_history_20260709065543: {
        solids: [
            {
                name: "HEIGHTMAP1",
                volume: 354861.4611679972
            }
        ]
    },
    test_generated_history_20260709065543_base_thickness: {
        solids: [
            {
                name: "HEIGHTMAP1",
                volume: 471117.3142639298
            }
        ]
    },
    import_part_badBoolean: {
        solids: [
            {
                name: "E2",
                volume: 55409.1919064193
            }
        ]
    },
    import_part_extrudeTest: {
        solids: [
            {
                name: "P.CU23",
                volume: 1075.54219247524
            }
        ]
    },
    import_part_filletFail: {
        solids: [
            {
                name: "P.CU1",
                volume: 991.214449159088
            }
        ]
    },
    "import_part_fillet_angle_test.BREP": {
        solids: [
            {
                name: "E2",
                volume: 389.677039630072
            }
        ]
    },
    "import_part_fillet_test.BREP": {
        solids: [
            {
                name: "E2",
                volume: 882.478457916123
            }
        ]
    },
    "import_part_import_TEst.part.part": {
        solids: [
            {
                name: "E9",
                volume: 14376.4829026854
            }
        ]
    },
    "import_part_medium_fillets.BREP": {
        solids: [
            {
                name: "E2",
                volume: 474.382989996613
            }
        ]
    },
    "import_part_sketch_throttel_testing.BREP": {
        solids: [
            {
                name: "E2",
                volume: 324108383.553907
            }
        ]
    },
    import_part_slowsketch: {
        solids: [
            {
                name: "E2",
                volume: 20924.6033971167
            }
        ]
    },
    test_Chamfer: {
        solids: [
            {
                name: "P.CU1",
                volume: 7675.99998855591
            }
        ]
    },
    test_ExtrudeFace: {
        solids: [
            {
                name: "P.CO1",
                volume: 196.61783126711
            }
        ]
    },
    test_Fillet: {
        solids: [
            {
                name: "P.CY1",
                volume: 776.351198668857
            }
        ]
    },
    test_Fillet_NonClosed: {
        solids: [
            {
                name: "P.CU1",
                volume: 999.450903221451
            }
        ]
    },
    test_SweepFace: {
        solids: [
            {
                name: "P.CO1",
                volume: 613.75918480029
            }
        ]
    },
    test_SweepFace_pathAlign_multi_loop_islands: {
        solids: [
            {
                name: "SW5",
                volume: 816
            }
        ]
    },
    test_boolean_operation_target_name_preserved: {
        solids: [
            {
                name: "P.CU1",
                volume: 1499.94996665064
            }
        ]
    },
    test_boolean_subtract: {
        solids: [
            {
                name: "P.CU2",
                volume: 78.393809756312
            }
        ]
    },
    test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps: {
        solids: [
            {
                name: "E3",
                volume: 1076.9545997228
            }
        ]
    },
    test_cppChamfer_debug_emits_cross_section_face_per_sample: {
        solids: [
            {
                name: "E3",
                volume: 1076.9545997228
            }
        ]
    },
    test_cppChamfer_debug_sections_materialize_as_sketch_profiles: {
        solids: [
            {
                name: "E3",
                volume: 1076.9545997228
            }
        ]
    },
    test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane: {
        solids: [
            {
                name: "E3",
                volume: 1076.9545997228
            }
        ]
    },
    test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting: {
        solids: [
            {
                name: "E3",
                volume: 1076.9545997228
            }
        ]
    },
    test_extrude_intersect_coplanar_face_merge: {
        solids: [
            {
                name: "E2",
                volume: 20826.6968545517
            }
        ]
    },
    test_extrude_negative_distance_cap_alignment: {
        solids: [
            {
                name: "E3",
                volume: 187.199996948242
            }
        ]
    },
    test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge: {
        solids: [
            {
                name: "E2",
                volume: 396
            }
        ]
    },
    test_extrude_solid_face_uses_boundary_edge_sidewalls: {
        solids: [
            {
                name: "FACE_EDGE_SRC",
                volume: 960
            },
            {
                name: "FACE_EDGE_EXTRUDE",
                volume: 480
            }
        ]
    },
    test_face_source_feature_seed: {
        solids: [
            {
                name: "P.CY1",
                volume: 780.361289074364
            }
        ]
    },
    test_face_thicken_curved_cylinder_side: {
        solids: [
            {
                name: "THICK_CURVED_SRC",
                volume: 225.831495266899
            }
        ]
    },
    test_face_thicken_filleted_planar_face_keeps_clean_boundaries: {
        solids: [
            {
                name: "THICK_FILLETED_SRC",
                volume: 188.708663833635
            }
        ]
    },
    test_face_thicken_partial_torus_side_avoids_internal_voids: {
        solids: [
            {
                name: "THICK_TORUS_SRC",
                volume: 1714.95519757024
            }
        ]
    },
    test_face_thicken_self_overlap_cylinder_side: {
        solids: [
            {
                name: "THICK_SELF_SRC",
                volume: 18.7286702260012
            }
        ]
    },
    test_fillet_angle: {
        solids: [
            {
                name: "E2",
                volume: 466.232926154228
            }
        ]
    },
    test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges: {
        solids: [
            {
                name: "E2",
                volume: 61528.0488276048
            }
        ]
    },
    test_fillet_compound_snapshot_resolution: {
        solids: [
            {
                name: "E2",
                volume: 20836.7471131568
            }
        ]
    },
    test_fillet_corner_bridge: {
        solids: [
            {
                name: "P.CU1",
                volume: 990.855613685888
            }
        ]
    },
    test_fillet_edge_degenerate_segment: {
        solids: [
            {
                name: "E2",
                volume: 891.411490057198
            }
        ]
    },
    test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild: {
        solids: [
            {
                name: "E2",
                volume: 474.382989996613
            }
        ]
    },
    test_fillet_generated_history_20260321144106: {
        solids: [
            {
                name: "P.CY1",
                volume: 7049.54869525842
            }
        ]
    },
    test_fillet_preserves_original_face_names: {
        solids: [
            {
                name: "E2",
                volume: 474.382989996613
            }
        ]
    },
    test_fillet_rebuild_re_resolves_stale_edge_object: {
        solids: [
            {
                name: "P.CU1",
                volume: 1397.65366893012
            }
        ]
    },
    test_fillets_more_dificult: {
        solids: [
            {
                name: "P.CO1",
                volume: 150.397994725017
            }
        ]
    },
    test_generated_history_20260322220620: {
        solids: [
            {
                name: "P.CY1",
                volume: 9803.68860086943
            }
        ]
    },
    test_generated_history_20260322222832: {
        solids: [
            {
                name: "P.CY1",
                volume: 3959.21058069459
            }
        ]
    },
    test_generated_history_20260418030116: {
        solids: [
            {
                name: "E2",
                volume: 20956.0205711902
            }
        ]
    },
    test_generated_history_20260427005357: {
        solids: [
            {
                name: "E3",
                volume: 57602.97682994
            },
            {
                name: "THK11_01_F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer",
                volume: 224.18325446148
            },
            {
                name: "THK11_02_E7_S5_G6_SW",
                volume: 777.11002023293
            },
            {
                name: "THK11_03_E3_S2_PROFILE_START",
                volume: 1318.29473993507
            },
            {
                name: "THK11_04_F4_FILLET_E3_S2_G8_SW_E3_S2_G9_SW_a386a4b0_2_TUBE_Outer",
                volume: 181.26138068895
            },
            {
                name: "THK11_05_E3_S2_G9_SW",
                volume: 1151.36765270539
            },
            {
                name: "THK11_06_E7_S5_G1_SW",
                volume: 1027.92770249171
            },
            {
                name: "THK11_07_E7_S5_G4_SW",
                volume: 430.419472456759
            },
            {
                name: "THK11_08_E3_S2_G8_SW",
                volume: 417.302803554065
            },
            {
                name: "THK11_09_E3_S2_PROFILE_END",
                volume: 1318.29263058441
            },
            {
                name: "THK11_10_F4_FILLET_E3_S2_G6_SW_E3_S2_G9_SW_ac21e33a_3_TUBE_Outer",
                volume: 360.828447549109
            },
            {
                name: "THK11_11_E3_S2_G6_SW",
                volume: 390.273095411996
            },
            {
                name: "THK11_12_F4_FILLET_E3_S2_G6_SW_E3_S2_G7_SW_9f79c830_4_TUBE_Outer",
                volume: 181.554437586781
            },
            {
                name: "THK11_13_E3_S2_G1_SW",
                volume: 429.843400420794
            }
        ]
    },
    test_generated_history_20260427005357_nine_face_thicken: {
        solids: [
            {
                name: "E3",
                volume: 57602.97682994
            },
            {
                name: "THK8_01_E3_S2_G7_SW",
                volume: 1535.58281846805
            },
            {
                name: "THK8_02_F4_FILLET_E3_S2_G6_SW_E3_S2_G7_SW_9f79c830_4_TUBE_Outer",
                volume: 181.624126460153
            },
            {
                name: "THK8_03_F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer",
                volume: 225.191215076565
            },
            {
                name: "THK8_04_E7_S5_G1_SW",
                volume: 1027.92770249171
            },
            {
                name: "THK8_05_E3_S2_G8_SW",
                volume: 417.302803554065
            },
            {
                name: "THK8_06_F4_FILLET_E3_S2_G8_SW_E3_S2_G9_SW_a386a4b0_2_TUBE_Outer",
                volume: 181.26138068895
            },
            {
                name: "THK8_07_E3_S2_G9_SW",
                volume: 1151.36765270539
            },
            {
                name: "THK8_08_F4_FILLET_E3_S2_G6_SW_E3_S2_G9_SW_ac21e33a_3_TUBE_Outer",
                volume: 360.828447549109
            },
            {
                name: "THK8_09_E3_S2_G6_SW",
                volume: 390.273095411996
            }
        ]
    },
    test_generated_history_20260427005357_three_face_thicken: {
        solids: [
            {
                name: "E3",
                volume: 57602.97682994
            },
            {
                name: "THK8_01_F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer",
                volumeError: "Not manifold"
            },
            {
                name: "THK8_02_E3_S2_G7_SW",
                volume: 7694.37664329107
            },
            {
                name: "THK8_03_E3_S2_G4_SW",
                volume: 6706.3824780836
            }
        ]
    },
    test_generated_history_20260523000414: {
        solids: [
            {
                name: "P.T1",
                volume: 101215.800220043
            }
        ]
    },
    test_generated_history_20260531201126: {
        solids: [
            {
                name: "SM.CF4",
                volume: 13219.5674843206
            },
            {
                name: "SM.TAB6",
                volume: 2874.51512294755
            }
        ]
    },
    test_generated_history_20260606004152: {
        solids: [
            {
                name: "E2",
                volume: 6978.23486098406
            }
        ]
    },
    test_generated_history_20260609042734_preserves_s22_subtract_sidewalls: {
        solids: [
            {
                name: "E2_O.S17",
                volume: 1250.54881574222
            }
        ]
    },
    test_generated_history_20260609165436_six_edge_profile_has_six_sidewalls: {
        solids: [
            {
                name: "E2",
                volume: 3347.92112836712
            }
        ]
    },
    test_generated_history_20260709035143_offset_shell_prefers_source_face_names: {
        solids: [
            {
                name: "TU2_O.S3",
                volume: 9.434465155052967
            }
        ]
    },
    test_generated_history_20260612230031: {
        solids: [
            {
                name: "E2",
                volume: 36224.8052343851
            }
        ]
    },
    test_generated_history_20260612232755: {
        solids: [
            {
                name: "P.CY2",
                volume: 578.428561396709
            }
        ]
    },
    test_generated_history_20260613000139: {
        solids: [
            {
                name: "E3",
                volume: 1105.88552744347
            }
        ]
    },
    test_generated_history_20260613003952: {
        solids: [
            {
                name: "P.CY1",
                volume: 7041.20928059529
            }
        ]
    },
    test_history_delete_restores_removed_upstream_solid_from_source_feature: {
        solids: [
            {
                name: "C1",
                volume: 64
            }
        ]
    },
    test_history_expand_does_not_dirty: {
        solids: [
            {
                name: "P.CU1",
                volume: 1000
            }
        ]
    },
    test_history_features_basic: {
        solids: [
            {
                name: "LOFT8",
                volume: 326.666666666667
            },
            {
                name: "R11",
                volume: 206.015391140998
            },
            {
                name: "(P.CU12)",
                volume: 1000
            },
            {
                name: "P.CU14",
                volume: 416.666650772095
            },
            {
                name: "P.CU16",
                volume: 1000
            },
            {
                name: "P.CU16_XFORM17",
                volume: 999.999999488937
            },
            {
                name: "OVL19_Overlap",
                volume: 999.850007492751
            },
            {
                name: "P.CU20",
                volume: 1050
            },
            {
                name: "P.CU22",
                volume: 1000
            },
            {
                name: "THK23",
                volume: 50
            },
            {
                name: "P.CU24",
                volume: 1000
            },
            {
                name: "PATTERN25_2",
                volume: 1000
            },
            {
                name: "PATTERN25_3",
                volume: 1000
            },
            {
                name: "P.CU26",
                volume: 1000
            },
            {
                name: "PATTERN27_2",
                volume: 999.999999488937
            },
            {
                name: "PATTERN27_3",
                volume: 1000
            },
            {
                name: "PATTERN27_4",
                volume: 999.999999488937
            }
        ]
    },
    test_hole_counterbore: {
        solids: [
            {
                name: "P.CU1",
                volume: 1630.87250592775
            }
        ]
    },
    test_hole_countersink: {
        solids: [
            {
                name: "P.CU1",
                volume: 1688.33210900789
            }
        ]
    },
    test_hole_multi_point_cloned_cutter: {
        solids: [
            {
                name: "P.CU1",
                volume: 1615.18028799471
            }
        ]
    },
    test_hole_thread_modeled: {
        solids: [
            {
                name: "P.CU1",
                volume: 1605.46300377984
            }
        ]
    },
    test_hole_thread_symbolic: {
        solids: [
            {
                name: "P.CU1",
                volume: 1614.35133879044
            }
        ]
    },
    test_hole_through: {
        solids: [
            {
                name: "P.CU1",
                volume: 1690.39342463488
            }
        ]
    },
    test_import3d_decimation_100_restores_original_geometry: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_RESTORE",
                volume: 784.837618809879
            }
        ]
    },
    test_import3d_decimation_99_is_near_full_detail: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_NEAR_FULL_100",
                volume: 784.837618809879
            },
            {
                name: "IMPORT3D_DECIMATION_NEAR_FULL_99",
                volume: 784.837618809879
            },
            {
                name: "IMPORT3D_DECIMATION_NEAR_FULL_90",
                volume: 781.619794982087
            }
        ]
    },
    test_import3d_decimation_preserves_source_snapshot_without_json_clone: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE",
                volume: 784.837618809879
            }
        ]
    },
    test_import3d_decimation_reapplies_from_cached_source_mesh: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_STABILITY",
                volume: 742.158722608068
            }
        ]
    },
    test_import3d_decimation_reduces_triangle_count: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_BASELINE",
                volume: 784.837618809879
            },
            {
                name: "IMPORT3D_DECIMATION_REDUCED",
                volume: 742.158722608068
            }
        ]
    },
    test_import3d_decimation_seeds_source_snapshot_for_legacy_cache: {
        solids: [
            {
                name: "IMPORT3D_DECIMATION_LEGACY_CACHE",
                volume: 781.619794982087
            }
        ]
    },
    test_import3d_extract_multiple_solids_toggle: {
        solids: [
            {
                name: "IMPORT3D_MULTI_SOLIDS",
                volume: 16
            }
        ]
    },
    test_import3d_fixture_merges_faces_4_and_34: {
        solids: [
            {
                name: "IMPORT3D5",
                volume: 20965.1875367812
            }
        ]
    },
    test_import3d_planar_extraction_merges_sliver_bridge: {
        solids: [
            {
                name: "IMPORT3D_PLANAR_SLIVER_BRIDGE",
                volumeError: "Not manifold"
            }
        ]
    },
    test_mirror: {
        solids: [
            {
                name: "P.CU1",
                volume: 24
            },
            {
                name: "M2:P.CU1:M",
                volume: 24
            }
        ]
    },
    test_offsetFace_preserves_individual_edges: {
        solids: [
            {
                name: "P.CU1",
                volume: 125
            }
        ]
    },
    test_offsetShell_debug_separates_rounded_tube_remainder: {
        solids: [
            {
                name: "P.CU_DBG",
                volume: 1000
            },
            {
                name: "P.CU_DBG_OS_DBG",
                volume: 250
            },
            {
                name: "P.CU_DBG_OS_DBG_ROUND_PIPE_REMAINDER",
                volume: 46.0756385158375
            }
        ]
    },
    test_offsetShell_negative_distance_rounds_unselected_solid_edges: {
        solids: [
            {
                name: "P.CU_NEG",
                volume: 1000
            },
            {
                name: "P.CU_NEG_OS_NEG",
                volume: 265.832496698663
            }
        ]
    },
    test_offsetShell_repro_20260607082324_removes_area_loss_sidewall: {
        solids: [
            {
                name: "E2_O.S17",
                volume: 2576.90835821062
            }
        ]
    },
    test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces: {
        solids: [
            {
                name: "E2_O.S17",
                volumeError: "Not manifold"
            }
        ]
    },
    test_offsetShell_thickens_all_faces_except_selected: {
        solids: [
            {
                name: "P.CU1",
                volume: 1000
            },
            {
                name: "P.CU1_OS2",
                volume: 424
            }
        ]
    },
    test_pmi_view_visibility_state_round_trip: {
        solids: [
            {
                name: "P.CU1",
                volume: 192
            }
        ]
    },
    test_primitiveCone: {
        solids: [
            {
                name: "P.CO1",
                volume: 57.5801640465955
            }
        ]
    },
    test_primitiveCube: {
        solids: [
            {
                name: "P.CU1",
                volume: 750
            }
        ]
    },
    test_primitiveCylinder: {
        solids: [
            {
                name: "P.CY1",
                volume: 15.5933769422788
            }
        ]
    },
    test_primitivePyramid: {
        solids: [
            {
                name: "P.PY1",
                volume: 66.6666666325958
            }
        ]
    },
    test_primitiveSphere: {
        solids: [
            {
                name: "P.S1",
                volume: 443.047279028973
            }
        ]
    },
    test_primitiveTorus: {
        solids: [
            {
                name: "P.T_TORUS_PARTIAL",
                volume: 5944.1029398298
            },
            {
                name: "P.T_TORUS_FULL",
                volume: 856.223664880298
            }
        ]
    },
    test_primitive_boolean_union_preserves_face_grouping: {
        solids: [
            {
                name: "P.CU1",
                volume: 1388.13191863788
            }
        ]
    },
    test_pushFace: {
        solids: [
            {
                name: "PUSHFACE_CUBE",
                volume: 205.566652928832
            }
        ]
    },
    test_pushFace_feature: {
        solids: [
            {
                name: "PUSH_FACE_FEATURE_BASE",
                volume: 57.75
            }
        ]
    },
    test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache: {
        solids: [
            {
                name: "C1",
                volume: 96
            },
            {
                name: "TU1",
                volume: 0.254558454138376
            }
        ]
    },
    test_remesh_simplify_imported_fixture_stl: {
        solids: [
            {
                name: "(REMESH_IMPORT_FIXTURE_SOURCE)",
                volume: 20970.3240926161
            }
        ]
    },
    test_revolve_after_union_preserves_face_reference_resolution: {
        solids: [
            {
                name: "P.CY1",
                volume: 620.525568422649
            }
        ]
    },
    test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit: {
        solids: [
            {
                name: "R2",
                volume: 56.1860129259784
            }
        ]
    },
    test_run_history_calls_are_serialized: {
        solids: [
            {
                name: "C1",
                volume: 64
            }
        ]
    },
    test_sheetMetal_contour_flange_whole_sketch_selection: {
        solids: [
            {
                name: "SM_CF_FROM_SKETCH",
                volume: 767.387976275291
            }
        ]
    },
    test_sheetMetal_cutout_preserves_multiple_profile_loops: {
        solids: [
            {
                name: "SM_MULTI_TAB",
                volume: 18.881537951849406
            },
            {
                name: "SM_MULTI_CUTOUT:CUTTER",
                volume: 17.895548688641735
            }
        ]
    },
    test_sketch_face_attachment_alignment: {
        solids: [
            {
                name: "E2",
                volume: 89842.9383869605
            }
        ]
    },
    test_sketch_profile_tolerant_loop_join: {
        solids: [
            {
                name: "E2",
                volume: 68858.3892518225
            }
        ]
    },
    test_smooth_with_subdivision_preserves_centered_ring_symmetry: {
        solids: [
            {
                name: "E3",
                volume: 576
            }
        ]
    },
    test_smooth_with_subdivision_preserves_mirrored_union_symmetry: {
        solids: [
            {
                name: "E3",
                volume: 573.888861738791
            }
        ]
    },
    test_smooth_with_subdivision_replaces_source_solid: {
        solids: [
            {
                name: "SMOOTH_SRC",
                volume: 644.155072204575
            }
        ]
    },
    test_solidMetrics: {
        solids: [
            {
                name: "P.CU1",
                volume: 24
            }
        ]
    },
    test_stlLoader: {
        solids: [
            {
                name: "IMPORT3D1",
                volume: 975235.302269274
            }
        ]
    },
    test_subtract_extrude_preserves_rectangle_tool_sidewall_faces: {
        solids: [
            {
                name: "C1",
                volume: 964
            }
        ]
    },
    test_subtract_restore_rejects_raw_tool_added_snapshot: {
        solids: [
            {
                name: "C1",
                volume: 964
            }
        ]
    },
    test_thicken_feature_connected_faces_remain_individual_solids: {
        solids: [
            {
                name: "THICK_PATCH_SRC",
                volume: 24
            },
            {
                name: "THICK_PATCH_01_THICK_PATCH_SRC_PZ",
                volume: 12
            },
            {
                name: "THICK_PATCH_02_THICK_PATCH_SRC_PX",
                volume: 6
            }
        ]
    },
    test_thicken_feature_multiple_faces_produce_multiple_solids: {
        solids: [
            {
                name: "THICK_MULTI_SRC",
                volume: 24
            },
            {
                name: "THICK_MULTI_01_THICK_MULTI_SRC_PZ",
                volume: 15
            },
            {
                name: "THICK_MULTI_02_THICK_MULTI_SRC_NZ",
                volume: 15
            }
        ]
    },
    test_thicken_feature_serializes_and_replays_planar_profile: {
        solids: [
            {
                name: "THICK_FEATURE",
                volume: 18
            }
        ]
    },
    test_thicken_sphere_torus_union: {
        solids: [
            {
                name: "P.T1",
                volume: 761.736571361542
            },
            {
                name: "THK3_01_P.T1_Side",
                volume: 748.623249401366
            },
            {
                name: "THK3_02_P.S2",
                volume: 861.132731172943
            }
        ]
    },
    test_tube: {
        solids: [
            {
                name: "TU3",
                volume: 3227.31297384824
            },
            {
                name: "TU4",
                volume: 4242.00094751633
            }
        ]
    },
    test_tube_closedLoop: {
        solids: [
            {
                name: "TU3",
                volume: 2942.28797708232
            },
            {
                name: "TU4",
                volume: 4891.50254168091
            }
        ]
    },
    test_visibility_hidden_state_persistence: {
        solids: [
            {
                name: "P.CU1",
                volume: 192
            },
            {
                name: "P.CU2",
                volume: 1000
            }
        ]
    }
});

export function getSolidVolumeExpectations(testName) {
    return solidVolumeExpectations[String(testName || "")] || null;
}
