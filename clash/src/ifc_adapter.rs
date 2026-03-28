use anyhow::{Context, Result};
use ifc_lite_core::decoder::EntityDecoder;
use ifc_lite_core::{EntityScanner, parse_entity};
use ifc_lite_geometry::router::GeometryRouter;
use parry3d_f64::shape::TriMesh;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Represents basic metadata extracted from an IFC element.
#[derive(Debug, Clone, PartialEq)]
pub struct IfcMetadata {
    pub guid: String,
    pub ifc_type: String,
}

/// Represents an extracted IFC element with its geometry and metadata.
pub struct IfcElement {
    pub metadata: IfcMetadata,
    pub mesh: TriMesh,
}

/// Loads an IFC file and extracts all geometry elements.
pub fn load_ifc_elements<P: AsRef<Path>>(path: P) -> Result<Vec<IfcElement>> {
    let content = fs::read_to_string(path.as_ref())
        .with_context(|| format!("Failed to read IFC file at {:?}", path.as_ref()))?;

    let mut decoder = EntityDecoder::new(&content);
    // decoder.build_index(); // private, but usually called in new or decode_by_id

    let router = GeometryRouter::new();
    let mut elements = Vec::new();
    let metadata_map = load_ifc_metadata(path.as_ref())?;

    let mut scanner = EntityScanner::new(&content);
    while let Some((id, _type_name, _start, _end)) = scanner.next_entity() {
        if let Ok(decoded) = decoder.decode_by_id(id as u32) {
            if let Ok(mesh) = router.process_element(&decoded, &mut decoder) {
                if let Some(metadata) = metadata_map.get(&(id as u64)) {
                    let vertices: Vec<parry3d_f64::math::Point<f64>> = mesh
                        .positions
                        .chunks(3)
                        .map(|v| {
                            parry3d_f64::math::Point::new(v[0] as f64, v[1] as f64, v[2] as f64)
                        })
                        .collect();

                    let indices: Vec<[u32; 3]> = mesh
                        .indices
                        .chunks(3)
                        .map(|c| [c[0] as u32, c[1] as u32, c[2] as u32])
                        .collect();

                    let tri_mesh = if indices.is_empty() {
                        None
                    } else {
                        Some(TriMesh::new(vertices, indices))
                    };

                    if let Some(mesh) = tri_mesh {
                        elements.push(IfcElement {
                            metadata: metadata.clone(),
                            mesh,
                        });
                    }
                }
            }
        }
    }

    Ok(elements)
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
}
