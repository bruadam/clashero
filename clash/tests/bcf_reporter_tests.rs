use clash::bcf_reporter::{ClashInfo, generate_bcf};
use std::fs::File;
use std::io::Read;
use tempfile::tempdir;
use zip::ZipArchive;

#[test]
fn test_generate_bcf_valid_zip() {
    let dir = tempdir().unwrap();
    let bcf_path = dir.path().join("test.bcfzip");

    let clashes = vec![
        ClashInfo {
            guid_a: "GUID-A".to_string(),
            guid_b: "GUID-B".to_string(),
            description: "Clash description 1".to_string(),
            position: [1.0, 2.0, 3.0],
            camera_eye: Some([0.0, 0.0, 0.0]),
            units: "meter".to_string(),
        },
        ClashInfo {
            guid_a: "GUID-C".to_string(),
            guid_b: "GUID-D".to_string(),
            description: "Clash description 2".to_string(),
            position: [10.0, 20.0, 30.0],
            camera_eye: None,
            units: "meter".to_string(),
        },
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
        assert!(project_content.contains("<Unit>meter</Unit>"));
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
        assert!(markup_content.contains("<Title>Clash between "));
    }
}
