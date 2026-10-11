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

use crate::collab::{CollabState, Peer, parse_color};
use crate::{MountOptions, autosave_name, document_fonts, merge_json, mime_for};

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
    /// The host keeps documents (has `onSave`), so AutoSave can write through it.
    persist: Cell<bool>,
    /// The document AutoSave was last pointed at (opening another one points it again).
    autosave_doc: Cell<u64>,
    /// A save handed over while this is set came from AutoSave (it runs in `logic`).
    in_logic: Cell<bool>,
    /// Real-time co-editing, while connected.
    collab: RefCell<Option<CollabState>>,
    on_collab_update: RefCell<Option<js_sys::Function>>,
    on_collab_cursor: RefCell<Option<js_sys::Function>>,
    /// `cb(family)` when someone picks a web font that isn't loaded yet.
    on_font_request: RefCell<Option<js_sys::Function>>,
    /// `cb(event)` for host events from the UI (`"ai"`: the AI button was clicked).
    on_host_event: RefCell<Option<js_sys::Function>>,
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
        persist: Cell::new(opts.persist),
        autosave_doc: Cell::new(u64::MAX),
        in_logic: Cell::new(false),
        collab: RefCell::new(None),
        on_collab_update: RefCell::new(None),
        on_collab_cursor: RefCell::new(None),
        on_font_request: RefCell::new(None),
        on_host_event: RefCell::new(None),
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
                // AutoSave writes only through the host's onSave (never to browser storage).
                app.autosave = opts.persist && opts.auto_save;
                if let Some(name) = &opts.user_name {
                    app.session.author = name.clone();
                }
                if let Some(p) = &opts.prefs {
                    let mut base = serde_json::to_value(app.prefs()).unwrap_or(Value::Null);
                    merge_json(&mut base, p);
                    if let Ok(ui) = serde_json::from_value::<UiState>(base) {
                        app.apply_prefs(ui);
                    }
                }
                // Open the initial document now (not on the first frame), so it is in place before
                // anything else, such as joining a co-editing session, looks at the document.
                if let (Some(name), Some(bytes)) = (initial_name, initial_bytes) {
                    let data = wordcraft_engine::cmd::insert::base64_encode(&bytes);
                    if let Err(e) = app.execute("file.open", json!({"path": name, "data": data})) {
                        log::error!("couldn't open {name}: {e}");
                    }
                    app.session.dirty = false;
                }
                point_autosave(&creator_shared, &mut app);
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

/// Point AutoSave at the current document when the host keeps documents. Upstream turns AutoSave's
/// target off whenever another document opens, so this runs again after every frame.
fn point_autosave(shared: &Shared, app: &mut WordApp) {
    let id = app.session.document_id();
    if !shared.persist.get() || shared.autosave_doc.get() == id {
        return;
    }
    shared.autosave_doc.set(id);
    let current = app.session.path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string());
    let name = autosave_name(current.as_deref(), &app.title_stem());
    app.set_autosave_target(Some(std::path::PathBuf::from(name)));
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

impl Shell {
    /// Events from WordCraft's UI meant for the page, such as the AI button being clicked.
    fn host_events(&self, app: &mut WordApp) {
        if app.host_events.is_empty() {
            return;
        }
        let events = std::mem::take(&mut app.host_events);
        let shared = self.shared.clone();
        defer(move || {
            let cb = shared.on_host_event.borrow().clone();
            if let Some(cb) = cb {
                for e in events {
                    if let Err(err) = cb.call1(&JsValue::NULL, &e.as_str().into()) {
                        log::error!("wordcraft host event handler threw: {err:?}");
                    }
                }
            }
        });
    }

