//! The wasm-bindgen surface: `mount()` and the `WordcraftHandle` it resolves to.
//!
//! Re-entrancy: the egui frame borrows the app for the whole frame. Every callback into JavaScript
//! (`onChange`, `onSave`) is therefore deferred to a microtask, which runs after the frame has
//! returned, so a callback may call straight back into the handle.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use serde_json::{Value, json};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wordcraft_engine::Session;
use wordcraft_ui_egui::{Inbox, Services, UiState, WordApp};

use crate::{MountOptions, merge_json, mime_for};

const DOC_EXTS: &[&str] = &["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf", "txt", "md", "html", "htm", "tex", "json"];
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

type UnloadListener = Closure<dyn FnMut(web_sys::BeforeUnloadEvent)>;

/// State shared by the egui frame loop and the JavaScript handle.
struct Shared {
    app: RefCell<Option<WordApp>>,
    ctx: RefCell<Option<egui::Context>>,
    inbox: Inbox,
    on_change: RefCell<Option<js_sys::Function>>,
    on_save: RefCell<Option<js_sys::Function>>,
    last_rev: Cell<u64>,
    last_dirty: Cell<bool>,
    change_pending: Cell<bool>,
    unload_listener: RefCell<Option<UnloadListener>>,
}

impl Shared {
    fn repaint(&self) {
        if let Some(ctx) = self.ctx.borrow().as_ref() {
            ctx.request_repaint();
        }
    }
}

fn err(e: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&e.to_string()).into()
}

/// Run `f` after the current task (and so after the current egui frame) has finished.
fn defer(f: impl FnOnce() + 'static) {
    wasm_bindgen_futures::spawn_local(async move { f() });
}

/// Mount WordCraft on `canvas`. `options` is a JSON string (see [`MountOptions`]);
/// `initial_name`/`initial_bytes` optionally open a document straight away.
#[wasm_bindgen]
pub async fn mount(
    canvas: web_sys::HtmlCanvasElement,
    options: Option<String>,
    initial_name: Option<String>,
    initial_bytes: Option<Vec<u8>>,
) -> Result<WordcraftHandle, JsValue> {
    let opts = MountOptions::parse(options.as_deref().unwrap_or("{}"));
    let shared = Rc::new(Shared {
        app: RefCell::new(None),
        ctx: RefCell::new(None),
        inbox: Inbox::default(),
        on_change: RefCell::new(None),
        on_save: RefCell::new(None),
        last_rev: Cell::new(0),
        last_dirty: Cell::new(false),
        change_pending: Cell::new(false),
        unload_listener: RefCell::new(None),
    });

    let mut web_options = eframe::WebOptions::default();
    if opts.webgl
        && let eframe::egui_wgpu::WgpuSetup::CreateNew(create) = &mut web_options.wgpu_options.wgpu_setup
    {
        create.instance_descriptor.backends = eframe::wgpu::Backends::GL;
    }

    // Upstream's leave-page guard, opt-in here because the host page owns navigation.
    let guard = if opts.guard_unload {
        let dirty = Rc::new(Cell::new(false));
        match guard_unload(dirty.clone()) {
            Ok(listener) => {
                *shared.unload_listener.borrow_mut() = Some(listener);
                Some(dirty)
            }
            Err(e) => {
                log::error!("no unsaved-changes guard: {e}");
                None
            }
        }
    } else {
        None
    };

    let runner = eframe::WebRunner::new();
    let creator_shared = shared.clone();
    runner
        .start(
            canvas,
            web_options,
            Box::new(move |cc| {
                if let Some(rs) = &cc.wgpu_render_state {
                    log::info!("wordcraft-embed: wgpu backend {:?}", rs.adapter.get_info().backend);
                }
                let doc = if opts.sample { wordcraft_engine::sample::sample_document() } else { wordcraft_doc::Document::new() };
                let mut app = WordApp::new(Session::new(doc), services(&creator_shared, cc.egui_ctx.clone(), guard.clone()));
                // The host owns persistence: no autosave, no localStorage writes behind its back.
                app.autosave = false;
                if let Some(p) = &opts.prefs {
                    let mut base = serde_json::to_value(app.prefs()).unwrap_or(Value::Null);
                    merge_json(&mut base, p);
                    if let Ok(ui) = serde_json::from_value::<UiState>(base) {
                        app.apply_prefs(ui);
                    }
                }
                if let (Some(name), Some(bytes)) = (initial_name, initial_bytes) {
                    creator_shared.inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
                }
                creator_shared.last_rev.set(app.session.rev());
                *creator_shared.app.borrow_mut() = Some(app);
                *creator_shared.ctx.borrow_mut() = Some(cc.egui_ctx.clone());
                Ok(Box::new(Shell { shared: creator_shared }))
            }),
        )
        .await
        .map_err(|e| err(format!("WordCraft failed to start (a browser with WebGPU or WebGL2 is required): {e:?}")))?;

    Ok(WordcraftHandle { shared, runner })
}

