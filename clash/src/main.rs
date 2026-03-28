use anyhow::Result;
use clap::{Parser, Subcommand};
use clash::bcf_reporter::generate_bcf;
use clash::clash_detect_with_config;
use std::fs;
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
        /// Path to the IFC files (mutually exclusive with --clashSet)
        #[arg(short, long, required_unless_present = "clash_set")]
        file: Option<Vec<PathBuf>>,

        /// Path to the JSON clash set configuration (mutually exclusive with --file)
        #[arg(long, required_unless_present = "file")]
        clash_set: Option<PathBuf>,

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
            clash_set,
            tolerance,
            output,
            discipline_a,
            discipline_b,
        } => {
            let start_time = Instant::now();
            println!("Starting clash detection...");

            let clash_infos = if let Some(cs_path) = clash_set {
                println!("Using clash set configuration: {:?}", cs_path);
                let config_json = fs::read_to_string(cs_path)?;
                clash_detect_with_config(&config_json, tolerance, &discipline_a, &discipline_b)?
            } else if let Some(files) = file {
                println!("Files: {:?}", files);
                println!("Tolerance: {}m", tolerance);
                clash::clash_detect(
                    &files,
                    tolerance,
                    &discipline_a,
                    &discipline_b,
                    &None,
                    &None,
                )?
                .1
            } else {
                return Err(anyhow::anyhow!("Either --file or --clashSet must be provided"));
            };

            let clash_count = clash_infos.len();
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
