use parry3d_f64::bounding_volume::Aabb;
use parry3d_f64::math::{Isometry, Vector};
use parry3d_f64::partitioning::Qbvh;
use parry3d_f64::query::{contact, distance, intersection_test};
use parry3d_f64::shape::{Shape, TriMesh};

/// A simple stateless collision engine.
pub struct CollisionEngine;

impl CollisionEngine {
    /// Tests if two meshes intersect.
    pub fn intersect(
        mesh1: &TriMesh,
        iso1: &Isometry<f64>,
        mesh2: &TriMesh,
        iso2: &Isometry<f64>,
    ) -> anyhow::Result<bool> {
        Ok(intersection_test(iso1, mesh1, iso2, mesh2)?)
    }

    /// Calculates the minimum distance between two meshes.
    pub fn distance(
        mesh1: &TriMesh,
        iso1: &Isometry<f64>,
        mesh2: &TriMesh,
        iso2: &Isometry<f64>,
    ) -> anyhow::Result<f64> {
        Ok(distance(iso1, mesh1, iso2, mesh2)?)
    }

    /// Calculates the penetration depth between two meshes.
    /// If they don't overlap, returns 0.0.
    pub fn penetration_depth(
        mesh1: &TriMesh,
        iso1: &Isometry<f64>,
        mesh2: &TriMesh,
        iso2: &Isometry<f64>,
    ) -> anyhow::Result<f64> {
        // Broad phase check first
        if !Self::intersect(mesh1, iso1, mesh2, iso2)? {
            return Ok(0.0);
        }

        // For Trimesh vs Trimesh, parry's `contact` might return 0 if it doesn't find a good global
        // minimum translation vector. We can approximate it by looking at the distance
        // between the centers or by checking how far one mesh is inside the other's AABB.
        // However, a more reliable way for BIM is to use a small margin.
        if let Some(c) = contact(iso1, mesh1, iso2, mesh2, 1.0)? {
            if c.dist < 0.0 {
                return Ok(-c.dist);
            }
        }

        // Fallback for cases where even with margin it returns 0 (e.g. fully contained)
        let aabb1 = mesh1.compute_aabb(iso1);
        let aabb2 = mesh2.compute_aabb(iso2);
        if let Some(overlap) = aabb1.intersection(&aabb2) {
            let extents: Vector<f64> = overlap.extents();
            return Ok(extents.x.min(extents.y).min(extents.z));
        }

        Ok(0.0)
    }

    /// Checks if two meshes are "touching" (distance < threshold, but not interpenetrating).
    pub fn is_touching(
        mesh1: &TriMesh,
        iso1: &Isometry<f64>,
        mesh2: &TriMesh,
        iso2: &Isometry<f64>,
        threshold: f64,
    ) -> anyhow::Result<bool> {
        let is_intersecting = Self::intersect(mesh1, iso1, mesh2, iso2)?;
        if is_intersecting {
            return Ok(false);
        }

        let dist = Self::distance(mesh1, iso1, mesh2, iso2)?;
        Ok(dist < threshold)
    }

    /// Builds a Qbvh from a collection of AABBs.
    /// Each AABB is associated with a unique index.
    pub fn build_broad_phase(aabbs: Vec<(u32, Aabb)>) -> Qbvh<u32> {
        let mut bvh = Qbvh::new();
        bvh.clear_and_rebuild(aabbs.into_iter(), 0.01);
        bvh
    }

    /// Finds potential clashing pairs using broad-phase filtering.
    /// Returns a list of index pairs that might be clashing.
    pub fn broad_phase_query(bvh: &Qbvh<u32>) -> Vec<(u32, u32)> {
        let mut potential_clashes = Vec::new();
        let leaves: Vec<(u32, Aabb)> = bvh
            .iter_data()
            .map(|(node, data)| (*data, bvh.node_aabb(node).unwrap()))
            .collect();

        for (id1, aabb1) in leaves {
            let mut intersected_ids = Vec::new();
            bvh.intersect_aabb(&aabb1, &mut intersected_ids);
            for id2 in intersected_ids {
                if id1 < id2 {
                    potential_clashes.push((id1, id2));
                }
            }
        }
        potential_clashes
    }
}
