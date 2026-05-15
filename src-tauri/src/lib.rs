use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

const API_PORT: u16 = 3000;
const DEFAULT_AGENT_IMAGE: &str = "ottobot-agent";

#[derive(Default)]
struct ProcessRegistry {
    api: Option<ManagedChild>,
}

struct ManagedChild {
    child: Child,
    started_at_ms: u64,
    log_path: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    key: String,
    label: String,
    state: String,
    managed: bool,
    pid: Option<u32>,
    detail: String,
    checked_at_ms: u64,
    started_at_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    api: ServiceStatus,
    docker: ServiceStatus,
    agent_image: ServiceStatus,
    notes: Vec<String>,
    checked_at_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettings {
    use_default_agent_image: bool,
    agent_image: String,
    updated_at_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfig {
    active_provider: String,
    active_model: String,
    codex_oauth: CodexOAuthConfig,
    kimi_coding: KimiCodingPlan,
    updated_at_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexOAuthConfig {
    enabled: bool,
    model: String,
    reasoning_effort: String,
    approval_mode: String,
    sandbox_mode: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KimiCodingPlan {
    enabled: bool,
    provider_package: String,
    base_url: String,
    model: String,
    auth_mode: String,
    status: String,
    notes: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAuthStatus {
    available: bool,
    connected: bool,
    auth_mode: String,
    detail: String,
    codex_path: Option<String>,
    checked_at_ms: u64,
}

static PROCESSES: OnceLock<Mutex<ProcessRegistry>> = OnceLock::new();

fn process_registry() -> &'static Mutex<ProcessRegistry> {
    PROCESSES.get_or_init(|| Mutex::new(ProcessRegistry::default()))
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("desktop background task failed: {error}"))?
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn status(
    key: &str,
    label: &str,
    state: &str,
    managed: bool,
    pid: Option<u32>,
    detail: impl Into<String>,
    started_at_ms: Option<u64>,
) -> ServiceStatus {
    ServiceStatus {
        key: key.to_string(),
        label: label.to_string(),
        state: state.to_string(),
        managed,
        pid,
        detail: detail.into(),
        checked_at_ms: now_ms(),
        started_at_ms,
    }
}

fn repo_root() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("OTTOBOT_REPO_ROOT") {
        let candidate = PathBuf::from(path);
        if is_repo_root(&candidate) {
            return Ok(candidate);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        if is_repo_root(parent) {
            return Ok(parent.to_path_buf());
        }
    }

    let current = std::env::current_dir().map_err(|error| error.to_string())?;
    for candidate in [current.as_path(), current.parent().unwrap_or(current.as_path())] {
        if is_repo_root(candidate) {
            return Ok(candidate.to_path_buf());
        }
    }

    Err("Could not locate OttoBot repo root. Set OTTOBOT_REPO_ROOT.".to_string())
}

fn is_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file() && path.join("src/index.ts").is_file()
}

fn default_provider_config() -> ProviderConfig {
    ProviderConfig {
        active_provider: "codex-oauth".to_string(),
        active_model: "gpt-5.3-codex".to_string(),
        codex_oauth: CodexOAuthConfig {
            enabled: true,
            model: "gpt-5.3-codex".to_string(),
            reasoning_effort: "medium".to_string(),
            approval_mode: "on-request".to_string(),
            sandbox_mode: "workspace-write".to_string(),
        },
        kimi_coding: KimiCodingPlan {
            enabled: false,
            provider_package: "@ai-sdk/openai-compatible".to_string(),
            base_url: "https://api.kimi.com/coding/v1".to_string(),
            model: "kimi-for-coding".to_string(),
            auth_mode: "api-key".to_string(),
            status: "planned".to_string(),
            notes: vec![
                "Kimi Code membership uses the coding base URL and stable kimi-for-coding model.".to_string(),
                "Moonshot platform keys can use @ai-sdk/moonshotai with https://api.moonshot.ai/v1 and K2 models.".to_string(),
                "Wire this after the agent runtime is moved from LangGraph model construction to an AI SDK provider registry.".to_string(),
            ],
        },
        updated_at_ms: now_ms(),
    }
}

fn default_runtime_settings() -> RuntimeSettings {
    RuntimeSettings {
        use_default_agent_image: true,
        agent_image: DEFAULT_AGENT_IMAGE.to_string(),
        updated_at_ms: now_ms(),
    }
}

fn provider_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;
    Ok(dir.join("provider-config.json"))
}

fn runtime_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;
    Ok(dir.join("runtime-settings.json"))
}

fn normalize_runtime_settings(mut settings: RuntimeSettings) -> Result<RuntimeSettings, String> {
    settings.agent_image = settings.agent_image.trim().to_string();

    if settings.agent_image.is_empty() {
        settings.agent_image = DEFAULT_AGENT_IMAGE.to_string();
    }

    if !settings.use_default_agent_image && settings.agent_image.trim().is_empty() {
        return Err("agent image cannot be empty".to_string());
    }

    Ok(settings)
}

fn read_runtime_settings(app: &AppHandle) -> Result<RuntimeSettings, String> {
    let path = runtime_settings_path(app)?;

    if !path.is_file() {
        return Ok(default_runtime_settings());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read runtime settings {}: {error}", path.display()))?;
    let settings = serde_json::from_str::<RuntimeSettings>(&content)
        .map_err(|error| format!("failed to parse runtime settings {}: {error}", path.display()))?;
    normalize_runtime_settings(settings)
}

fn resolved_agent_image(settings: &RuntimeSettings) -> &str {
    if settings.use_default_agent_image {
        DEFAULT_AGENT_IMAGE
    } else {
        settings.agent_image.as_str()
    }
}

fn codex_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("CODEX_BIN") {
        candidates.push(PathBuf::from(path));
    }

    candidates.push(PathBuf::from("codex"));

    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".bun/bin/codex"));
        candidates.push(home.join(".local/bin/codex"));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));
    candidates
}

