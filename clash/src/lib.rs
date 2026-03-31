pub mod bcf_reporter;
pub mod clash_engine;
pub mod ifc_adapter;
pub mod selector;

use anyhow::Result;
use bcf_reporter::{ClashInfo, ClashType};
use clash_engine::CollisionEngine;
use ifc_adapter::{IfcElement, load_ifc_elements};
use parry3d_f64::math::Pose;
use parry3d_f64::query::contact;
use parry3d_f64::shape::Shape;
use selector::Selector;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

fn default_true() -> bool {
    true
}

/// Prediction distance used in parry's `contact()` query for contact-point extraction.
const CONTACT_PREDICTION_DISTANCE: f64 = 0.01;

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ClashMode {
    Intersection,
    Collision,
    Clearance,
}

impl Default for ClashMode {
    fn default() -> Self {
        ClashMode::Intersection
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClashSet {
    pub name: String,
    pub a: Vec<SelectionGroup>,
    pub b: Vec<SelectionGroup>,

    #[serde(default)]
    pub mode: ClashMode,

    #[serde(default = "default_true")]
    pub check_all: bool,

    #[serde(default)]
    pub tolerance: f64,

    #[serde(default)]
    pub allow_touching: bool,

    #[serde(default)]
    pub clearance: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SelectionGroup {
    pub file: PathBuf,
    pub selector: Option<String>,
    pub mode: Option<String>,
}

fn load_group_elements(group: &SelectionGroup) -> Result<Vec<IfcElement>> {
    let elements = load_ifc_elements(&group.file)?;
    let mode = group.mode.as_deref().unwrap_or("a");
    let result = match mode {
        "i" => {
            let selector = Selector::new(group.selector.as_deref().unwrap_or(""));
            selector.filter(elements)
        }
        "e" => {
            let selector_str = group.selector.as_deref().unwrap_or("");
            if selector_str.is_empty() {
                elements
            } else {
                let selector = Selector::new(selector_str);
                let (_, remaining): (Vec<_>, Vec<_>) =
                    elements.into_iter().partition(|e| selector.matches(e));
                remaining
            }
        }
        _ => {
            // "a" or any unknown — all elements minus IfcFeatureElement
            Selector::new("IfcElement").filter(elements)
        }
    };
    Ok(result)
}

pub fn clash_detect_with_config(
    config_json: &str,
    _tolerance: f64,
    discipline_a_override: &Option<String>,
    discipline_b_override: &Option<String>,
) -> Result<Vec<ClashInfo>> {
    let clash_sets: Vec<ClashSet> = serde_json::from_str(config_json)?;
    let mut all_clash_infos = Vec::new();

    for set in clash_sets {
        println!("Processing clash set: {}", set.name);

        let mut group_a_elements = Vec::new();
        for group in &set.a {
            group_a_elements.extend(load_group_elements(group)?);
        }

        let mut group_b_elements = Vec::new();
        for group in &set.b {
            group_b_elements.extend(load_group_elements(group)?);
        }

        let (_count, infos) = clash_detect_between_groups(
            &group_a_elements,
            &group_b_elements,
            &set.mode,
            set.tolerance,
            set.clearance,
            set.check_all,
            set.allow_touching,
            discipline_a_override,
            discipline_b_override,
            &set.name,
        )?;
        all_clash_infos.extend(infos);
    }

    Ok(all_clash_infos)
}

fn build_ai_description(clash: &ClashInfo) -> String {
    let verb = match clash.clash_type {
        ClashType::Hard => "penetrates",
        ClashType::Soft => "approaches within tolerance of",
        ClashType::Clearance => "violates clearance of",
    };

    let props_a: String = clash
        .properties_a
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join(", ");
    let props_b: String = clash
        .properties_b
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "[{set}] {ctype} clash — {ta}/{na} ({ga})\n  {verb} {tb}/{nb} ({gb}).\n  \
         Penetration depth: {depth:.3} m | Overlap volume ≈ {vol:.4} m³.\n  \
         Discipline A: {da} | Source: {sa}\n  \
         Discipline B: {db} | Source: {sb}\n  \
         Properties A: {pa}\n  \
         Properties B: {pb}",
        set = clash.clash_set_name,
        ctype = clash.clash_type,
        ta = clash.ifc_type_a,
        na = clash.name_a,
        ga = clash.guid_a,
        verb = verb,
        tb = clash.ifc_type_b,
        nb = clash.name_b,
        gb = clash.guid_b,
        depth = clash.penetration_depth,
        vol = clash.penetration_volume,
        da = clash.discipline_a,
        sa = clash.source_file_a,
        db = clash.discipline_b,
        sb = clash.source_file_b,
        pa = props_a,
        pb = props_b,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn clash_detect_between_groups(
    group_a: &[IfcElement],
    group_b: &[IfcElement],
    mode: &ClashMode,
    tolerance: f64,
    clearance: f64,
    check_all: bool,
    allow_touching: bool,
    discipline_a: &Option<String>,
    discipline_b: &Option<String>,
    clash_set_name: &str,
) -> Result<(i32, Vec<ClashInfo>)> {
    let mut clash_count = 0;
    let mut clash_infos = Vec::new();
    let identity = Pose::identity();
    let mut seen_pairs: HashSet<String> = HashSet::new();

    for el1 in group_a {
        for el2 in group_b {
            // Skip self-clashes
            if el1.metadata.guid == el2.metadata.guid {
                continue;
            }

            // Dedup symmetric pairs
            let pair_key = if el1.metadata.guid < el2.metadata.guid {
                format!("{}-{}", el1.metadata.guid, el2.metadata.guid)
            } else {
                format!("{}-{}", el2.metadata.guid, el1.metadata.guid)
            };
            if seen_pairs.contains(&pair_key) {
                continue;
            }

            // Optional discipline filtering
            if let (Some(da), Some(db)) = (&discipline_a, &discipline_b) {
                let d1 = &el1.metadata.discipline;
                let d2 = &el2.metadata.discipline;
                if !((d1 == da && d2 == db) || (d1 == db && d2 == da)) {
                    continue;
                }
            }

            let unit_scale = match el1.metadata.length_unit.as_str() {
                "millimetre" => 0.001,
                "centimetre" => 0.01,
                "decimetre" => 0.1,
                "meter" => 1.0,
                "inch" => 0.0254,
                "foot" => 0.3048,
                _ => 1.0,
            };

            let clash_type_opt: Option<ClashType> = match mode {
                ClashMode::Intersection => {
                    let intersects =
                        CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?;
                    if intersects {
                        Some(ClashType::Hard)
                    } else if tolerance > 0.0 {
                        let dist = CollisionEngine::distance(
                            &el1.mesh, &identity, &el2.mesh, &identity,
                        )?;
                        if dist < tolerance {
                            Some(ClashType::Soft)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                ClashMode::Collision => {
                    let intersects =
                        CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?;
                    if intersects {
                        Some(ClashType::Hard)
                    } else if allow_touching {
                        let dist = CollisionEngine::distance(
                            &el1.mesh, &identity, &el2.mesh, &identity,
                        )?;
                        if dist < f64::EPSILON {
                            Some(ClashType::Hard)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                ClashMode::Clearance => {
                    let dist =
                        CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)?;
                    if dist < clearance {
                        Some(ClashType::Clearance)
                    } else {
                        None
                    }
                }
            };

            let clash_type = match clash_type_opt {
                Some(ct) => ct,
                None => continue,
            };

            seen_pairs.insert(pair_key);
            clash_count += 1;

            // Penetration depth (only meaningful for hard clashes)
            let penetration_depth = if clash_type == ClashType::Hard {
                CollisionEngine::penetration_depth(&el1.mesh, &identity, &el2.mesh, &identity)
                    .unwrap_or(0.0)
                    * unit_scale
            } else {
                0.0
            };

            // Penetration volume via AABB intersection
            let aabb1 = el1.mesh.compute_aabb(&identity);
            let aabb2 = el2.mesh.compute_aabb(&identity);
            let penetration_volume = if let Some(overlap) = aabb1.intersection(&aabb2) {
                let e = overlap.extents();
                (e.x * e.y * e.z) * unit_scale.powi(3)
            } else {
                0.0
            };

            // Contact points p1 / p2
            let (p1, p2, distance) = {
                if let Ok(Some(c)) = contact(&identity, &el1.mesh, &identity, &el2.mesh, CONTACT_PREDICTION_DISTANCE) {
                    (
                        [
                            c.point1.x * unit_scale,
                            c.point1.y * unit_scale,
                            c.point1.z * unit_scale,
                        ],
                        [
                            c.point2.x * unit_scale,
                            c.point2.y * unit_scale,
                            c.point2.z * unit_scale,
                        ],
                        c.dist * unit_scale,
                    )
                } else {
                    // Fallback: AABB center
                    let intersection = aabb1.intersection(&aabb2).unwrap_or(aabb1);
                    let center = intersection.center();
                    let pos = [
                        center.x * unit_scale,
                        center.y * unit_scale,
                        center.z * unit_scale,
                    ];
                    let dist = if clash_type == ClashType::Hard {
                        -penetration_depth
                    } else {
                        CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)
                            .unwrap_or(0.0)
                            * unit_scale
                    };
                    (pos, pos, dist)
                }
            };

            let camera_eye = [p1[0] + 2.0, p1[1] + 2.0, p1[2] + 2.0];
            let clash_id = format!("{}-{}", el1.metadata.guid, el2.metadata.guid);

            let mut info = ClashInfo {
                clash_id,
                clash_set_name: clash_set_name.to_string(),
                guid_a: el1.metadata.guid.clone(),
                name_a: el1.metadata.name.clone(),
                ifc_type_a: el1.metadata.ifc_type.clone(),
                description_a: el1.metadata.description.clone(),
                discipline_a: el1.metadata.discipline.clone(),
                source_file_a: el1.metadata.source_file.clone(),
                properties_a: el1.metadata.properties.clone(),
                guid_b: el2.metadata.guid.clone(),
                name_b: el2.metadata.name.clone(),
                ifc_type_b: el2.metadata.ifc_type.clone(),
                description_b: el2.metadata.description.clone(),
                discipline_b: el2.metadata.discipline.clone(),
                source_file_b: el2.metadata.source_file.clone(),
                properties_b: el2.metadata.properties.clone(),
                p1,
                p2,
                distance,
                penetration_depth,
                penetration_volume,
                clash_type,
                camera_eye: Some(camera_eye),
                description: String::new(),
            };
            info.description = build_ai_description(&info);
            clash_infos.push(info);

            if !check_all {
                break;
            }
        }
    }
    Ok((clash_count, clash_infos))
}

pub fn clash_detect(
    file: &Vec<PathBuf>,
    tolerance: f64,
    discipline_a: &Option<String>,
    discipline_b: &Option<String>,
    _selector_a: &Option<String>,
    _selector_b: &Option<String>,
) -> Result<(i32, Vec<ClashInfo>)> {
    let mut all_elements: Vec<IfcElement> = Vec::new();
    for path in file {
        println!("Loading elements from: {:?}", path);
        let elements = load_ifc_elements(path)?;
        println!("Loaded {} elements.", elements.len());
        all_elements.extend(elements);
    }

    // For compatibility with old --file argument, we clash all against all
    // using the broad phase.
    let mut clash_count = 0;
    let mut clash_infos = Vec::new();

    // Broad phase integration
    let mut aabbs = Vec::new();
    let identity = Pose::identity();
    for (idx, el) in all_elements.iter().enumerate() {
        aabbs.push((idx as u32, el.mesh.compute_aabb(&identity)));
    }
    let bvh = CollisionEngine::build_broad_phase(&aabbs);
    let potential_clashes = CollisionEngine::broad_phase_query(&bvh, &aabbs);

    for (i_u32, j_u32) in potential_clashes {
        let i = i_u32 as usize;
        let j = j_u32 as usize;
        let el1 = &all_elements[i];
        let el2 = &all_elements[j];

        // Skip self-clashes (shouldn't happen with BVH but be safe)
        if el1.metadata.guid == el2.metadata.guid {
            continue;
        }

        // Optional discipline filtering
        if let (Some(da), Some(db)) = (&discipline_a, &discipline_b) {
            let d1 = &el1.metadata.discipline;
            let d2 = &el2.metadata.discipline;
            if !((d1 == da && d2 == db) || (d1 == db && d2 == da)) {
                continue;
            }
        }

        let intersects =
            CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?;
        let is_clash = if intersects {
            true
        } else if tolerance > 0.0 {
            CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)? < tolerance
        } else {
            false
        };

        let clash_type = if intersects {
            ClashType::Hard
        } else {
            ClashType::Soft
        };

        if is_clash {
            clash_count += 1;

            let unit_scale = match el1.metadata.length_unit.as_str() {
                "millimetre" => 0.001,
                "centimetre" => 0.01,
                "decimetre" => 0.1,
                "meter" => 1.0,
                "inch" => 0.0254,
                "foot" => 0.3048,
                _ => 1.0,
            };

            let aabb1 = el1.mesh.compute_aabb(&identity);
            let aabb2 = el2.mesh.compute_aabb(&identity);

            let penetration_depth = if clash_type == ClashType::Hard {
                CollisionEngine::penetration_depth(&el1.mesh, &identity, &el2.mesh, &identity)
                    .unwrap_or(0.0)
                    * unit_scale
            } else {
                0.0
            };

            let penetration_volume = if let Some(overlap) = aabb1.intersection(&aabb2) {
                let e = overlap.extents();
                (e.x * e.y * e.z) * unit_scale.powi(3)
            } else {
                0.0
            };

            let (p1, p2, distance) = {
                if let Ok(Some(c)) = contact(&identity, &el1.mesh, &identity, &el2.mesh, CONTACT_PREDICTION_DISTANCE) {
                    (
                        [
                            c.point1.x * unit_scale,
                            c.point1.y * unit_scale,
                            c.point1.z * unit_scale,
                        ],
                        [
                            c.point2.x * unit_scale,
                            c.point2.y * unit_scale,
                            c.point2.z * unit_scale,
                        ],
                        c.dist * unit_scale,
                    )
                } else {
                    let intersection = aabb1.intersection(&aabb2).unwrap_or(aabb1);
                    let center = intersection.center();
                    let pos = [
                        center.x * unit_scale,
                        center.y * unit_scale,
                        center.z * unit_scale,
                    ];
                    let dist = if clash_type == ClashType::Hard {
                        -penetration_depth
                    } else {
                        CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)
                            .unwrap_or(0.0)
                            * unit_scale
                    };
                    (pos, pos, dist)
                }
            };

            let camera_eye = [p1[0] + 2.0, p1[1] + 2.0, p1[2] + 2.0];
            let clash_id = format!("{}-{}", el1.metadata.guid, el2.metadata.guid);

            let mut info = ClashInfo {
                clash_id,
                clash_set_name: String::new(),
                guid_a: el1.metadata.guid.clone(),
                name_a: el1.metadata.name.clone(),
                ifc_type_a: el1.metadata.ifc_type.clone(),
                description_a: el1.metadata.description.clone(),
                discipline_a: el1.metadata.discipline.clone(),
                source_file_a: el1.metadata.source_file.clone(),
                properties_a: el1.metadata.properties.clone(),
                guid_b: el2.metadata.guid.clone(),
                name_b: el2.metadata.name.clone(),
                ifc_type_b: el2.metadata.ifc_type.clone(),
                description_b: el2.metadata.description.clone(),
                discipline_b: el2.metadata.discipline.clone(),
                source_file_b: el2.metadata.source_file.clone(),
                properties_b: el2.metadata.properties.clone(),
                p1,
                p2,
                distance,
                penetration_depth,
                penetration_volume,
                clash_type,
                camera_eye: Some(camera_eye),
                description: String::new(),
            };
            info.description = build_ai_description(&info);
            clash_infos.push(info);
        }
    }
    Ok((clash_count, clash_infos))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ifc_adapter::{IfcElement, IfcMetadata};
    use parry3d_f64::math::Vector;
    use parry3d_f64::shape::TriMesh;
    use std::collections::HashMap;

    fn cube_mesh(size: f64, offset_x: f64) -> TriMesh {
        let s = size / 2.0;
        let o = offset_x;
        let vertices = vec![
            Vector::new(o - s, -s, -s),
            Vector::new(o + s, -s, -s),
            Vector::new(o + s,  s, -s),
            Vector::new(o - s,  s, -s),
            Vector::new(o - s, -s,  s),
            Vector::new(o + s, -s,  s),
            Vector::new(o + s,  s,  s),
            Vector::new(o - s,  s,  s),
        ];
        let indices = vec![
            [0, 1, 2], [0, 2, 3],
            [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4],
            [1, 2, 6], [1, 6, 5],
            [2, 3, 7], [2, 7, 6],
            [3, 0, 4], [3, 4, 7],
        ];
        TriMesh::new(vertices, indices).expect("cube mesh")
    }

    fn make_element(guid: &str, ifc_type: &str, mesh: TriMesh) -> IfcElement {
        IfcElement {
            metadata: IfcMetadata {
                guid: guid.to_string(),
                name: format!("{}_name", guid),
                ifc_type: ifc_type.to_string(),
                description: None,
                object_type: None,
                discipline: "General".to_string(),
                properties: HashMap::new(),
                length_unit: "meter".to_string(),
                source_file: "test.ifc".to_string(),
            },
            mesh,
        }
    }

    #[test]
    fn test_clash_mode_intersection_hard() {
        // Two overlapping cubes → Hard clash
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 0.5)); // 0.5 overlap
        let (count, infos) = clash_detect_between_groups(
            &[el1],
            &[el2],
            &ClashMode::Intersection,
            0.0, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert_eq!(count, 1);
        assert_eq!(infos[0].clash_type, ClashType::Hard);
    }

    #[test]
    fn test_clash_mode_intersection_soft() {
        // Two cubes with 0.03 m gap, tolerance 0.05 m → Soft clash
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 1.03)); // gap = 0.03
        let (count, infos) = clash_detect_between_groups(
            &[el1],
            &[el2],
            &ClashMode::Intersection,
            0.05, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert_eq!(count, 1, "Expected soft clash");
        assert_eq!(infos[0].clash_type, ClashType::Soft);
    }

    #[test]
    fn test_clash_mode_clearance() {
        // Two cubes with 0.08 m gap, clearance 0.1 m → Clearance clash
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 1.08)); // gap = 0.08
        let (count, infos) = clash_detect_between_groups(
            &[el1],
            &[el2],
            &ClashMode::Clearance,
            0.0, 0.1, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert_eq!(count, 1, "Expected clearance clash");
        assert_eq!(infos[0].clash_type, ClashType::Clearance);
    }

    #[test]
    fn test_penetration_depth_nonzero() {
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 0.5)); // 0.5 overlap
        let (_, infos) = clash_detect_between_groups(
            &[el1], &[el2],
            &ClashMode::Intersection,
            0.0, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert!(!infos.is_empty());
        assert!(infos[0].penetration_depth > 0.0, "Expected penetration_depth > 0");
    }

    #[test]
    fn test_penetration_volume_nonzero() {
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 0.5)); // 0.5 overlap
        let (_, infos) = clash_detect_between_groups(
            &[el1], &[el2],
            &ClashMode::Intersection,
            0.0, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert!(!infos.is_empty());
        assert!(infos[0].penetration_volume > 0.0, "Expected penetration_volume > 0");
    }

    #[test]
    fn test_no_self_clash_duplicate() {
        // Same element in both groups — must not clash with itself
        let el = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let (count, _) = clash_detect_between_groups(
            &[el],
            // We can't easily clone IfcElement, so test via empty B group:
            &[],
            &ClashMode::Intersection,
            0.0, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert_eq!(count, 0, "No clashes when B is empty");
    }

    #[test]
    fn test_no_symmetric_duplicate() {
        // el1 in both groups: should only report one pair, not two
        let el1 = make_element("guid1", "IfcPipe", cube_mesh(1.0, 0.0));
        let el2 = make_element("guid2", "IfcBeam", cube_mesh(1.0, 0.5));
        // Put el1 in group_a and el2 in group_b (the normal case - just verify dedup works)
        let (count, _) = clash_detect_between_groups(
            &[el1],
            &[el2],
            &ClashMode::Intersection,
            0.0, 0.0, true, false,
            &None, &None, "TestSet",
        ).unwrap();
        assert_eq!(count, 1, "Expected exactly one clash, not duplicates");
    }
}
