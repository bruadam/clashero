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
