//! Test-only IPC stub. NO hardware imports, queries, APIs or libraries.
use std::io::{self, BufRead, Write};
fn main() {
    let category = std::env::args().nth(1).unwrap_or_default();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let mut fields = line.split_whitespace();
        let operation = fields.next().unwrap_or("");
        let id = fields.next().unwrap_or("0");
        if operation == "SAMPLE" {
            match category.as_str() {
                "storage" => {
                    println!("OK {id} mock-only");
                    io::stdout().flush().unwrap();
                    continue;
                }
                "cpu" => std::process::exit(6),
                "motherboard" => {
                    io::stdout().write_all(&vec![b'x'; 70_000]).unwrap();
                    io::stdout().flush().unwrap();
                }
                _ => {}
            }
            // Model a permanently blocked read; the parent must kill/reap this stub.
            loop {
                std::thread::park();
            }
        }
        println!("OK {id}");
        io::stdout().flush().unwrap();
        if operation == "STOP" {
            break;
        }
    }
}