fn codex_executable() -> Option<PathBuf> {
    for candidate in codex_candidates() {
        if candidate.components().count() == 1 {
            if Command::new(&candidate)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
            {
                return Some(candidate);
            }
        } else if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn bun_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("BUN_BIN") {
        candidates.push(PathBuf::from(path));
    }

    candidates.push(PathBuf::from("bun"));

    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".bun/bin/bun"));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin/bun"));
    candidates.push(PathBuf::from("/usr/local/bin/bun"));
    candidates
}

fn bun_executable() -> Option<PathBuf> {
    for candidate in bun_candidates() {
        if candidate.components().count() == 1 {
            if Command::new(&candidate)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
            {
                return Some(candidate);
            }
        } else if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn tcp_reachable(port: u16) -> bool {
    let Ok(mut addrs) = ("127.0.0.1", port).to_socket_addrs() else {
        return false;
    };

    let Some(addr) = addrs.next() else {
        return false;
    };

    TcpStream::connect_timeout(&addr, Duration::from_millis(450)).is_ok()
}

fn command_status(key: &str, label: &str, program: &str, args: &[&str]) -> ServiceStatus {
    match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            status(
                key,
                label,
                "running",
                false,
                None,
                if stdout.is_empty() { "available".to_string() } else { stdout },
                None,
            )
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            status(
                key,
                label,
                "stopped",
                false,
                None,
                if stderr.is_empty() {
                    format!("{program} exited with {}", output.status)
                } else {
                    stderr
                },
                None,
            )
        }
        Err(error) => status(key, label, "unknown", false, None, error.to_string(), None),
    }
}

fn docker_status() -> ServiceStatus {
    command_status("docker", "Docker", "docker", &["info", "--format", "{{.ServerVersion}}"])
}

