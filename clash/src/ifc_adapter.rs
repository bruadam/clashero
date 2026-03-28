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
    pub length_unit: String,
}

/// Represents an extracted IFC element with its geometry and metadata.
pub struct IfcElement {
    pub metadata: IfcMetadata,
    pub mesh: TriMesh,
}

fn extract_properties(
    decoder: &mut EntityDecoder,
    pset_relationships: Vec<(u64, Vec<u64>, u64)>,
    metadata_map: &mut HashMap<u64, IfcMetadata>,
) {
    for (_, object_ids, pset_id) in pset_relationships {
        if let Ok(prop_set) = decoder.decode_by_id(pset_id as u32) {
            if format!("{:?}", prop_set.ifc_type) == "IfcPropertySet" {
                let mut properties = HashMap::new();
                if let Some(AttributeValue::List(props)) = prop_set.attributes.get(4) {
                    for p_id in props {
                        if let AttributeValue::EntityRef(pid) = p_id {
                            if let Ok(prop) = decoder.decode_by_id(*pid as u32) {
                                if format!("{:?}", prop.ifc_type) == "IfcPropertySingleValue" {
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
                                                Some(AttributeValue::String(s)) => s.clone(),
                                                Some(AttributeValue::Enum(e)) => e.clone(),
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
                for obj_id in object_ids {
                    if let Some(metadata) = metadata_map.get_mut(&obj_id) {
                        metadata.properties.extend(properties.clone());
                    }
                }
            }
        }
    }
}

fn extract_basic_metadata(
    decoder: &mut EntityDecoder,
    scanner: &mut EntityScanner,
) -> (HashMap<u64, IfcMetadata>, Vec<(u64, Vec<u64>, u64)>, String) {
    let mut metadata_map = HashMap::new();
    let mut pset_relationships = Vec::new();
    let mut length_unit = "meter".to_string();

    while let Some((id, type_name, _start, _end)) = scanner.next_entity() {
        if let Ok(decoded) = decoder.decode_by_id(id as u32) {
            if type_name == "IFCRELDEFINESBYPROPERTIES" {
                if let (
                    Some(AttributeValue::List(objs)),
                    Some(AttributeValue::EntityRef(prop_id)),
                ) = (decoded.attributes.get(4), decoded.attributes.get(5))
                {
                    let object_ids: Vec<u64> = objs
                        .iter()
                        .filter_map(|v| match v {
                            AttributeValue::EntityRef(id) => Some(*id as u64),
                            _ => None,
                        })
                        .collect();
                    pset_relationships.push((id as u64, object_ids, *prop_id as u64));
                }
            } else if type_name == "IFCSIUNIT" {
                if let (
                    Some(AttributeValue::Enum(unit_type)),
                    Some(AttributeValue::Enum(unit_name)),
                ) = (decoded.attributes.get(1), decoded.attributes.get(3))
                {
                    if unit_type == "LENGTHUNIT" {
                        length_unit = match decoded.attributes.get(2) {
                            Some(AttributeValue::Enum(prefix)) => {
                                format!("{prefix}{unit_name}").to_lowercase()
                            }
                            _ => unit_name.to_lowercase(),
                        };
                    }
                }
            } else if let Some(guid_attr) = decoded.attributes.first() {
                let guid = match guid_attr {
                    AttributeValue::String(s) => s.clone(),
                    _ => format!("{:?}", guid_attr).trim_matches('"').to_string(),
                };
                let discipline = identify_discipline(&format!("{:?}", decoded.ifc_type));

                metadata_map.insert(
                    id as u64,
                    IfcMetadata {
                        guid,
                        ifc_type: type_name.to_string(),
                        discipline,
                        properties: HashMap::new(),
                        length_unit: "".to_string(),
                    },
                );
            }
        }
    }

    for meta in metadata_map.values_mut() {
        meta.length_unit = length_unit.clone();
    }

    (metadata_map, pset_relationships, length_unit)
}

/// Loads an IFC file and extracts all geometry elements and their metadata.
pub fn load_ifc_elements<P: AsRef<Path>>(path: P) -> Result<Vec<IfcElement>> {
    let content = fs::read_to_string(path.as_ref())
        .with_context(|| format!("Failed to read IFC file at {:?}", path.as_ref()))?;

    let mut decoder = EntityDecoder::new(&content);
    let mut scanner = EntityScanner::new(&content);
    let router = GeometryRouter::new();
    let (mut metadata_map, pset_relationships, _) =
        extract_basic_metadata(&mut decoder, &mut scanner);
    extract_properties(&mut decoder, pset_relationships, &mut metadata_map);

    // Geometry generation pass (Second full pass, but reused content/decoder)
    let mut elements = Vec::new();
    let mut scanner = EntityScanner::new(&content);
    while let Some((id, _type_name, _start, _end)) = scanner.next_entity() {
        if let Some(metadata) = metadata_map.get(&(id as u64)) {
            if let Ok(decoded) = decoder.decode_by_id(id as u32) {
                // For complex elements like walls with openings or CSG results,
                // we ensure they are processed through the router which internally
                // handles the relationships and boolean operations if supported.
                if let Ok(mesh) = router.process_element(&decoded, &mut decoder) {
                    // Filter out very small meshes that might be artifacts
                    if mesh.positions.len() < 9 {
                        continue;
                    }

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

                    if !indices.is_empty() {
                        elements.push(IfcElement {
                            metadata: metadata.clone(),
                            mesh: TriMesh::new(vertices, indices),
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

    let mut decoder = EntityDecoder::new(&content);
    let mut scanner = EntityScanner::new(&content);
    let (mut metadata_map, pset_relationships, _) =
        extract_basic_metadata(&mut decoder, &mut scanner);
    extract_properties(&mut decoder, pset_relationships, &mut metadata_map);

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
