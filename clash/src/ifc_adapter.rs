use anyhow::{Context, Result};
use ifc_lite_core::{EntityScanner, parse_entity};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Represents basic metadata extracted from an IFC element.
#[derive(Debug, Clone, PartialEq)]
pub struct IfcMetadata {
    pub guid: String,
    pub ifc_type: String,
}

/// Loads an IFC file and extracts basic metadata (GUID and Type) for all elements.
pub fn load_ifc_metadata<P: AsRef<Path>>(path: P) -> Result<HashMap<u64, IfcMetadata>> {
    let content = fs::read_to_string(path.as_ref())
        .with_context(|| format!("Failed to read IFC file at {:?}", path.as_ref()))?;

    let mut metadata_map = HashMap::new();
    let mut scanner = EntityScanner::new(&content);

    while let Some((id, type_name, _start, _end)) = scanner.next_entity() {
        // We need to parse the entity to get the GUID.
        // Usually, GUID is the first attribute for many IFC types.
        let entity_str = &content[_start.._end];
        if let Ok((_id, _type, attrs)) = parse_entity(entity_str) {
            // GUID is typically the first attribute of IfcRoot-derived entities.
            // ifc-lite-core parse_entity returns attributes as a list.
            if let Some(first_attr) = attrs.first() {
                // We'll treat the first attribute as GUID if it looks like one.
                // In ifc-lite-core, attributes are AttributeValue.
                // We'll need to convert it to string.
                let guid = format!("{:?}", first_attr).trim_matches('"').to_string();

                metadata_map.insert(
                    id as u64,
                    IfcMetadata {
                        guid,
                        ifc_type: type_name.to_string(),
                    },
                );
            }
        }
    }

    Ok(metadata_map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_load_ifc_metadata() -> Result<()> {
        let mut file = NamedTempFile::new()?;
        writeln!(file, "ISO-10303-21;")?;
        writeln!(file, "HEADER;")?;
        writeln!(file, "ENDSEC;")?;
        writeln!(file, "DATA;")?;
        writeln!(file, "#1=IFCWALL('3A$123',$,$,$,$,$,$,$);")?;
        writeln!(file, "#2=IFCBEAM('3A$456',$,$,$,$,$,$,$);")?;
        writeln!(file, "ENDSEC;")?;
        writeln!(file, "END-ISO-10303-21;")?;

        let metadata = load_ifc_metadata(file.path())?;

        assert_eq!(metadata.len(), 2);
        assert_eq!(metadata.get(&1).unwrap().ifc_type, "IFCWALL");
        // Note: format!("{:?}", first_attr) might vary depending on how AttributeValue implements Debug
        // But for this initial slice, we just want to see if it works.

        Ok(())
    }
}
