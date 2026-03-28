use anyhow::{Context, Result};
use ifc_lite_core::decoder::EntityDecoder;
use ifc_lite_core::{AttributeValue, EntityScanner};
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
    pub discipline: String,
    pub properties: HashMap<String, String>,
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
    let mut decoder = EntityDecoder::new(&content);
    let mut scanner = EntityScanner::new(&content);

    // First pass: extract all elements and identify their types/GUIDs
    while let Some((id, type_name, _start, _end)) = scanner.next_entity() {
        if let Ok(decoded) = decoder.decode_by_id(id as u32) {
            if let Some(guid_attr) = decoded.attributes.first() {
                let guid = format!("{:?}", guid_attr).trim_matches('"').to_string();
                let discipline = identify_discipline(&format!("{:?}", decoded.ifc_type));

                metadata_map.insert(
                    id as u64,
                    IfcMetadata {
                        guid,
                        ifc_type: type_name.to_string(),
                        discipline,
                        properties: HashMap::new(),
                    },
                );
            }
        }
    }

    // Second pass: extract property sets and relationships
    let mut scanner = EntityScanner::new(&content);
    while let Some((id, type_name, _start, _end)) = scanner.next_entity() {
        if type_name == "IFCRELDEFINESBYPROPERTIES" {
            if let Ok(decoded) = decoder.decode_by_id(id as u32) {
                // Attr 4: RelatedObjects (List of EntityRef)
                // Attr 5: RelatingPropertyDefinition (EntityRef)
                if let (
                    Some(AttributeValue::List(objs)),
                    Some(AttributeValue::EntityRef(prop_id)),
                ) = (decoded.attributes.get(4), decoded.attributes.get(5))
                {
                    if let Ok(prop_set) = decoder.decode_by_id(*prop_id as u32) {
                        if format!("{:?}", prop_set.ifc_type) == "IfcPropertySet" {
                            let mut properties = HashMap::new();
                            // Attr 4: HasProperties (List of EntityRef)
                            if let Some(AttributeValue::List(props)) = prop_set.attributes.get(4) {
                                for p_id in props {
                                    if let AttributeValue::EntityRef(pid) = p_id {
                                        if let Ok(prop) = decoder.decode_by_id(*pid as u32) {
                                            if format!("{:?}", prop.ifc_type)
                                                == "IfcPropertySingleValue"
                                            {
                                                // Attr 0: Name, Attr 2: NominalValue
                                                if let (Some(name_attr), Some(val_attr)) =
                                                    (prop.attributes.get(0), prop.attributes.get(2))
                                                {
                                                    let name = match name_attr {
                                                        AttributeValue::String(s) => s.clone(),
                                                        _ => format!("{:?}", name_attr)
                                                            .trim_matches('"')
                                                            .to_string(),
                                                    };
                                                    let value = match val_attr {
                                                        AttributeValue::String(s) => s.clone(),
                                                        AttributeValue::Enum(e) => e.clone(),
                                                        AttributeValue::List(l) => match l.get(1) {
                                                            Some(AttributeValue::String(s)) => {
                                                                s.clone()
                                                            }
                                                            Some(AttributeValue::Enum(e)) => {
                                                                e.clone()
                                                            }
                                                            _ => format!("{:?}", val_attr)
                                                                .trim_matches('"')
                                                                .to_string(),
                                                        },
                                                        _ => format!("{:?}", val_attr)
                                                            .trim_matches('"')
                                                            .to_string(),
                                                    };
                                                    properties.insert(name, value);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            for obj_id in objs {
                                if let AttributeValue::EntityRef(oid) = obj_id {
                                    if let Some(metadata) = metadata_map.get_mut(&(*oid as u64)) {
                                        metadata.properties.extend(properties.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(metadata_map)
}

fn identify_discipline(ifc_type: &str) -> String {
    let type_clean = ifc_type.to_uppercase();
    if type_clean.contains("IFCBEAM")
        || type_clean.contains("IFCCOLUMN")
        || type_clean.contains("IFCFOOTING")
        || type_clean.contains("IFCMEMBER")
        || type_clean.contains("IFCSLAB")
        || type_clean.contains("IFCWALL")
    {
        return "Structural".to_string();
    }
    if type_clean.contains("IFCPIPE")
        || type_clean.contains("IFCDUCT")
        || type_clean.contains("IFCFLOW")
    {
        return "MEP".to_string();
    }
    if type_clean.contains("IFCDOOR")
        || type_clean.contains("IFCWINDOW")
        || type_clean.contains("IFCSTAIR")
        || type_clean.contains("IFCRAILING")
        || type_clean.contains("IFCCURTAINWALL")
    {
        return "Architectural".to_string();
    }
    "General".to_string()
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
}