fn agent_image_status_for(image: &str) -> ServiceStatus {
    command_status(
        "agentImage",
        "Agent image",
        "docker",
        &["image", "inspect", image, "--format", "{{.Id}}"],
    )
}

fn run_repo_command<I, S>(program: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let root = repo_root()?;
    let output = Command::new(program)
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("{program} failed to start: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            stderr
        })
    }
}

fn desktop_log_dir() -> PathBuf {
    std::env::temp_dir().join("ottobot-desktop")
}

fn service_log_path(script: &str) -> PathBuf {
    desktop_log_dir().join(format!("{}.log", script.replace(':', "-")))
}

fn read_log_tail(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let tail = content
        .lines()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ");

    if tail.trim().is_empty() {
        None
    } else {
        Some(tail)
    }
}

fn build_agent_image(image: &str) -> Result<ServiceStatus, String> {
    // TODO: Replace the blocking first-run image build with a background build job
    // that streams logs into the Runtime panel and supports cancellation.
    run_repo_command(
        "docker",
        ["build", "-f", "docker/Dockerfile.agent", "-t", image, "."],
    )?;
    Ok(agent_image_status_for(image))
}

fn managed_status(
    child: &mut Option<ManagedChild>,
    key: &str,
    label: &str,
    fallback_port: Option<u16>,
) -> ServiceStatus {
    if let Some(managed) = child.as_mut() {
        match managed.child.try_wait() {
            Ok(None) => {
                return status(
                    key,
                    label,
                    "running",
                    true,
                    Some(managed.child.id()),
                    "managed by OttoBot desktop",
                    Some(managed.started_at_ms),
                );
            }
            Ok(Some(exit)) => {
                let detail = match read_log_tail(&managed.log_path) {
                    Some(tail) => format!("managed process exited with {exit}. Last logs: {tail}"),
                    None => format!("managed process exited with {exit}"),
                };
                *child = None;
                return status(key, label, "stopped", true, None, detail, None);
            }
            Err(error) => {
                return status(key, label, "error", true, None, error.to_string(), None);
            }
        }
    }

    if fallback_port.is_some_and(tcp_reachable) {
        return status(
            key,
            label,
            "running",
            false,
            None,
            "reachable but not managed by this desktop window",
            None,
        );
    }

    status(key, label, "stopped", false, None, "not running", None)
}

fn spawn_service(script: &str, agent_image: Option<&str>) -> Result<ManagedChild, String> {
    let root = repo_root()?;
    let log_dir = desktop_log_dir();
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("failed to create desktop log dir {}: {error}", log_dir.display()))?;
    let log_path = service_log_path(script);
    {
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("failed to open service log {}: {error}", log_path.display()))?;
        let _ = writeln!(log, "\n--- starting {script} at {} ---", now_ms());
    }
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("failed to open service stdout log {}: {error}", log_path.display()))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("failed to clone service log handle {}: {error}", log_path.display()))?;

    // TODO: Replace raw child-process supervision with a small process supervisor
    // that persists logs, restarts intentionally, and reports structured exit causes.
    // TODO: Consider Firecracker VM boundaries for future isolated local runtimes.
    let bun_path = bun_executable().ok_or_else(|| {
        "Bun runtime was not found. Install Bun or set BUN_BIN to the Bun executable path.".to_string()
    })?;

    let mut command = Command::new(&bun_path);
    command
        .args(["run", script])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if let Some(image) = agent_image {
        command.env("AGENT_IMAGE", image);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("failed to start {script} with {}: {error}", bun_path.display()))?;

    Ok(ManagedChild {
        child,
        started_at_ms: now_ms(),
        log_path,
    })
}

