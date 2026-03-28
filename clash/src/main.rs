use anyhow::Result;
use clap::{Parser, Subcommand};
use clash::bcf_reporter::generate_bcf;
use clash::clash_detect;
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

            let (clash_count, clash_infos) = clash_detect(&file, tolerance, &discipline_a, &discipline_b)?;

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
