pub mod bcf_reporter;
pub mod clash_engine;
pub mod ifc_adapter;
pub mod selector;

use anyhow::Result;
use bcf_reporter::ClashInfo;
use clash_engine::CollisionEngine;
use ifc_adapter::{IfcElement, load_ifc_elements};
use parry3d_f64::math::Isometry;
use parry3d_f64::shape::Shape;
use selector::Selector;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct ClashSet {
    pub name: String,
    pub a: Vec<SelectionGroup>,
    pub b: Vec<SelectionGroup>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SelectionGroup {
    pub file: PathBuf,
    pub selector: Option<String>,
    pub mode: Option<String>,
}

pub fn clash_detect_with_config(
    config_json: &str,
    tolerance: f64,
    discipline_a_override: &Option<String>,
    discipline_b_override: &Option<String>,
) -> Result<Vec<ClashInfo>> {
    let clash_sets: Vec<ClashSet> = serde_json::from_str(config_json)?;
    let mut all_clash_infos = Vec::new();

    for set in clash_sets {
        println!("Processing clash set: {}", set.name);

        let mut group_a_elements = Vec::new();
        for group in set.a {
            let elements = load_ifc_elements(&group.file)?;
            let selector = Selector::new(group.selector.as_deref().unwrap_or(""));
            let filtered = selector.filter(elements);

            let mode = group.mode.as_deref().unwrap_or("i");
            if mode == "e" {
                // If mode is exclude, we should ideally exclude these from the already collected group_a_elements
                // or handle it per file. The PR says "The selector should be used on the file it is specified for."
                // For "e" mode on a file, it means we load the file and then exclude elements matching the selector.
                // Wait, ifclite/ifcopenshell mode:
                // "i" = include (only these)
                // "e" = exclude (everything except these)
                // Actually, ifcopenshell --include "IfcWall" means only walls.
                // --exclude "IfcWall" means everything but walls.
                // My Selector::new("!IfcWall").filter(elements) already does "everything but walls".
                // So if mode is "e", we can just negate the selector?
                // Or if selector is "IfcWall" and mode is "e", it means "exclude IfcWall".
                // So it's equivalent to selector "!IfcWall" and mode "i".
                let selector_neg =
                    Selector::new(&format!("!{}", group.selector.as_deref().unwrap_or("*")));
                group_a_elements.extend(selector_neg.filter(load_ifc_elements(&group.file)?));
            } else {
                group_a_elements.extend(filtered);
            }
        }

        let mut group_b_elements = Vec::new();
        for group in set.b {
            let elements = load_ifc_elements(&group.file)?;
            let selector = Selector::new(group.selector.as_deref().unwrap_or(""));
            let filtered = selector.filter(elements);

            let mode = group.mode.as_deref().unwrap_or("i");
            if mode == "e" {
                let selector_neg =
                    Selector::new(&format!("!{}", group.selector.as_deref().unwrap_or("*")));
                group_b_elements.extend(selector_neg.filter(load_ifc_elements(&group.file)?));
            } else {
                group_b_elements.extend(filtered);
            }
        }

        let (_count, infos) = clash_detect_between_groups(
            &group_a_elements,
            &group_b_elements,
            tolerance,
            discipline_a_override,
            discipline_b_override,
            &set.name,
        )?;
        all_clash_infos.extend(infos);
    }

    Ok(all_clash_infos)
}

pub fn clash_detect_between_groups(
    group_a: &[IfcElement],
    group_b: &[IfcElement],
    tolerance: f64,
    discipline_a: &Option<String>,
    discipline_b: &Option<String>,
    clash_set_name: &str,
) -> Result<(i32, Vec<ClashInfo>)> {
    let mut clash_count = 0;
    let mut clash_infos = Vec::new();
    let identity = Isometry::identity();

    for el1 in group_a {
        for el2 in group_b {
            // Optional discipline filtering
            if let (Some(da), Some(db)) = (&discipline_a, &discipline_b) {
                let d1 = &el1.metadata.discipline;
                let d2 = &el2.metadata.discipline;
                if !((d1 == da && d2 == db) || (d1 == db && d2 == da)) {
                    continue;
                }
            }

            let is_clash = if tolerance > 0.0 {
                CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)? < tolerance
            } else {
                CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?
            };

            if is_clash {
                clash_count += 1;
                let aabb1 = el1.mesh.compute_aabb(&identity);
                let aabb2 = el2.mesh.compute_aabb(&identity);
                let intersection = aabb1.intersection(&aabb2).unwrap_or(aabb1);
                let center = intersection.center();
                let pos = [center.x, center.y, center.z];

                let unit_scale = match el1.metadata.length_unit.as_str() {
                    "millimetre" => 0.001,
                    "centimetre" => 0.01,
                    "decimetre" => 0.1,
                    "meter" => 1.0,
                    "inch" => 0.0254,
                    "foot" => 0.3048,
                    _ => 1.0,
                };

                let normalized_pos = [
                    pos[0] * unit_scale,
                    pos[1] * unit_scale,
                    pos[2] * unit_scale,
                ];
                let camera_eye = [
                    pos[0] * unit_scale + 2.0,
                    pos[1] * unit_scale + 2.0,
                    pos[2] * unit_scale + 2.0,
                ];

                clash_infos.push(ClashInfo {
                    guid_a: el1.metadata.guid.clone(),
                    guid_b: el2.metadata.guid.clone(),
                    description: format!(
                        "[{}] Clash between {} ({}) and {} ({})",
                        clash_set_name,
                        el1.metadata.ifc_type,
                        el1.metadata.guid,
                        el2.metadata.ifc_type,
                        el2.metadata.guid
                    ),
                    position: normalized_pos,
                    camera_eye: Some(camera_eye),
                });
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
    let identity = Isometry::identity();
    for (idx, el) in all_elements.iter().enumerate() {
        aabbs.push((idx as u32, el.mesh.compute_aabb(&identity)));
    }
    let bvh = CollisionEngine::build_broad_phase(aabbs);
    let potential_clashes = CollisionEngine::broad_phase_query(&bvh);

    for (i_u32, j_u32) in potential_clashes {
        let i = i_u32 as usize;
        let j = j_u32 as usize;
        let el1 = &all_elements[i];
        let el2 = &all_elements[j];

        // Optional discipline filtering
        if let (Some(da), Some(db)) = (&discipline_a, &discipline_b) {
            let d1 = &el1.metadata.discipline;
            let d2 = &el2.metadata.discipline;
            if !((d1 == da && d2 == db) || (d1 == db && d2 == da)) {
                continue;
            }
        }

        let is_clash = if tolerance > 0.0 {
            CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)? < tolerance
        } else {
            CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?
        };

        if is_clash {
            clash_count += 1;
            let aabb1 = el1.mesh.compute_aabb(&identity);
            let aabb2 = el2.mesh.compute_aabb(&identity);
            let intersection = aabb1.intersection(&aabb2).unwrap_or(aabb1);
            let center = intersection.center();
            let pos = [center.x, center.y, center.z];

            let unit_scale = match el1.metadata.length_unit.as_str() {
                "millimetre" => 0.001,
                "centimetre" => 0.01,
                "decimetre" => 0.1,
                "meter" => 1.0,
                "inch" => 0.0254,
                "foot" => 0.3048,
                _ => 1.0,
            };

            let normalized_pos = [
                pos[0] * unit_scale,
                pos[1] * unit_scale,
                pos[2] * unit_scale,
            ];
            let camera_eye = [
                pos[0] * unit_scale + 2.0,
                pos[1] * unit_scale + 2.0,
                pos[2] * unit_scale + 2.0,
            ];

            clash_infos.push(ClashInfo {
                guid_a: el1.metadata.guid.clone(),
                guid_b: el2.metadata.guid.clone(),
                description: format!(
                    "Clash between {} ({}) and {} ({})",
                    el1.metadata.ifc_type,
                    el1.metadata.guid,
                    el2.metadata.ifc_type,
                    el2.metadata.guid
                ),
                position: normalized_pos,
                camera_eye: Some(camera_eye),
            });
        }
    }
    Ok((clash_count, clash_infos))
}
