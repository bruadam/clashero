use assert_cmd::Command;
use predicates::prelude::*;
use std::path::PathBuf;

#[test]
fn test_cli_help() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    cmd.arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Detect clashes between IFC files"));
}

#[test]
fn test_cli_missing_file() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    cmd.arg("detect")
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "the following required arguments were not provided",
        ));
}

#[test]
fn test_cli_detect_basic() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    let ifc_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("models")
        .join("AC20-FZK-Haus.ifc");

    cmd.arg("detect")
        .arg("--file")
        .arg(ifc_path)
        .assert()
        .success()
        .stdout(predicate::str::contains("Clash Detection Summary"))
        .stdout(predicate::str::contains("Total Clashes:"));
}

#[test]
fn test_cli_detect_with_tolerance() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    let ifc_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("models")
        .join("AC20-FZK-Haus.ifc");

    cmd.arg("detect")
        .arg("--file")
        .arg(ifc_path)
        .arg("--tolerance")
        .arg("0.1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Tolerance: 0.1m"));
}

#[test]
fn test_cli_detect_with_bcf_output() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    let ifc_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("models")
        .join("AC20-FZK-Haus.ifc");

    let temp_dir = tempfile::tempdir().unwrap();
    let bcf_path = temp_dir.path().join("report.bcfzip");

    cmd.arg("detect")
        .arg("--file")
        .arg(ifc_path)
        .arg("--output")
        .arg(&bcf_path)
        .assert()
        .success()
        .stdout(predicate::str::contains("Generating BCF report"))
        .stdout(predicate::str::contains(
            "BCF report generated successfully.",
        ));

    assert!(bcf_path.exists());

    // Verify it's a valid zip and contains required files
    let file = std::fs::File::open(&bcf_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    assert!(archive.by_name("bcf.version").is_ok());
    assert!(archive.by_name("project.bcfp").is_ok());
}

#[test]
fn test_cli_detect_with_discipline_filtering() {
    let mut cmd = Command::cargo_bin("clash").unwrap();
    let architecture_ifc = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("models")
        .join("Building-Architecture.ifc");
    let hvac_ifc = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("models")
        .join("Building-Hvac.ifc");

    // Without filtering
    cmd.arg("detect")
        .arg("--file")
        .arg(&architecture_ifc)
        .arg("--file")
        .arg(&hvac_ifc)
        .assert()
        .success()
        .stdout(predicate::str::contains("Total Clashes:"));

    // With filtering
    let mut cmd = Command::cargo_bin("clash").unwrap();
    cmd.arg("detect")
        .arg("--file")
        .arg(&architecture_ifc)
        .arg("--file")
        .arg(&hvac_ifc)
        .arg("--discipline-a")
        .arg("Architectural")
        .arg("--discipline-b")
        .arg("MEP")
        .assert()
        .success()
        .stdout(predicate::str::contains("Total Clashes:"));
}
