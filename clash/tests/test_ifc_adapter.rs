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
