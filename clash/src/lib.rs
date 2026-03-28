pub mod bcf_reporter;
pub mod clash_engine;
pub mod ifc_adapter;

use anyhow::Result;
use bcf_reporter::ClashInfo;
use clash_engine::CollisionEngine;
use ifc_adapter::{IfcElement, load_ifc_elements};
use parry3d_f64::math::Isometry;
use parry3d_f64::shape::Shape;
use std::path::PathBuf;

pub fn clash_detect(
    file: &Vec<PathBuf>,
    tolerance: f64,
    discipline_a: &Option<String>,
    discipline_b: &Option<String>,
) -> Result<(i32, Vec<ClashInfo>)> {
    let mut all_elements: Vec<IfcElement> = Vec::new();
    for path in file {
        println!("Loading elements from: {:?}", path);
        let elements = load_ifc_elements(path)?;
        println!("Loaded {} elements.", elements.len());
        all_elements.extend(elements);
    }

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
            println!("\nClash Position:");
            println!("ID={}, ID={}", el1.metadata.guid, el2.metadata.guid);
            println!("x={}, y={}, z={}", pos[0], pos[1], pos[2]);
            println!("------------------------");

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
                position: pos,
                camera_eye: Some([pos[0] + 2.0, pos[1] + 2.0, pos[2] + 2.0]),
                units: el1.metadata.length_unit.clone(),
            });
        }
    }
    Ok((clash_count, clash_infos))
}
