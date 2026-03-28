use anyhow::Result;
use clash::ifc_adapter::load_ifc_metadata;
use std::env;

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("Usage: clash <ifc_file_path>");
        return Ok(());
    }

    let path = &args[1];
    println!("Loading IFC metadata from: {}", path);

    let metadata = load_ifc_metadata(path)?;
    println!("Successfully loaded {} entities.", metadata.len());

    for (id, meta) in metadata.iter().take(10) {
        println!("#{}: {} (GUID: {})", id, meta.ifc_type, meta.guid);
    }

    if metadata.len() > 10 {
        println!("... and {} more.", metadata.len() - 10);
    }

    Ok(())
}
