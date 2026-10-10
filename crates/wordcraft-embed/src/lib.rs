//! WordCraft as an embeddable browser component.
//!
//! This crate runs the upstream [`wordcraft_ui_egui::WordApp`] (the same ribbon, dialogs, canvas
//! and engine as the desktop app and the official web build) on a `<canvas>` the host page owns,
//! and gives JavaScript a handle to drive it: load and export documents, run any command from the
//! engine's registry, read and set UI preferences, and hear about edits and saves.
//!
//! Nothing here changes how WordCraft looks or behaves; it only replaces the page shell of
//! upstream `apps/wordcraft-web` (fixed canvas id, URL flags, forced browser downloads) with an API.
//!
//! The TypeScript package in `packages/wordcraft-react` wraps this into `createWordcraft()` and the
//! `<WordcraftEditor />` React component.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![forbid(unsafe_code)]

#[cfg(target_arch = "wasm32")]
mod collab;
#[cfg(target_arch = "wasm32")]
mod web;

#[cfg(target_arch = "wasm32")]
pub use web::*;

/// Options accepted by `mount`, as JSON. Every field is optional.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct MountOptions {
    /// Force the WebGL2 backend instead of WebGPU.
    pub webgl: bool,
    /// Open the built-in sample document instead of a blank one.
    pub sample: bool,
    /// Initial UI preferences (WordCraft `UiState` JSON: `tab`, `dark`, `language`, ...).
    pub prefs: Option<serde_json::Value>,
    /// Ask before the tab closes with unsaved changes (upstream's leave-page guard).
    pub guard_unload: bool,
    /// The host keeps documents itself (it has an `onSave`): AutoSave can write through it.
    pub persist: bool,
    /// AutoSave starts on (only meaningful with `persist`).
    pub auto_save: bool,
    /// The person editing: their name signs comments and tracked changes and shows on the avatar.
    pub user_name: Option<String>,
}

impl MountOptions {
    /// Parse options leniently: unknown fields are ignored and bad JSON falls back to defaults.
    pub fn parse(json: &str) -> Self {
        let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        let flag = |k: &str| v.get(k).and_then(serde_json::Value::as_bool).unwrap_or(false);
        let renderer_webgl = v.get("renderer").and_then(serde_json::Value::as_str) == Some("webgl");
        MountOptions {
            webgl: flag("webgl") || renderer_webgl,
            sample: flag("sample"),
            prefs: v.get("prefs").filter(|p| p.is_object()).cloned(),
            guard_unload: flag("guardUnload"),
            persist: flag("persist"),
            auto_save: flag("autoSave"),
            user_name: v
                .get("user")
                .and_then(|u| u.get("name"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_string),
        }
    }
}

/// Merge `patch` (an object) into `base` (an object), field by field.
pub fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(b), Some(p)) = (base.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            b.insert(k.clone(), v.clone());
        }
    }
}

/// The file AutoSave writes for a document shown as `title`: always a format that keeps
/// everything (a `.docx` unless the document already is a Word or OpenDocument file).
pub fn autosave_name(current: Option<&str>, title: &str) -> String {
    let keeps = |n: &str| {
        let ext = n.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm" | "odt" | "rtf")
    };
    match current {
        Some(n) if keeps(n) => n.to_string(),
        Some(n) => format!("{}.docx", n.rsplit_once('.').map_or(n, |(stem, _)| stem)),
        None => format!("{}.docx", if title.trim().is_empty() { "Document1" } else { title.trim() }),
    }
}

/// The MIME type browsers expect for a file name, by extension.
pub fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("pdf") => "application/pdf",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("doc") => "application/msword",
        Some("docm") => "application/vnd.ms-word.document.macroEnabled.12",
        Some("dotx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
        Some("odt") => "application/vnd.oasis.opendocument.text",
        Some("rtf") => "application/rtf",
        Some("html" | "htm") => "text/html",
        Some("md") => "text/markdown",
        Some("txt") => "text/plain",
        Some("tex") => "application/x-tex",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_parse_leniently() {
        assert_eq!(MountOptions::parse("not json"), MountOptions::default());
        let o = MountOptions::parse(r#"{"renderer":"webgl","sample":true,"prefs":{"dark":true},"extra":1}"#);
        assert!(o.webgl && o.sample && !o.guard_unload);
        assert!(MountOptions::parse(r#"{"guardUnload":true}"#).guard_unload);
        let saving = MountOptions::parse(r#"{"persist":true,"autoSave":true,"user":{"name":"  Ada Lovelace "}}"#);
        assert!(saving.persist && saving.auto_save);
        assert_eq!(saving.user_name.as_deref(), Some("Ada Lovelace"));
        assert_eq!(MountOptions::parse(r#"{"user":{"name":"  "}}"#).user_name, None);
        assert_eq!(o.prefs, Some(serde_json::json!({"dark": true})));
        assert_eq!(MountOptions::parse(r#"{"prefs":3}"#).prefs, None);
    }

    #[test]
    fn merge_overrides_fields() {
        let mut a = serde_json::json!({"tab": "home", "dark": false});
        merge_json(&mut a, &serde_json::json!({"dark": true}));
        assert_eq!(a, serde_json::json!({"tab": "home", "dark": true}));
    }

    #[test]
    fn autosave_names_keep_everything() {
        assert_eq!(autosave_name(None, "Document1"), "Document1.docx");
        assert_eq!(autosave_name(Some("notes.md"), "notes"), "notes.docx");
        assert_eq!(autosave_name(Some("brief.odt"), "brief"), "brief.odt");
        assert_eq!(autosave_name(None, "  "), "Document1.docx");
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_for("a.DOCX"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }

    #[test]
    fn engine_round_trips_docx() {
        let doc = wordcraft_engine::sample::sample_document();
        let bytes = wordcraft_engine::io::save_bytes("x.docx", &doc).unwrap();
        let back = wordcraft_engine::io::open_bytes("x.docx", &bytes).unwrap();
        assert!(!back.plain_text(wordcraft_doc::StoryRef::Body).is_empty());
    }
}