fn check_local_runtime_blocking(app: AppHandle) -> Result<RuntimeStatus, String> {
    let settings = read_runtime_settings(&app)?;
    let image = resolved_agent_image(&settings).to_string();

    let mut registry = process_registry()
        .lock()
        .map_err(|error| format!("process registry lock failed: {error}"))?;

    let api = managed_status(&mut registry.api, "api", "API", Some(API_PORT));
    let docker = docker_status();
    let agent_image = agent_image_status_for(&image);

    Ok(RuntimeStatus {
        api,
        docker,
        agent_image,
        notes: vec![
            "Docker remains the external sandbox runtime.".to_string(),
            "Create auto-prepares the API and missing first-run agent image, then boots the container directly.".to_string(),
            "TODO: Consider Firecracker VM isolation once the local cockpit loop is stable.".to_string(),
            "TODO: Add a warm Docker container pool behind ContainerRuntime before swapping Docker for another runtime.".to_string(),
        ],
        checked_at_ms: now_ms(),
    })
}

#[tauri::command]
async fn check_local_runtime(app: AppHandle) -> Result<RuntimeStatus, String> {
    run_blocking(move || check_local_runtime_blocking(app)).await
}

fn start_local_service_blocking(app: AppHandle, service: String) -> Result<ServiceStatus, String> {
    let settings = read_runtime_settings(&app)?;
    let image = resolved_agent_image(&settings).to_string();

    match service.as_str() {
        "agentImage" => return build_agent_image(&image),
        _ => {}
    }

    let mut registry = process_registry()
        .lock()
        .map_err(|error| format!("process registry lock failed: {error}"))?;

    match service.as_str() {
        "api" => {
            let current = managed_status(&mut registry.api, "api", "API", Some(API_PORT));
            if current.state == "running" {
                return Ok(current);
            }
            registry.api = Some(spawn_service("dev:api", Some(&image))?);
            std::thread::sleep(Duration::from_millis(350));
            Ok(managed_status(&mut registry.api, "api", "API", Some(API_PORT)))
        }
        _ => Err(format!("unsupported service: {service}")),
    }
}

#[tauri::command]
async fn start_local_service(app: AppHandle, service: String) -> Result<ServiceStatus, String> {
    run_blocking(move || start_local_service_blocking(app, service)).await
}

fn stop_local_service_blocking(service: String) -> Result<ServiceStatus, String> {
    let mut registry = process_registry()
        .lock()
        .map_err(|error| format!("process registry lock failed: {error}"))?;

    let (slot, key, label, fallback_port): (&mut Option<ManagedChild>, &str, &str, Option<u16>) =
        match service.as_str() {
            "api" => (&mut registry.api, "api", "API", Some(API_PORT)),
            _ => return Err(format!("unsupported service: {service}")),
        };

    if let Some(mut managed) = slot.take() {
        managed
            .child
            .kill()
            .map_err(|error| format!("failed to stop {service}: {error}"))?;
        let _ = managed.child.wait();
        return Ok(status(key, label, "stopped", true, None, "stopped", None));
    }

    Ok(managed_status(slot, key, label, fallback_port))
}

#[tauri::command]
async fn stop_local_service(service: String) -> Result<ServiceStatus, String> {
    run_blocking(move || stop_local_service_blocking(service)).await
}

#[tauri::command]
fn get_runtime_settings(app: AppHandle) -> Result<RuntimeSettings, String> {
    read_runtime_settings(&app)
}

#[tauri::command]
fn save_runtime_settings(app: AppHandle, settings: RuntimeSettings) -> Result<RuntimeSettings, String> {
    let path = runtime_settings_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("runtime settings path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create runtime settings dir {}: {error}", parent.display()))?;

    let mut settings = normalize_runtime_settings(settings)?;
    settings.updated_at_ms = now_ms();
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("failed to serialize runtime settings: {error}"))?;
    fs::write(&path, content)
        .map_err(|error| format!("failed to write runtime settings {}: {error}", path.display()))?;

    Ok(settings)
}

