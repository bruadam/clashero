use clash::bcf_reporter::{ClashInfo, ClashType, generate_bcf};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use tempfile::tempdir;
use zip::ZipArchive;

fn make_clash(guid_a: &str, guid_b: &str, description: &str, p1: [f64; 3], camera_eye: Option<[f64; 3]>) -> ClashInfo {
    ClashInfo {
        clash_id: format!("{}-{}", guid_a, guid_b),
        clash_set_name: "TestSet".to_string(),
        guid_a: guid_a.to_string(),
        name_a: "WallA".to_string(),
        ifc_type_a: "IfcWall".to_string(),
        description_a: None,
        discipline_a: "Structural".to_string(),
        source_file_a: "file_a.ifc".to_string(),
        properties_a: HashMap::new(),
        guid_b: guid_b.to_string(),
        name_b: "DuctB".to_string(),
        ifc_type_b: "IfcDuctSegment".to_string(),
        description_b: None,
        discipline_b: "MEP".to_string(),
        source_file_b: "file_b.ifc".to_string(),
        properties_b: HashMap::new(),
        p1,
        p2: p1,
        distance: -0.05,
        penetration_depth: 0.05,
        penetration_volume: 0.001,
        clash_type: ClashType::Hard,
        camera_eye,
        description: description.to_string(),
    }
}

#[test]
fn test_generate_bcf_valid_zip() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("test.bcfzip");

    let clashes = vec![
        make_clash("GUID-A", "GUID-B", "Clash description 1", [1.0, 2.0, 3.0], Some([0.0, 0.0, 0.0])),
        make_clash("GUID-C", "GUID-D", "Clash description 2", [10.0, 20.0, 30.0], None),
    ];

    generate_bcf(&bcf_path, &clashes).expect("Failed to generate BCF");

    assert!(bcf_path.exists());

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).expect("Failed to open ZIP archive");

    // Check for bcf.version
    {
        let mut version_file = archive.by_name("bcf.version").expect("bcf.version missing");
        let mut version_content = String::new();
        version_file.read_to_string(&mut version_content).unwrap();
        assert_eq!(version_content, "VersionId=\"2.1\"");
    }

    // Check for project.bcfp
    {
        let mut project_file = archive
            .by_name("project.bcfp")
            .expect("project.bcfp missing");
        let mut project_content = String::new();
        project_file.read_to_string(&mut project_content).unwrap();
        assert!(project_content.contains("<Name>Clash Detection Project</Name>"));
        assert!(!project_content.contains("<Unit>"));
    }

    // Check for topic folders and their files
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();

    // There should be 2 topic folders, each containing markup.bcf and a .bcfv file
    let markup_files: Vec<_> = file_names
        .iter()
        .filter(|n| n.ends_with("markup.bcf"))
        .collect();
    assert_eq!(markup_files.len(), 2);

    let viewpoint_files: Vec<_> = file_names.iter().filter(|n| n.ends_with(".bcfv")).collect();
    assert_eq!(viewpoint_files.len(), 2);

    // Verify content of one markup file
    {
        let mut markup_file = archive.by_name(markup_files[0]).unwrap();
        let mut markup_content = String::new();
        markup_file.read_to_string(&mut markup_content).unwrap();
        assert!(markup_content.contains("TopicStatus=\"Open\""));
    }
}

#[test]
fn test_bcf_title_format() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("title_test.bcfzip");

    let clashes = vec![make_clash(
        "GUID-A",
        "GUID-B",
        "Test",
        [0.0, 0.0, 0.0],
        None,
    )];
    generate_bcf(&bcf_path, &clashes).expect("Failed to generate BCF");

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();

    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let markup_name = file_names.iter().find(|n| n.ends_with("markup.bcf")).unwrap().clone();
    let mut markup_file = archive.by_name(&markup_name).unwrap();
    let mut content = String::new();
    markup_file.read_to_string(&mut content).unwrap();

    // Title should be "IfcType/Name and IfcType/Name"
    assert!(
        content.contains("<Title>IfcWall/WallA and IfcDuctSegment/DuctB</Title>"),
        "Expected IfcClass/Name title format, got: {}",
        content
    );
}

