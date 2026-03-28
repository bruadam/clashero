use anyhow::Result;
use clash::ifc_adapter::{load_ifc_elements, load_ifc_metadata};
use std::io::Write;
use tempfile::NamedTempFile;

#[test]
fn test_load_ifc_metadata() -> Result<()> {
    let mut file = NamedTempFile::new()?;
    writeln!(file, "ISO-10303-21;")?;
    writeln!(file, "HEADER;")?;
    writeln!(file, "ENDSEC;")?;
    writeln!(file, "DATA;")?;
    writeln!(file, "#1=IFCWALL('GUID_WALL',$,$,$,$,$,$,$);")?;
    writeln!(
        file,
        "#2=IFCRELDEFINESBYPROPERTIES('GUID_REL',$,$,$,(#1),#3);"
    )?;
    writeln!(
        file,
        "#3=IFCPROPERTYSET('GUID_PSET',$,'Pset_WallCommon',$,(#4));"
    )?;
    writeln!(
        file,
        "#4=IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);"
    )?;
    writeln!(file, "ENDSEC;")?;
    writeln!(file, "END-ISO-10303-21;")?;

    let metadata = load_ifc_metadata(file.path())?;

    assert!(metadata.contains_key(&1));
    let wall_metadata = metadata.get(&1).unwrap();
    assert_eq!(wall_metadata.ifc_type, "IFCWALL");
    assert_eq!(wall_metadata.discipline, "Structural");
    assert_eq!(wall_metadata.properties.get("LoadBearing").unwrap(), "T");

    Ok(())
}

#[test]
fn test_load_ifc_elements() -> Result<()> {
    let mut file = NamedTempFile::new()?;
    writeln!(file, "ISO-10303-21;")?;
    writeln!(file, "HEADER;")?;
    writeln!(file, "ENDSEC;")?;
    writeln!(file, "DATA;")?;
    writeln!(file, "#1=IFCWALL('3A$123',$,$,$,$,$,$,$);")?;
    writeln!(file, "ENDSEC;")?;
    writeln!(file, "END-ISO-10303-21;")?;

    let elements = load_ifc_elements(file.path())?;
    // It won't find any geometry for a simple IFCWALL without representation.
    assert!(elements.is_empty());

    Ok(())
}

#[test]
fn test_load_real_ifc_model() -> Result<()> {
    let path = "tests/models/AC20-FZK-Haus.ifc";

    // Test metadata loading
    let metadata = load_ifc_metadata(path)?;
    assert!(
        metadata.len() > 40000,
        "Should have loaded a large number of metadata entries"
    );

    // Test geometry loading
    let elements = load_ifc_elements(path)?;
    assert_eq!(
        elements.len(),
        107,
        "Should have loaded exactly 107 elements with geometry"
    );

    // Verify some properties of the loaded elements
    let first_element = &elements[0];
    assert!(!first_element.metadata.guid.is_empty());
    assert!(first_element.mesh.vertices().len() > 0);
    assert!(first_element.mesh.indices().len() > 0);

    // Verify element with opening (IfcWallStandardCase #17040 with opening #17106)
    // GUID for #17040 is "3PfS__Y_DBAfq5naM6zD2Z"
    let wall_with_opening = elements
        .iter()
        .find(|e| e.metadata.guid == "3PfS__Y_DBAfq5naM6zD2Z");
    assert!(
        wall_with_opening.is_some(),
        "Wall with opening should be present"
    );

    let wall = wall_with_opening.unwrap();
    // A standard wall (box) has 12 triangles. If openings are subtracted, it might have more.
    assert!(
        wall.mesh.indices().len() >= 12,
        "Wall should have at least 12 triangles"
    );

    // Verify IfcOpeningElement #17106
    // GUID for #17106 is "0LM8GvGe$G3dlW4mZ4aA9R"
    let opening = elements
        .iter()
        .find(|e| e.metadata.guid == "0LM8GvGe$G3dlW4mZ4aA9R");
    assert!(opening.is_some(), "Opening element should be present");

    Ok(())
}
