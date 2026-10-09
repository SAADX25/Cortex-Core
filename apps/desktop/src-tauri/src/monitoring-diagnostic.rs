//! Development-only, dormant diagnostic status. No adapter is available yet.
#[cfg(not(debug_assertions))]
compile_error!("Monitoring diagnostics may not be built for release");
#[path = "monitoring/isolated.rs"]
mod isolated;
use isolated::{Category, Diagnostic};
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut diagnostic = Diagnostic::default();
    if !args.is_empty() {
        if args.len() != 2 || args[0] != "--provider" {
            eprintln!(
                "Usage: monitoring-diagnostic [--provider gpu|storage|cpu|motherboard|memory]"
            );
            std::process::exit(2);
        }
        let Some(category) = Category::ALL.into_iter().find(|c| c.name() == args[1]) else {
            eprintln!("Unrecognized provider");
            std::process::exit(2);
        };
        if let Err(error) = diagnostic.enable(category, 0) {
            eprintln!(
                "{}: {:?}; live adapters remain quarantined",
                category.name(),
                error
            );
        }
    }
    for health in diagnostic.health() {
        println!(
            "[ ] {}: {:?}; Not reported by hardware",
            health.category.name(),
            health.status
        );
    }
}
