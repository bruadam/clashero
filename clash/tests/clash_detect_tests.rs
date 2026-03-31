use clash::clash_detect;
use std::path::PathBuf;

#[test]
fn test_clash_detect_hvac_structural() {
    let mut hvac_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    hvac_path.push("tests/models/Building-Hvac.ifc");

    let mut structural_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    structural_path.push("tests/models/Building-Structural.ifc");

    let files = vec![hvac_path, structural_path];
    let tolerance = 0.0;
    let discipline_a = None;
    let discipline_b = None;

    let selector_a = None;
    let selector_b = None;

    let result = clash_detect(
        &files,
        tolerance,
        &discipline_a,
        &discipline_b,
        &selector_a,
        &selector_b,
    );

    assert!(result.is_ok(), "clash_detect failed: {:?}", result.err());
    let (clash_count, clash_infos) = result.unwrap();

    println!("Found {} clashes", clash_count);
    assert!(
        clash_count > 0,
        "Expected at least one clash between HVAC and Structural models"
    );
    assert_eq!(clash_count as usize, clash_infos.len());

    for (i, clash) in clash_infos.iter().enumerate() {
        println!(
            "Clash {}: {} at {:?}",
            i + 1,
            clash.description,
            clash.p1
        );
        assert!(!clash.guid_a.is_empty());
        assert!(!clash.guid_b.is_empty());
    }
}
