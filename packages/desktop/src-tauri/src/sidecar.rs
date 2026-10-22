//! The agent engine (packages/core) runs as a separate Node.js process.
//! Requests go to its stdin and every line it prints (JSON-RPC responses and
//! `{ event, data }` notifications) is forwarded to the web view as a single
//! Tauri event named `core`. The front end does the dispatching.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

pub struct Sidecar {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl Sidecar {
    pub fn new() -> Self {
        Sidecar { child: None, stdin: None }
    }

    /// Path of the bundled engine script (copied in as a Tauri resource).
    fn script_path(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        Ok(plain_path(dir.join("core").join("aide-core.mjs")))
    }

    pub fn start(&mut self, app: &AppHandle) -> Result<(), String> {
        let script = Self::script_path(app)?;
        let node = std::env::var("AIDE_NODE").unwrap_or_else(|_| "node".to_string());
        if std::env::var_os("AIDE_SMOKE_TEST").is_some() {
            eprintln!("starting {node} {} (exists: {})", script.display(), script.exists());
        }

        let mut cmd = Command::new(&node);
        cmd.arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "could not start the agent engine with `{node}` ({e}). AIDE_DEV needs Node.js 22 or newer on PATH (or set AIDE_NODE)."
            )
        })?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        self.stdin = child.stdin.take();
        self.child = Some(child);

        let out_app = app.clone();
        // CI sets AIDE_SMOKE_TEST to check that the installed app can find and
        // start its engine; the app exits as soon as the engine says it is ready.
        let smoke_test = std::env::var_os("AIDE_SMOKE_TEST").is_some();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(text) = line else { break };
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if smoke_test && value.get("event").and_then(|e| e.as_str()) == Some("ready") {
                        println!("smoke test: engine ready");
                        std::process::exit(0);
                    }
                    let _ = out_app.emit("core", value);
                }
            }
            let _ = out_app.emit(
                "core",
                serde_json::json!({ "event": "sidecar.stopped", "data": null }),
            );
        });

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(text) = line else { break };
                if smoke_test {
                    eprintln!("core: {text}");
                }
                log::warn!("core: {text}");
            }
        });

        Ok(())
    }

    pub fn send(&mut self, request: &serde_json::Value) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("the agent engine is not running")?;
        let mut line = request.to_string();
        line.push('\n');
        stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }

    pub fn stop(&mut self) {
        self.stdin = None;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// On Windows the resource dir comes back as `\\?\C:\...`. Node cannot start
/// a script from such a path (it fails with `EISDIR, lstat 'C:'`), so drop the
/// prefix when what follows is an ordinary drive path.
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p,
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}
