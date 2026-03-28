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
    let path = "tests/models/30_TGA_Elektro_GN.ifc";

    // Test metadata loading
    let metadata = load_ifc_metadata(path)?;
    assert!(
        metadata.len() > 200000,
        "Should have loaded a large number of metadata entries"
    );

    // Check some expected types from the probe
    let mut light_fixtures = 0;
    let mut junction_boxes = 0;
    for meta in metadata.values() {
        if meta.ifc_type == "IFCLIGHTFIXTURE" {
            light_fixtures += 1;
        } else if meta.ifc_type == "IFCJUNCTIONBOX" {
            junction_boxes += 1;
        }
    }
    assert_eq!(light_fixtures, 1653);
    assert_eq!(junction_boxes, 307);

    // Test geometry loading
    let elements = load_ifc_elements(path)?;
    assert_eq!(
        elements.len(),
        7389,
        "Should have loaded exactly 7389 elements with geometry"
    );

    // Verify some properties of the loaded elements
    let first_element = &elements[0];
    assert!(!first_element.metadata.guid.is_empty());
    assert!(first_element.mesh.vertices().len() > 0);
    assert!(first_element.mesh.indices().len() > 0);

    Ok(())
}