/// The eframe app: borrows the shared `WordApp` for each frame and reports changes afterwards.
struct Shell {
    shared: Rc<Shared>,
}

impl Shell {
    fn with_app(&self, f: impl FnOnce(&mut WordApp)) {
        if let Ok(mut guard) = self.shared.app.try_borrow_mut()
            && let Some(app) = guard.as_mut()
        {
            f(app);
        }
    }

    /// Compare the session revision with the last one reported and schedule `onChange`.
    fn note_changes(&self, app: &mut WordApp) {
        let rev = app.session.rev();
        let dirty = app.session.dirty;
        if rev == self.shared.last_rev.get() && dirty == self.shared.last_dirty.get() {
            return;
        }
        self.shared.last_rev.set(rev);
        self.shared.last_dirty.set(dirty);
        if self.shared.change_pending.replace(true) {
            return;
        }
        let shared = self.shared.clone();
        defer(move || {
            shared.change_pending.set(false);
            let cb = shared.on_change.borrow().clone();
            if let Some(cb) = cb {
                let info = js_sys::Object::new();
                js_sys::Reflect::set(&info, &"rev".into(), &JsValue::from_f64(shared.last_rev.get() as f64)).ok();
                js_sys::Reflect::set(&info, &"dirty".into(), &JsValue::from_bool(shared.last_dirty.get())).ok();
                if let Err(e) = cb.call1(&JsValue::NULL, &info) {
                    log::error!("wordcraft onChange handler threw: {e:?}");
                }
            }
        });
    }
}

impl eframe::App for Shell {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let dropped = ctx.input_mut(|i| std::mem::take(&mut i.raw.dropped_files));
        for f in dropped {
            let inbox = self.shared.inbox.clone();
            let ctx = ctx.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let name = f.path().file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "dropped".into());
                match f.bytes_async().await {
                    Ok(bytes) => {
                        inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
                        ctx.request_repaint();
                    }
                    Err(e) => log::error!("couldn't read dropped file {name}: {e}"),
                }
            });
        }
        self.with_app(|app| app.logic(ctx));
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.with_app(|app| app.raw_input_hook(raw));
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let Ok(mut guard) = self.shared.app.try_borrow_mut() else { return };
        let Some(app) = guard.as_mut() else { return };
        app.ui(ui);
        self.note_changes(app);
    }
}

