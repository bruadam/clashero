use anyhow::Result;
use clap::{Parser, Subcommand};
use clash::bcf_reporter::{ClashInfo, generate_bcf};
use clash::clash_engine::CollisionEngine;
use clash::ifc_adapter::{IfcElement, load_ifc_elements};
use parry3d_f64::math::Isometry;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Detect clashes between IFC files
    Detect {
        /// Path to the IFC files
        #[arg(short, long, required = true)]
        file: Vec<PathBuf>,

        /// Tolerance for clash detection (meters)
        #[arg(short, long, default_value_t = 0.0)]
        tolerance: f64,

        /// Output path for the BCF report
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Filter discipline A
        #[arg(long)]
        discipline_a: Option<String>,

        /// Filter discipline B
        #[arg(long)]
        discipline_b: Option<String>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Detect {
            file,
            tolerance,
            output,
            discipline_a,
            discipline_b,
        } => {
            let start_time = Instant::now();
            println!("Starting clash detection...");
            println!("Files: {:?}", file);
            println!("Tolerance: {}m", tolerance);

            let mut all_elements: Vec<IfcElement> = Vec::new();
            for path in &file {
                println!("Loading elements from: {:?}", path);
                let elements = load_ifc_elements(path)?;
                println!("Loaded {} elements.", elements.len());
                all_elements.extend(elements);
            }

            let mut clash_count = 0;
            let mut clash_infos = Vec::new();
            let identity = Isometry::identity();

            // Simple O(n^2) detection for now, as broad phase integration might be in Slice 4
            // or we can use CollisionEngine's broad phase if we have many elements.
            for i in 0..all_elements.len() {
                for j in (i + 1)..all_elements.len() {
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
                        CollisionEngine::distance(&el1.mesh, &identity, &el2.mesh, &identity)?
                            < tolerance
                    } else {
                        CollisionEngine::intersect(&el1.mesh, &identity, &el2.mesh, &identity)?
                    };

                    if is_clash {
                        clash_count += 1;
                        let pos = [
                            (el1.mesh.vertices()[0].x + el2.mesh.vertices()[0].x) / 2.0,
                            (el1.mesh.vertices()[0].y + el2.mesh.vertices()[0].y) / 2.0,
                            (el1.mesh.vertices()[0].z + el2.mesh.vertices()[0].z) / 2.0,
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
                            position: pos,
                            camera_eye: Some([pos[0] + 2.0, pos[1] + 2.0, pos[2] + 2.0]),
                        });
                    }
                }
            }

            let duration = start_time.elapsed();
            println!("\nClash Detection Summary:");
            println!("------------------------");
            println!("Total Clashes: {}", clash_count);
            println!("Execution Time: {:?}", duration);

            if let Some(out) = output {
                println!("Generating BCF report: {:?}", out);
                generate_bcf(out, &clash_infos)?;
                println!("BCF report generated successfully.");
            }
        }
    }

    Ok(())
}