#[tauri::command]
fn get_provider_config(app: AppHandle) -> Result<ProviderConfig, String> {
    let path = provider_config_path(&app)?;

    if !path.is_file() {
        return Ok(default_provider_config());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read provider config {}: {error}", path.display()))?;
    serde_json::from_str::<ProviderConfig>(&content)
        .map_err(|error| format!("failed to parse provider config {}: {error}", path.display()))
}

#[tauri::command]
fn save_provider_config(app: AppHandle, mut config: ProviderConfig) -> Result<ProviderConfig, String> {
    let path = provider_config_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("provider config path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create provider config dir {}: {error}", parent.display()))?;

    config.updated_at_ms = now_ms();
    let content = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("failed to serialize provider config: {error}"))?;
    fs::write(&path, content)
        .map_err(|error| format!("failed to write provider config {}: {error}", path.display()))?;

    Ok(config)
}

#[tauri::command]
fn get_codex_auth_status() -> Result<CodexAuthStatus, String> {
    let Some(codex_path) = codex_executable() else {
        return Ok(CodexAuthStatus {
            available: false,
            connected: false,
            auth_mode: "missing".to_string(),
            detail: "Codex CLI was not found. Install @openai/codex, then run Codex OAuth setup.".to_string(),
            codex_path: None,
            checked_at_ms: now_ms(),
        });
    };

    let output = Command::new(&codex_path)
        .args(["login", "status"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("failed to check Codex login status: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stdout.is_empty() {
        stderr
    } else if stderr.is_empty() {
        stdout
    } else {
        format!("{stdout} {stderr}")
    };
    let connected = output.status.success() && detail.to_lowercase().contains("logged in");
    let auth_mode = if detail.to_lowercase().contains("chatgpt") {
        "chatgpt-oauth"
    } else if detail.to_lowercase().contains("api") {
        "api-key"
    } else if connected {
        "codex"
    } else {
        "none"
    };

    Ok(CodexAuthStatus {
        available: true,
        connected,
        auth_mode: auth_mode.to_string(),
        detail: if detail.is_empty() {
            "Codex CLI returned no status output.".to_string()
        } else {
            detail
        },
        codex_path: Some(codex_path.display().to_string()),
        checked_at_ms: now_ms(),
    })
}

#[tauri::command]
fn start_codex_oauth_setup() -> Result<CodexAuthStatus, String> {
    let codex_path = codex_executable().ok_or_else(|| {
        "Codex CLI was not found. Install it with `npm install -g @openai/codex` or make `codex` available on PATH."
            .to_string()
    })?;

    #[cfg(target_os = "macos")]
    {
        let command = format!(
            "{} login --device-auth; echo; echo 'Codex OAuth setup finished. You can close this window.'; read -r _",
            shell_quote(&codex_path.display().to_string())
        );
        Command::new("osascript")
            .args([
                "-e",
                &format!("tell application \"Terminal\" to do script {}", applescript_quote(&command)),
                "-e",
                "tell application \"Terminal\" to activate",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("failed to open Codex OAuth setup terminal: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(&codex_path)
            .args(["login", "--device-auth"])
            .spawn()
            .map_err(|error| format!("failed to start Codex OAuth setup: {error}"))?;
    }

    get_codex_auth_status()
}

#[cfg(target_os = "macos")]
fn apply_main_window_vibrancy(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_background_color(None)?;
        if let Err(error) = apply_vibrancy(
            &window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            Some(24.0),
        ) {
            eprintln!("failed to apply main window vibrancy: {error}");
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_main_window_vibrancy(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;

    WebviewWindowBuilder::from_config(app, &config)?
        .transparent(true)
        .build()?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_main_window(&app.handle())?;
            apply_main_window_vibrancy(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_local_runtime,
            start_local_service,
            stop_local_service,
            get_runtime_settings,
            save_runtime_settings,
            get_provider_config,
            save_provider_config,
            get_codex_auth_status,
            start_codex_oauth_setup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OttoBot desktop");
}