/// `guard` is the flag the optional `beforeunload` guard reads ([`guard_unload`]).
fn services(shared: &Rc<Shared>, ctx: egui::Context, guard: Option<Rc<Cell<bool>>>) -> Services {
    let open_inbox = shared.inbox.clone();
    let save_shared = shared.clone();
    Services {
        open_async: Some(Box::new(move |purpose: &str| {
            let inbox = open_inbox.clone();
            let ctx = ctx.clone();
            let dialog = if purpose == "picture" {
                rfd::AsyncFileDialog::new().add_filter("Pictures", IMAGE_EXTS)
            } else {
                rfd::AsyncFileDialog::new().add_filter("Documents", DOC_EXTS)
            };
            wasm_bindgen_futures::spawn_local(async move {
                let Some(file) = dialog.pick_file().await else { return };
                let bytes = file.read().await;
                inbox.lock().unwrap_or_else(|e| e.into_inner()).push((file.file_name(), bytes));
                ctx.request_repaint();
            });
        })),
        pick_save: Some(Box::new(|name: &str| Some(name.to_string()))),
        // Save / Save As / Export: hand the bytes to the host's onSave, or download them.
        download: Some(Box::new(move |name: &str, bytes: &[u8]| {
            let name = file_name(name);
            let data = js_sys::Uint8Array::from(bytes);
            let shared = save_shared.clone();
            defer(move || {
                let cb = shared.on_save.borrow().clone();
                match cb {
                    Some(cb) => {
                        let file = js_sys::Object::new();
                        js_sys::Reflect::set(&file, &"name".into(), &name.as_str().into()).ok();
                        js_sys::Reflect::set(&file, &"mimeType".into(), &mime_for(&name).into()).ok();
                        js_sys::Reflect::set(&file, &"bytes".into(), &data).ok();
                        if let Err(e) = cb.call1(&JsValue::NULL, &file) {
                            log::error!("wordcraft onSave handler threw: {e:?}");
                        }
                    }
                    None => {
                        if let Err(e) = download(&name, &data) {
                            log::error!("download of {name} failed: {e}");
                        }
                    }
                }
            });
            Ok(())
        })),
        print: Some(Box::new(print_pdf)),
        on_dirty: guard.map(|dirty| Box::new(move |d: bool| dirty.set(d)) as Box<dyn Fn(bool)>),
        inbox: Some(shared.inbox.clone()),
        ..Default::default()
    }
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "document".into())
}

/// Trigger a browser download of `data` named `name`.
fn download(name: &str, data: &js_sys::Uint8Array) -> Result<(), String> {
    let js = |e: JsValue| format!("{e:?}");
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let parts = js_sys::Array::of1(data);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime_for(name));
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts).map_err(js)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js)?;
    let a: web_sys::HtmlAnchorElement = document.create_element("a").map_err(js)?.dyn_into().map_err(|_| "not an anchor")?;
    a.set_href(&url);
    a.set_download(name);
    a.style().set_property("display", "none").map_err(js)?;
    let body = document.body().ok_or("no body")?;
    body.append_child(&a).map_err(js)?;
    a.click();
    a.remove();
    let revoke = Closure::once_into_js(move || {
        web_sys::Url::revoke_object_url(&url).ok();
    });
    window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), 10_000).map_err(js)?;
    Ok(())
}

/// Ask before closing or leaving the tab with unsaved changes (from upstream `apps/wordcraft-web`).
/// Returns the listener so `destroy()` can remove it.
fn guard_unload(dirty: Rc<Cell<bool>>) -> Result<UnloadListener, String> {
    let window = web_sys::window().ok_or("no window")?;
    let on_unload = Closure::<dyn FnMut(web_sys::BeforeUnloadEvent)>::new(move |e: web_sys::BeforeUnloadEvent| {
        if dirty.get() {
            e.prevent_default();
            e.set_return_value("unsaved changes");
        }
    });
    window.add_event_listener_with_callback("beforeunload", on_unload.as_ref().unchecked_ref()).map_err(|e| format!("{e:?}"))?;
    Ok(on_unload)
}

/// The hidden iframe the last print loaded its PDF into.
const PRINT_FRAME_ID: &str = "wordcraft-print-frame";