    /// `cb(family, preview)`: a web font was picked (`preview` false: fetch every face), or its
    /// font-box row is on screen (`preview` true: the regular face is enough to draw its name).
    fn font_requests(&self, app: &mut WordApp) {
        if app.font_requests.is_empty() && app.font_previews.is_empty() {
            return;
        }
        let mut wanted: Vec<(String, bool)> = std::mem::take(&mut app.font_requests).into_iter().map(|f| (f, false)).collect();
        wanted.extend(std::mem::take(&mut app.font_previews).into_iter().map(|f| (f, true)));
        let shared = self.shared.clone();
        defer(move || {
            let cb = shared.on_font_request.borrow().clone();
            if let Some(cb) = cb {
                for (f, preview) in wanted {
                    if let Err(e) = cb.call2(&JsValue::NULL, &f.as_str().into(), &preview.into()) {
                        log::error!("wordcraft font request handler threw: {e:?}");
                    }
                }
            }
        });
    }

    /// Co-editing after each frame: share edits, run Undo/Redo, announce the caret, draw peers.
    fn collab_frame(&self, app: &mut WordApp, ui: &egui::Ui) {
        let Ok(mut guard) = self.shared.collab.try_borrow_mut() else { return };
        let Some(st) = guard.as_mut() else { return };
        let updates = st.after_frame(app);
        let cursor = st.cursor_change(app);
        app.collaborators = st.collaborators();
        let clip = app.canvas.canvas_rect.unwrap_or_else(|| ui.max_rect());
        st.paint(app, &ui.painter().with_clip_rect(clip));
        drop(guard);
        if updates.is_empty() && cursor.is_none() {
            return;
        }
        let shared = self.shared.clone();
        defer(move || {
            let send = shared.on_collab_update.borrow().clone();
            if let Some(send) = send {
                for u in updates {
                    if let Err(e) = send.call1(&JsValue::NULL, &js_sys::Uint8Array::from(u.as_slice())) {
                        log::error!("wordcraft collaboration update handler threw: {e:?}");
                    }
                }
            }
            let announce = shared.on_collab_cursor.borrow().clone();
            if let (Some(announce), Some(cursor)) = (announce, cursor) {
                let v = match cursor {
                    Some((a, h)) => {
                        let o = js_sys::Object::new();
                        let enc = wordcraft_engine::cmd::insert::base64_encode;
                        js_sys::Reflect::set(&o, &"anchor".into(), &enc(&a).into()).ok();
                        js_sys::Reflect::set(&o, &"head".into(), &enc(&h).into()).ok();
                        JsValue::from(o)
                    }
                    None => JsValue::NULL,
                };
                if let Err(e) = announce.call1(&JsValue::NULL, &v) {
                    log::error!("wordcraft collaboration cursor handler threw: {e:?}");
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
        // AutoSave runs inside `logic`; saves handed over meanwhile are tagged as AutoSaves.
        self.shared.in_logic.set(true);
        self.with_app(|app| app.logic(ctx));
        self.shared.in_logic.set(false);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.with_app(|app| app.raw_input_hook(raw));
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let Ok(mut guard) = self.shared.app.try_borrow_mut() else { return };
        let Some(app) = guard.as_mut() else { return };
        app.ui(ui);
        point_autosave(&self.shared, app);
        self.collab_frame(app, ui);
        self.font_requests(app);
        self.host_events(app);
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
            let reason = if save_shared.in_logic.get() { "autosave" } else { "save" };
            let shared = save_shared.clone();
            defer(move || {
                let cb = shared.on_save.borrow().clone();
                match cb {
                    Some(cb) => {
                        let file = js_sys::Object::new();
                        js_sys::Reflect::set(&file, &"name".into(), &name.as_str().into()).ok();
                        js_sys::Reflect::set(&file, &"mimeType".into(), &mime_for(&name).into()).ok();
                        js_sys::Reflect::set(&file, &"bytes".into(), &data).ok();
                        js_sys::Reflect::set(&file, &"reason".into(), &reason.into()).ok();
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

    /// Replace the document's content with another version of it (Version History's Restore),
    /// keeping its name and file, as one undoable step. `name`'s extension picks the format.
    #[wasm_bindgen(js_name = restoreContent)]
    pub fn restore_content(&self, name: &str, bytes: &[u8]) -> Result<(), JsValue> {
        let doc = wordcraft_engine::io::open_bytes(name, bytes).map_err(|e| JsValue::from_str(&e))?;
        self.with_app(|app| {
            app.session.checkpoint("Restore Version");
            app.session.doc = doc;
            app.session.touch();
            app.session.clamp_selection();
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

    /// Whether AutoSave is on (the title bar's toggle).
    #[wasm_bindgen(js_name = isAutoSaving)]
    pub fn is_auto_saving(&self) -> Result<bool, JsValue> {
        self.with_app(|app| Ok(app.autosaves()))
    }

    /// Turn AutoSave on or off, as the title bar's toggle does. It needs the host to keep
    /// documents (an `onSave` handler); without one it stays off.
    #[wasm_bindgen(js_name = setAutoSave)]
    pub fn set_auto_save(&self, on: bool) -> Result<bool, JsValue> {
        let shared = self.shared.clone();
        self.with_app(|app| {
            point_autosave(&shared, app);
            app.autosave = on && shared.persist.get();
            Ok(app.autosaves())
        })
    }

    /// Whether the host keeps documents (has an `onSave`), which AutoSave needs.
    #[wasm_bindgen(js_name = setPersist)]
    pub fn set_persist(&self, on: bool) -> Result<(), JsValue> {
        self.shared.persist.set(on);
        self.shared.autosave_doc.set(u64::MAX);
        let shared = self.shared.clone();
        self.with_app(|app| {
            if on {
                point_autosave(&shared, app);
            } else {
                app.autosave = false;
            }
            Ok(())
        })
    }

    /// The person editing, as `{"name": ...}` JSON.
    #[wasm_bindgen(js_name = getUser)]
    pub fn get_user(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(json!({"name": app.session.author}).to_string()))
    }

    /// Set the person editing: their name signs new comments and tracked changes and shows on the
    /// avatar in the title bar.
    #[wasm_bindgen(js_name = setUserName)]
    pub fn set_user_name(&self, name: &str) -> Result<(), JsValue> {
        let name = name.trim().to_string();
        self.with_app(|app| {
            if name.is_empty() {
                return Err("the user name can't be empty".into());
            }
            app.session.author = name;
            Ok(())
        })
    }

    /// Start co-editing. `state` is the shared document as one Yjs update
    /// (`Y.encodeStateAsUpdate(ydoc)`), taken after the provider has synced. When it is empty,
    /// the open document becomes the shared one (returns `true`); otherwise the shared document
    /// replaces the open one (returns `false`). From then on, Undo and Redo take back only this
    /// person's changes, as in Word.
    #[wasm_bindgen(js_name = collabStart)]
    pub fn collab_start(&self, client_id: f64, state: Option<Vec<u8>>) -> Result<bool, JsValue> {
        let mut st = CollabState::new(client_id.max(1.0) as u64);
        let collab = &self.shared.collab;
        self.with_app(|app| {
            let sel = [app.session.sel.anchor.clone(), app.session.sel.focus.clone()];
            let merged = match state.filter(|s| !s.is_empty()) {
                Some(s) => Some(st.c.apply_remote(&s, &sel).map_err(|e| e.to_string())?),
                None => None,
            };
            let seeded = match merged {
                Some((doc, sel)) if !st.c.is_empty() => {
                    CollabState::install(app, doc, sel);
                    app.session.dirty = false;
                    false
                }
                _ => {
                    st.c.seed(&app.session.doc);
                    true
                }
            };
            app.session.external_history = true;
            app.session.history_requests.clear();
            st.synced_rev = app.session.rev();
            *collab.borrow_mut() = Some(st);
            Ok(seeded)
        })
    }

    /// Apply an update from the shared document (another person's edit).
    #[wasm_bindgen(js_name = collabApply)]
    pub fn collab_apply(&self, update: &[u8]) -> Result<(), JsValue> {
        let collab = &self.shared.collab;
        self.with_app(|app| {
            let mut guard = collab.try_borrow_mut().map_err(|_| "busy".to_string())?;
            let st = guard.as_mut().ok_or("not collaborating")?;
            st.apply(app, update)
        })
    }

    /// The whole shared document as one Yjs update.
    #[wasm_bindgen(js_name = collabState)]
    pub fn collab_state(&self) -> Result<Vec<u8>, JsValue> {
        self.shared.collab.borrow().as_ref().map(|st| st.c.encode_state()).ok_or_else(|| err("not collaborating"))
    }

    /// Stop co-editing (the document stays as it is; Undo goes back to WordCraft's own history).
    #[wasm_bindgen(js_name = collabStop)]
    pub fn collab_stop(&self) -> Result<(), JsValue> {
        *self.shared.collab.borrow_mut() = None;
        self.with_app(|app| {
            app.session.external_history = false;
            app.session.history_requests.clear();
            app.collaborators.clear();
            Ok(())
        })
    }

    /// `cb(update: Uint8Array)` for each local change to send to the shared document.
    #[wasm_bindgen(js_name = setOnCollabUpdate)]
    pub fn set_on_collab_update(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_collab_update.borrow_mut() = cb;
    }

    /// `cb({anchor, head} | null)` when this person's selection moves (base64 Yjs relative
    /// positions, for awareness).
    #[wasm_bindgen(js_name = setOnCollabCursor)]
    pub fn set_on_collab_cursor(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_collab_cursor.borrow_mut() = cb;
        if let Ok(mut g) = self.shared.collab.try_borrow_mut()
            && let Some(st) = g.as_mut()
        {
            st.announced = None;
        }
        self.shared.repaint();
    }

    /// The other people here, as JSON `[{name, color?, anchor?, head?}]` (from awareness).
    #[wasm_bindgen(js_name = setPeers)]
    pub fn set_peers(&self, json: &str) -> Result<(), JsValue> {
        let v: Value = serde_json::from_str(json).map_err(|e| err(format!("peers: {e}")))?;
        let dec = |k: &str, p: &Value| p.get(k).and_then(Value::as_str).and_then(wordcraft_engine::cmd::insert::base64_decode);
        let peers = v
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|p| {
                        let name = p.get("name").and_then(Value::as_str).unwrap_or("Someone").to_string();
                        Peer {
                            color: parse_color(p.get("color").and_then(Value::as_str), &name),
                            name,
                            anchor: dec("anchor", p),
                            head: dec("head", p),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Ok(mut g) = self.shared.collab.try_borrow_mut()
            && let Some(st) = g.as_mut()
        {
            st.peers = peers;
        }
        self.shared.repaint();
        Ok(())
    }

    /// Word's mode switch: `editing`, `reviewing` (Track Changes) or `viewing` (no changes).
    #[wasm_bindgen(js_name = setMode)]
    pub fn set_mode(&self, mode: &str) -> Result<(), JsValue> {
        let mode = mode.to_string();
        self.with_app(|app| app.execute("ui.mode", json!({"mode": mode})).map(|_| ()))
    }

    /// The current mode: `editing`, `reviewing` or `viewing`.
    #[wasm_bindgen(js_name = getMode)]
    pub fn get_mode(&self) -> Result<String, JsValue> {
        self.with_app(|app| {
            Ok(if app.session.viewing {
                "viewing"
            } else if app.session.doc.settings.track_changes {
                "reviewing"
            } else {
                "editing"
            }
            .to_string())
        })
    }

    /// Commands turned off in this app (JSON array of ids, or prefixes ending in `*`). They are
    /// greyed in the ribbon and refused everywhere (shortcuts, menus, `execute`).
    #[wasm_bindgen(js_name = setDisabledCommands)]
    pub fn set_disabled_commands(&self, json: &str) -> Result<(), JsValue> {
        let list: Vec<String> = serde_json::from_str(json).map_err(|e| err(format!("disabled commands: {e}")))?;
        self.with_app(|app| {
            app.session.disabled_commands = list;
            Ok(())
        })
    }

    /// Web fonts the font box offers (JSON array of family names), fetched when picked.
    #[wasm_bindgen(js_name = setCloudFonts)]
    pub fn set_cloud_fonts(&self, json: &str) -> Result<(), JsValue> {
        let list: Vec<String> = serde_json::from_str(json).map_err(|e| err(format!("fonts: {e}")))?;
        self.with_app(|app| {
            app.cloud_fonts = list;
            Ok(())
        })
    }

    /// `cb(family)` when someone picks a web font that isn't loaded yet; answer with `addFont`.
    #[wasm_bindgen(js_name = setOnFontRequest)]
    pub fn set_on_font_request(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_font_request.borrow_mut() = cb;
    }

    /// Add a font (TTF or OTF bytes) for documents, then lay the document out again with it.
    /// Returns how many faces were added.
    #[wasm_bindgen(js_name = addFont)]
    pub fn add_font(&self, bytes: Vec<u8>) -> Result<u32, JsValue> {
        let n = wordcraft_fonts::FontDb::global().add_font(bytes);
        self.with_app(|app| {
            app.fonts_changed();
            Ok(u32::try_from(n).unwrap_or(u32::MAX))
        })
    }

    /// Every font family the document asks for, as a JSON array (to fetch web fonts it uses).
    #[wasm_bindgen(js_name = documentFonts)]
    pub fn document_fonts(&self) -> Result<String, JsValue> {
        self.with_app(|app| serde_json::to_string(&document_fonts(&app.session.doc)).map_err(|e| e.to_string()))
    }

    /// Show or hide the AI (sparkle) button beside Comments.
    #[wasm_bindgen(js_name = setAiButton)]
    pub fn set_ai_button(&self, on: bool) -> Result<(), JsValue> {
        self.with_app(|app| {
            app.ai_button = on;
            Ok(())
        })
    }

    /// Let the page keep the version history: File › Info gets Version History and clicking the
    /// title opens it, both by sending `"versions"` to the host event handler.
    #[wasm_bindgen(js_name = setVersionHistory)]
    pub fn set_version_history(&self, on: bool) -> Result<(), JsValue> {
        self.with_app(|app| {
            app.host_versions = on;
            Ok(())
        })
    }

    /// `cb(event)` for events from WordCraft's UI meant for the page: `"ai"` (the AI button) and
    /// `"versions"` (Version History).
    #[wasm_bindgen(js_name = setOnHostEvent)]
    pub fn set_on_host_event(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_host_event.borrow_mut() = cb;
    }

    /// Whether a font family is available to documents now.
    #[wasm_bindgen(js_name = hasFont)]
    pub fn has_font(&self, family: &str) -> bool {
        wordcraft_fonts::FontDb::global().has_family(family)
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
        *self.shared.on_collab_update.borrow_mut() = None;
        *self.shared.on_collab_cursor.borrow_mut() = None;
        *self.shared.on_font_request.borrow_mut() = None;
        *self.shared.on_host_event.borrow_mut() = None;
        if let Ok(mut c) = self.shared.collab.try_borrow_mut() {
            *c = None;
        }
        if let Ok(mut app) = self.shared.app.try_borrow_mut() {
            *app = None;
        }
        *self.shared.ctx.borrow_mut() = None;
        if let (Some(listener), Some(window)) = (self.shared.unload_listener.borrow_mut().take(), web_sys::window()) {
            window.remove_event_listener_with_callback("beforeunload", listener.as_ref().unchecked_ref()).ok();
        }
    }
}
