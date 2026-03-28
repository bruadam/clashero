use parry3d_f64::bounding_volume::Aabb;
use parry3d_f64::math::Isometry;
use parry3d_f64::partitioning::Qbvh;
use parry3d_f64::query::{distance, intersection_test};
use parry3d_f64::shape::TriMesh;

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

#[cfg(test)]
mod tests {
    use super::*;
    use parry3d_f64::math::{Point, Vector};
    use parry3d_f64::shape::{Cuboid, TriMesh};

    fn create_cube_mesh(size: f64) -> TriMesh {
        let s = size / 2.0;
        let vertices = vec![
            Point::new(-s, -s, -s),
            Point::new(s, -s, -s),
            Point::new(s, s, -s),
            Point::new(-s, s, -s),
            Point::new(-s, -s, s),
            Point::new(s, -s, s),
            Point::new(s, s, s),
            Point::new(-s, s, s),
        ];
        let indices = vec![
            [0, 1, 2],
            [0, 2, 3], // Bottom
            [4, 5, 6],
            [4, 6, 7], // Top
            [0, 1, 5],
            [0, 5, 4], // Front
            [1, 2, 6],
            [1, 6, 5], // Right
            [2, 3, 7],
            [2, 7, 6], // Back
            [3, 0, 4],
            [3, 4, 7], // Left
        ];
        TriMesh::new(vertices, indices)
    }

    #[test]
    fn test_intersecting_cubes() {
        let mesh1 = create_cube_mesh(1.0);
        let iso1 = Isometry::identity();
        let mesh2 = create_cube_mesh(1.0);
        let iso2 = Isometry::translation(0.5, 0.0, 0.0);

        let result = CollisionEngine::intersect(&mesh1, &iso1, &mesh2, &iso2).unwrap();
        assert!(result);
    }

    #[test]
    fn test_non_intersecting_cubes() {
        let mesh1 = create_cube_mesh(1.0);
        let iso1 = Isometry::identity();
        let mesh2 = create_cube_mesh(1.0);
        let iso2 = Isometry::translation(2.0, 0.0, 0.0);

        let result = CollisionEngine::intersect(&mesh1, &iso1, &mesh2, &iso2).unwrap();
        assert!(!result);

        let dist = CollisionEngine::distance(&mesh1, &iso1, &mesh2, &iso2).unwrap();
        assert_eq!(dist, 1.0);
    }

    #[test]
    fn test_primitive_cuboid_intersection() {
        let cube1 = Cuboid::new(Vector::new(0.5, 0.5, 0.5));
        let iso1 = Isometry::identity();
        let cube2 = Cuboid::new(Vector::new(0.5, 0.5, 0.5));
        let iso2 = Isometry::translation(0.5, 0.0, 0.0);

        let result = intersection_test(&iso1, &cube1, &iso2, &cube2).unwrap();
        assert!(result);
    }

    #[test]
    fn test_broad_phase_rebuild_and_query() {
        let aabbs = vec![
            (
                0,
                Aabb::new(Point::new(0.0, 0.0, 0.0), Point::new(1.0, 1.0, 1.0)),
            ),
            (
                1,
                Aabb::new(Point::new(0.5, 0.5, 0.5), Point::new(1.5, 1.5, 1.5)),
            ),
            (
                2,
                Aabb::new(Point::new(2.0, 2.0, 2.0), Point::new(3.0, 3.0, 3.0)),
            ),
        ];

        let bvh = CollisionEngine::build_broad_phase(aabbs);
        let results = CollisionEngine::broad_phase_query(&bvh);

        // Should find (0, 1) or (1, 0)
        assert!(results.contains(&(0, 1)) || results.contains(&(1, 0)));
        // Should not find (0, 2) or (2, 0)
        assert!(!results.contains(&(0, 2)) && !results.contains(&(2, 0)));
        // Should not find (1, 2) or (2, 1)
        assert!(!results.contains(&(1, 2)) && !results.contains(&(2, 1)));
    }

    #[test]
    fn test_broad_phase_performance_1000() {
        use std::time::Instant;

        let mut aabbs = Vec::new();
        for i in 0..1000 {
            let center = Point::new(i as f64 * 2.0, 0.0, 0.0);
            let half_extents = Vector::new(0.5, 0.5, 0.5);
            aabbs.push((i, Aabb::new(center - half_extents, center + half_extents)));
        }

        // Add one clashing AABB
        aabbs.push((
            1000,
            Aabb::new(Point::new(0.2, 0.2, 0.2), Point::new(0.8, 0.8, 0.8)),
        ));

        let start_build = Instant::now();
        let bvh = CollisionEngine::build_broad_phase(aabbs);
        let build_duration = start_build.elapsed();

        println!("BVH Build time for 1000 elements: {:?}", build_duration);
        assert!(
            build_duration.as_millis() < 100,
            "Build took too long: {:?}",
            build_duration
        );

        let start_query = Instant::now();
        let results = CollisionEngine::broad_phase_query(&bvh);
        let query_duration = start_query.elapsed();

        println!("BVH Query time for 1000 elements: {:?}", query_duration);
        assert!(
            query_duration.as_millis() < 10,
            "Query took too long: {:?}",
            query_duration
        );

        // Should find (0, 1000) or (1000, 0)
        assert!(results.contains(&(0, 1000)) || results.contains(&(1000, 0)));
    }
}
