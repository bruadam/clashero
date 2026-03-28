use clash::bcf_reporter::{ClashInfo, generate_bcf};
use std::fs::File;
use std::io::Read;
use tempfile::tempdir;
use zip::ZipArchive;

#[test]
fn test_viewpoint_calculation() {
    let temp_dir = tempdir().unwrap();
    let bcf_path = temp_dir.path().join("viewpoint_test.bcfzip");

    let clash = ClashInfo {
        guid_a: "GUID_A".to_string(),
        guid_b: "GUID_B".to_string(),
        description: "Test clash".to_string(),
        position: [10.0, 10.0, 10.0],
        camera_eye: Some([0.0, 0.0, 0.0]),
        units: "meter".to_string(),
    };

    generate_bcf(&bcf_path, &[clash]).expect("Failed to generate BCF");

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();

    // Find the bcfv file
    let mut bcfv_content = String::new();
    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        if file.name().ends_with(".bcfv") {
            file.read_to_string(&mut bcfv_content).unwrap();
            found = true;
            break;
        }
    }
    assert!(found, "BCFv file not found in archive");

    // Check camera viewpoint (eye)
    assert!(
        bcfv_content.contains("<CameraViewPoint>"),
        "Missing CameraViewPoint"
    );
    assert!(bcfv_content.contains("<X>0</X>"), "Wrong Camera X");
    assert!(bcfv_content.contains("<Y>0</Y>"), "Wrong Camera Y");
    assert!(bcfv_content.contains("<Z>0</Z>"), "Wrong Camera Z");

    // Check camera direction (normalized vector from eye 0,0,0 to target 10,10,10)
    // Vector is [10, 10, 10], length is sqrt(300) = 17.3205
    // Normalized is [0.57735, 0.57735, 0.57735]
    assert!(
        bcfv_content.contains("<CameraDirection>"),
        "Missing CameraDirection"
    );
    // quick-xml text might not have all decimals, but let's check for the prefix
    assert!(bcfv_content.contains("0.57735"), "Wrong Direction X");
}

#[test]
fn test_viewpoint_calculation_default() {
    let temp_dir = tempdir().unwrap();
    let bcf_path = temp_dir.path().join("viewpoint_default.bcfzip");

    let clash = ClashInfo {
        guid_a: "GUID_A".to_string(),
        guid_b: "GUID_B".to_string(),
        description: "Test clash".to_string(),
        position: [10.0, 10.0, 10.0],
        camera_eye: None,
        units: "meter".to_string(),
    };

    generate_bcf(&bcf_path, &[clash]).expect("Failed to generate BCF");

    let file = File::open(&bcf_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();

    let mut bcfv_content = String::new();
    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        if file.name().ends_with(".bcfv") {
            file.read_to_string(&mut bcfv_content).unwrap();
            found = true;
            break;
        }
    }
    assert!(found);

    // Default eye is pos + 5.0 = [15, 15, 15]
    assert!(bcfv_content.contains("<X>15</X>"));
    assert!(bcfv_content.contains("<Y>15</Y>"));
    assert!(bcfv_content.contains("<Z>15</Z>"));

    // Default direction is [-0.577, -0.577, -0.577]
    assert!(bcfv_content.contains("-0.577"));
}