#[test]
fn test_bcf_labels_present() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("labels_test.bcfzip");

    let clashes = vec![make_clash(
        "GUID-A",
        "GUID-B",
        "Test",
        [0.0, 0.0, 0.0],
        None,
    )];
    generate_bcf(&bcf_path, &clashes).expect("Failed to generate BCF");

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();

    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let markup_name = file_names.iter().find(|n| n.ends_with("markup.bcf")).unwrap().clone();
    let mut markup_file = archive.by_name(&markup_name).unwrap();
    let mut content = String::new();
    markup_file.read_to_string(&mut content).unwrap();

    assert!(content.contains("<Labels>"), "Labels node missing");
    assert!(content.contains("<Label>Structural</Label>"), "discipline_a label missing");
    assert!(content.contains("<Label>MEP</Label>"), "discipline_b label missing");
    assert!(content.contains("<Label>hard</Label>"), "clash_type label missing");
    assert!(content.contains("<Label>TestSet</Label>"), "clash_set_name label missing");
}

#[test]
fn test_bcf_json_snippet_present() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("snippet_test.bcfzip");

    let clashes = vec![make_clash(
        "GUID-A",
        "GUID-B",
        "Test",
        [0.0, 0.0, 0.0],
        None,
    )];
    generate_bcf(&bcf_path, &clashes).expect("Failed to generate BCF");

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();

    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();

    // clash_data.json should exist inside a topic folder
    let json_files: Vec<_> = file_names.iter().filter(|n| n.ends_with("clash_data.json")).collect();
    assert_eq!(json_files.len(), 1, "Expected one clash_data.json, found: {:?}", json_files);

    // Markup should reference the JSON snippet
    let markup_name = file_names.iter().find(|n| n.ends_with("markup.bcf")).unwrap().clone();
    let mut markup_file = archive.by_name(&markup_name).unwrap();
    let mut content = String::new();
    markup_file.read_to_string(&mut content).unwrap();
    assert!(content.contains("SnippetType=\"JSON\""), "BIMSnippet type should be JSON");
    assert!(content.contains("clash_data.json"), "BIMSnippet reference should include clash_data.json");
}

#[test]
fn test_json_export_round_trip() {
    use clash::bcf_reporter::generate_json;
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("test.json");

    let clashes = vec![make_clash(
        "GUID-A",
        "GUID-B",
        "Round-trip test",
        [1.0, 2.0, 3.0],
        Some([0.0, 0.0, 0.0]),
    )];

    generate_json(&json_path, &clashes).expect("Failed to generate JSON");
    assert!(json_path.exists());

    let content = std::fs::read_to_string(&json_path).unwrap();
    let parsed: Vec<ClashInfo> = serde_json::from_str(&content).expect("JSON should deserialize");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].guid_a, "GUID-A");
    assert_eq!(parsed[0].guid_b, "GUID-B");
    assert_eq!(parsed[0].clash_type, ClashType::Hard);
    assert!((parsed[0].penetration_depth - 0.05).abs() < f64::EPSILON);
}

#[test]
fn test_description_format() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("desc_test.bcfzip");

    let clashes = vec![make_clash(
        "GUID-A",
        "GUID-B",
        "Some description",
        [0.0, 0.0, 0.0],
        None,
    )];
    generate_bcf(&bcf_path, &clashes).expect("Failed to generate BCF");

    // Check description content in markup
    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let markup_name = file_names.iter().find(|n| n.ends_with("markup.bcf")).unwrap().clone();
    let mut markup_file = archive.by_name(&markup_name).unwrap();
    let mut content = String::new();
    markup_file.read_to_string(&mut content).unwrap();

    // Description from the clash info is written into the markup
    assert!(content.contains("Some description"), "Description text missing from markup");
}