/// File › Print: load the PDF into a hidden iframe and open the browser's own print dialog on it,
/// as upstream `apps/wordcraft-web` does (no download, no popup). The previous print's iframe and
/// object URL are removed first.
fn print_pdf(bytes: &[u8]) -> Result<(), String> {
    let js = |e: JsValue| format!("{e:?}");
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    if let Some(old) = document.get_element_by_id(PRINT_FRAME_ID) {
        if let Ok(frame) = old.clone().dyn_into::<web_sys::HtmlIFrameElement>() {
            let src = frame.src();
            if src.starts_with("blob:") {
                web_sys::Url::revoke_object_url(&src).ok();
            }
        }
        old.remove();
    }
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type("application/pdf");
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts).map_err(js)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js)?;
    let iframe: web_sys::HtmlIFrameElement =
        match document.create_element("iframe").map_err(js).and_then(|e| e.dyn_into().map_err(|_| "not an iframe".to_string())) {
            Ok(f) => f,
            Err(e) => {
                web_sys::Url::revoke_object_url(&url).ok();
                return Err(e);
            }
        };
    iframe.set_id(PRINT_FRAME_ID);
    let attached = iframe
        .style()
        .set_property("display", "none")
        .map_err(js)
        .and_then(|()| document.body().ok_or_else(|| "no body".to_string()))
        .and_then(|body| body.append_child(&iframe).map_err(js));
    if let Err(e) = attached {
        iframe.remove();
        web_sys::Url::revoke_object_url(&url).ok();
        return Err(e);
    }
    // Listen before setting `src`, so a fast load can't fire first.
    let frame = iframe.clone();
    let on_load = Closure::once_into_js(move || {
        if let Some(w) = frame.content_window() {
            // Some built-in PDF viewers print fine but still report an error here.
            let _ = w.print();
        }
    });
    iframe.set_onload(Some(on_load.unchecked_ref()));
    iframe.set_src(&url);
    Ok(())
}

/// A mounted WordCraft editor.
#[wasm_bindgen]
pub struct WordcraftHandle {
    shared: Rc<Shared>,
    runner: eframe::WebRunner,
}

#[wasm_bindgen]
impl WordcraftHandle {
    fn with_app<T>(&self, f: impl FnOnce(&mut WordApp) -> Result<T, String>) -> Result<T, JsValue> {
        let mut guard = self.shared.app.try_borrow_mut().map_err(|_| err("WordCraft is busy (called from inside a frame)"))?;
        let app = guard.as_mut().ok_or_else(|| err("WordCraft has been destroyed"))?;
        let r = f(app).map_err(err);
        drop(guard);
        self.shared.repaint();
        r
    }

    /// Open a document from bytes; the file name's extension picks the format
    /// (docx, docm, dotx, dotm, odt, rtf, md, html, txt, tex, json).
    pub fn load(&self, name: &str, bytes: &[u8]) -> Result<(), JsValue> {
        let data = wordcraft_engine::cmd::insert::base64_encode(bytes);
        self.with_app(|app| {
            app.run("file.open", json!({"path": name, "data": data}))?;
            app.ui.backstage = false;
            Ok(())
        })
    }

    /// Start a new blank document (Word's File › New › Blank document).
    #[wasm_bindgen(js_name = newDocument)]
    pub fn new_document(&self) -> Result<(), JsValue> {
        self.with_app(|app| {
            app.session.set_document(wordcraft_doc::Document::new());
            app.session.path = None;
            app.session.dirty = false;
            app.session.reset_history();
            Ok(())
        })
    }

    /// Serialise the current document. The extension of `name` picks the format
    /// (docx, docm, dotx, odt, rtf, md, html, txt, tex, json, pdf, png).
    pub fn export(&self, name: &str) -> Result<Vec<u8>, JsValue> {
        self.with_app(|app| wordcraft_engine::io::save_bytes(name, &app.session.doc))
    }

    /// Run a command by id with JSON params; returns the result as JSON.
    /// `commands()` lists every id. UI commands (`ui.*`) work too.
    pub fn execute(&self, id: &str, params: Option<String>) -> Result<String, JsValue> {
        let params: Value = match params.as_deref() {
            None | Some("") => json!({}),
            Some(s) => serde_json::from_str(s).map_err(|e| err(format!("params: {e}")))?,
        };
        self.with_app(|app| app.run(id, params)).map(|v| v.to_string())
    }

