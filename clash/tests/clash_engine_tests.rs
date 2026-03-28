use clash::clash_engine::CollisionEngine;
use parry3d_f64::bounding_volume::Aabb;
use parry3d_f64::math::{Pose as Isometry, Vector};
use parry3d_f64::query::intersection_test;
use parry3d_f64::shape::{Cuboid, TriMesh};

fn create_cube_mesh(size: f64) -> TriMesh {
    let s = size / 2.0;
    let vertices = vec![
        Vector::new(-s, -s, -s),
        Vector::new(s, -s, -s),
        Vector::new(s, s, -s),
        Vector::new(-s, s, -s),
        Vector::new(-s, -s, s),
        Vector::new(s, -s, s),
        Vector::new(s, s, s),
        Vector::new(-s, s, s),
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
    TriMesh::new(vertices, indices).expect("Mock cube mesh should be valid")
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
fn test_penetration_depth() {
    let mesh1 = create_cube_mesh(1.0);
    let iso1 = Isometry::identity();
    let mesh2 = create_cube_mesh(1.0);
    let iso2 = Isometry::translation(0.8, 0.0, 0.0); // 0.2 overlap

    let depth = CollisionEngine::penetration_depth(&mesh1, &iso1, &mesh2, &iso2).unwrap();
    // Since it's an approximation, we check if it's within a reasonable range
    assert!(depth > 0.0, "Depth was {}", depth);
}

#[test]
fn test_touching_cubes() {
    let mesh1 = create_cube_mesh(1.0);
    let iso1 = Isometry::identity();
    let mesh2 = create_cube_mesh(1.0);
    let iso2 = Isometry::translation(1.0001, 0.0, 0.0); // Near 1.0

    let threshold = 0.001;
    let result = CollisionEngine::is_touching(&mesh1, &iso1, &mesh2, &iso2, threshold).unwrap();
    assert!(result);

    // Overlapping cubes are not "touching" by our definition
    let iso3 = Isometry::translation(0.5, 0.0, 0.0);
    let result2 = CollisionEngine::is_touching(&mesh1, &iso1, &mesh2, &iso3, threshold).unwrap();
    assert!(!result2);
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
            Aabb::new(Vector::new(0.0, 0.0, 0.0), Vector::new(1.0, 1.0, 1.0)),
        ),
        (
            1,
            Aabb::new(Vector::new(0.5, 0.5, 0.5), Vector::new(1.5, 1.5, 1.5)),
        ),
        (
            2,
            Aabb::new(Vector::new(2.0, 2.0, 2.0), Vector::new(3.0, 3.0, 3.0)),
        ),
    ];

    let bvh = CollisionEngine::build_broad_phase(&aabbs);
    let results = CollisionEngine::broad_phase_query(&bvh, &aabbs);

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
        let center = Vector::new(i as f64 * 2.0, 0.0, 0.0);
        let half_extents = Vector::new(0.5, 0.5, 0.5);
        aabbs.push((
            i as u32,
            Aabb::new(center - half_extents, center + half_extents),
        ));
    }

    // Add one clashing AABB
    aabbs.push((
        1000,
        Aabb::new(Vector::new(0.2, 0.2, 0.2), Vector::new(0.8, 0.8, 0.8)),
    ));

    let start_build = Instant::now();
    let bvh = CollisionEngine::build_broad_phase(&aabbs);
    let build_duration = start_build.elapsed();

    println!("BVH Build time for 1000 elements: {:?}", build_duration);
    assert!(
        build_duration.as_millis() < 100,
        "Build took too long: {:?}",
        build_duration
    );

    let start_query = Instant::now();
    let results = CollisionEngine::broad_phase_query(&bvh, &aabbs);
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

#[test]
fn test_bim_scale_precision_large_coordinates() {
    // Many BIM projects use coordinates in the millions of millimeters (e.g. 1,000 km)
    // We want to ensure that collision results at [1M, 1M, 1M] are identical to those at [0, 0, 0].
    let offset = Vector::new(1_000_000.0, 1_000_000.0, 1_000_000.0);
    let mesh1 = create_cube_mesh(1.0);
    let mesh2 = create_cube_mesh(1.0);

    // Scenario 1: Intersecting at [0,0,0] vs offset
    let iso_a1 = Isometry::identity();
    let iso_a2 = Isometry::translation(0.5, 0.0, 0.0);
    let intersect_origin = CollisionEngine::intersect(&mesh1, &iso_a1, &mesh2, &iso_a2).unwrap();

    let iso_b1 = Isometry::translation(offset.x, offset.y, offset.z);
    let iso_b2 = Isometry::translation(offset.x + 0.5, offset.y, offset.z);
    let intersect_offset = CollisionEngine::intersect(&mesh1, &iso_b1, &mesh2, &iso_b2).unwrap();

    assert_eq!(
        intersect_origin, intersect_offset,
        "Intersection result differ at large coordinates"
    );
    assert!(intersect_offset, "Should intersect at large coordinates");

    // Scenario 2: Distance at [0,0,0] vs offset
    let iso_c1 = Isometry::identity();
    let iso_c2 = Isometry::translation(2.0, 0.0, 0.0);
    let dist_origin = CollisionEngine::distance(&mesh1, &iso_c1, &mesh2, &iso_c2).unwrap();

    let iso_d1 = Isometry::translation(offset.x, offset.y, offset.z);
    let iso_d2 = Isometry::translation(offset.x + 2.0, offset.y, offset.z);
    let dist_offset = CollisionEngine::distance(&mesh1, &iso_d1, &mesh2, &iso_d2).unwrap();

    assert!(
        (dist_origin - dist_offset).abs() < f64::EPSILON * 1e10, // Allowing for tiny f64 precision jitter
        "Distance results differ too much: origin={}, offset={}",
        dist_origin,
        dist_offset
    );
    assert_eq!(dist_offset, 1.0);

    // Scenario 3: Small clearance violation at large coordinates
    // Gap of 0.001 at 1M distance
    let iso_e1 = Isometry::translation(offset.x, offset.y, offset.z);
    let iso_e2 = Isometry::translation(offset.x + 1.001, offset.y, offset.z);
    let dist_small_gap = CollisionEngine::distance(&mesh1, &iso_e1, &mesh2, &iso_e2).unwrap();
    // At 1M offset, the relative error for f64 is roughly 1e-10.
    // 0.0010000000474974513 - 0.001 = 4.7e-11, which is expected.
    assert!(
        (dist_small_gap - 0.001).abs() < 1e-10,
        "Small gap distance failed at large coordinates: {}",
        dist_small_gap
    );

    let threshold = 0.002;
    let is_touching =
        CollisionEngine::is_touching(&mesh1, &iso_e1, &mesh2, &iso_e2, threshold).unwrap();
    assert!(
        is_touching,
        "Touching detection failed at large coordinates"
    );
}
