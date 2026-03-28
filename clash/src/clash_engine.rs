use parry3d_f64::math::Isometry;
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use parry3d_f64::math::Point;
    use parry3d_f64::shape::TriMesh;

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
        let cube1 = Cuboid::new(parry3d_f64::math::Vector::new(0.5, 0.5, 0.5));
        let iso1 = Isometry::identity();
        let cube2 = Cuboid::new(parry3d_f64::math::Vector::new(0.5, 0.5, 0.5));
        let iso2 = Isometry::translation(0.5, 0.0, 0.0);

        let result = intersection_test(&iso1, &cube1, &iso2, &cube2).unwrap();
        assert!(result);
    }
}