    /// Every engine command with its label, ribbon location, shortcut and params doc, as JSON.
    pub fn commands(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(app.session.registry.describe().to_string()))
    }

    /// The body text of the document.
    #[wasm_bindgen(js_name = getText)]
    pub fn get_text(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(app.session.doc.plain_text(wordcraft_doc::StoryRef::Body)))
    }

    /// The selected text.
    #[wasm_bindgen(js_name = getSelectedText)]
    pub fn get_selected_text(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(app.session.selected_text()))
    }

    /// The document title shown in the title bar.
    pub fn title(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(app.title_stem()))
    }

    /// Edit revision; rises on every change.
    pub fn rev(&self) -> Result<f64, JsValue> {
        self.with_app(|app| Ok(app.session.rev() as f64))
    }

    /// Unsaved changes?
    #[wasm_bindgen(js_name = isDirty)]
    pub fn is_dirty(&self) -> Result<bool, JsValue> {
        self.with_app(|app| Ok(app.session.dirty))
    }

    /// Tell WordCraft the host has saved the document.
    #[wasm_bindgen(js_name = markSaved)]
    pub fn mark_saved(&self) -> Result<(), JsValue> {
        self.with_app(|app| {
            app.session.dirty = false;
            Ok(())
        })
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> Result<bool, JsValue> {
        self.with_app(|app| Ok(app.session.can_undo()))
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> Result<bool, JsValue> {
        self.with_app(|app| Ok(app.session.can_redo()))
    }

    /// UI preferences (ribbon tab, dark mode, language, ...) as JSON.
    #[wasm_bindgen(js_name = getPrefs)]
    pub fn get_prefs(&self) -> Result<String, JsValue> {
        self.with_app(|app| serde_json::to_string(&app.prefs()).map_err(|e| e.to_string()))
    }

    /// Merge the given JSON object into the UI preferences.
    #[wasm_bindgen(js_name = setPrefs)]
    pub fn set_prefs(&self, patch: &str) -> Result<(), JsValue> {
        let patch: Value = serde_json::from_str(patch).map_err(|e| err(format!("prefs: {e}")))?;
        self.with_app(|app| {
            let mut base = serde_json::to_value(app.prefs()).map_err(|e| e.to_string())?;
            merge_json(&mut base, &patch);
            let ui: UiState = serde_json::from_value(base).map_err(|e| e.to_string())?;
            app.apply_prefs(ui);
            Ok(())
        })
    }

    /// `cb({ rev, dirty })` after edits (coalesced, at most once per frame). `null` removes it.
    #[wasm_bindgen(js_name = setOnChange)]
    pub fn set_on_change(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_change.borrow_mut() = cb;
    }

    /// `cb({ name, mimeType, bytes })` when the user saves or exports from WordCraft's own UI.
    /// Without a handler the browser downloads the file, as in the official web build.
    #[wasm_bindgen(js_name = setOnSave)]
    pub fn set_on_save(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_save.borrow_mut() = cb;
    }

    /// Did the editor hit an unrecoverable error? (It then stops drawing.)
    #[wasm_bindgen(js_name = hasPanicked)]
    pub fn has_panicked(&self) -> bool {
        self.runner.has_panicked()
    }

    /// Stop the editor and release the canvas, GPU and event listeners.
    pub fn destroy(&self) {
        self.runner.destroy();
        *self.shared.on_change.borrow_mut() = None;
        *self.shared.on_save.borrow_mut() = None;
        if let Ok(mut app) = self.shared.app.try_borrow_mut() {
            *app = None;
        }
        *self.shared.ctx.borrow_mut() = None;
        if let (Some(listener), Some(window)) = (self.shared.unload_listener.borrow_mut().take(), web_sys::window()) {
            window.remove_event_listener_with_callback("beforeunload", listener.as_ref().unchecked_ref()).ok();
        }
    }
}
