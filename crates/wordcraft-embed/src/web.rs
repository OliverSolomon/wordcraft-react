//! The wasm-bindgen surface: `mount()` and the `WordcraftHandle` it resolves to.
//!
//! Re-entrancy: the egui frame borrows the app for the whole frame. Every callback into JavaScript
//! (`onChange`, `onSave`) is therefore deferred to a microtask, which runs after the frame has
//! returned, so a callback may call straight back into the handle.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use craft::host::{FileError, Files, Host, PendingPick, PickId, PickRequest, Picked, Wake, WriteIntent};
use craft::platform::appearance::SystemReader;
use craft::platform::browser_files::BrowserFiles;
use craft::platform::clipboard::{Clipboard, ClipboardError, EventClipboard, Flavor, LateOffers, TEXT};
use craft::platform::open::{DroppedFile, FileIntake, IntakeSender};
use craft::print::spool::Spool;
use craft::ui::InstallSpec;
use craft::ui::shell::embed;
use craft::window::system::NoWindows;
use serde_json::{Value, json};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wordcraft_engine::Session;
use wordcraft_ui_egui::embed::Embed;
use wordcraft_ui_egui::prefs::Prefs;
use wordcraft_ui_egui::{Services, WordApp};

use crate::collab::{CollabState, Peer, parse_color};
use crate::doc_tools::{Mark, body_offset, comments_json, marks_at, paragraphs_json, parse_marks, pos_at, selected_object};
use crate::touch_web::TouchState;
use crate::{MountOptions, autosave_name, document_fonts, merge_json, mime_for};

type UnloadListener = Closure<dyn FnMut(web_sys::BeforeUnloadEvent)>;

/// State shared by the egui frame loop and the JavaScript handle.
struct Shared {
    app: RefCell<Option<WordApp>>,
    ctx: RefCell<Option<egui::Context>>,
    /// Dropped files, read asynchronously, go to the app through this.
    intake: RefCell<Option<IntakeSender>>,
    /// This editor's key in [`EDITORS`], for its files layer.
    key: u64,
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
    /// Touch gestures on the page and the selection handles.
    touch: RefCell<TouchState>,
    /// `cb(info)` when the selection, its place on screen or the contextual tabs change.
    on_selection: RefCell<Option<js_sys::Function>>,
    /// The host's marks over the text (writing checks, originality), drawn every frame.
    marks: RefCell<Vec<Mark>>,
    /// The collaborator being followed: their caret is kept in view until the person moves.
    follow: RefCell<Option<String>>,
}

impl Shared {
    fn repaint(&self) {
        if let Some(ctx) = self.ctx.borrow().as_ref() {
            ctx.request_repaint();
        }
    }
}

thread_local! {
    /// The mounted editors by key, for their files layer: `Files` must be `Send + Sync`, which the
    /// editor's shared state is not. The browser runs everything on one thread.
    static EDITORS: RefCell<HashMap<u64, std::rc::Weak<Shared>>> = RefCell::new(HashMap::new());
    static NEXT_KEY: Cell<u64> = const { Cell::new(1) };
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
    let key = NEXT_KEY.with(|k| {
        let key = k.get();
        k.set(key + 1);
        key
    });
    let shared = Rc::new(Shared {
        app: RefCell::new(None),
        ctx: RefCell::new(None),
        intake: RefCell::new(None),
        key,
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
        touch: RefCell::new(TouchState::default()),
        on_selection: RefCell::new(None),
        marks: RefCell::new(Vec::new()),
        follow: RefCell::new(None),
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

    EDITORS.with(|e| e.borrow_mut().insert(key, Rc::downgrade(&shared)));
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
                let ctx = cc.egui_ctx.clone();
                // The clipboard: the browser's paste event feeds it; a pasted picture (read
                // asynchronously) arrives as a late offer. As upstream's web app.
                let frame_ctx = ctx.clone();
                let copy_ctx = ctx.clone();
                let event_clipboard =
                    EventClipboard::new(move || frame_ctx.cumulative_frame_nr(), move |flavors| copy_out(&copy_ctx, flavors)).with_wake(waker(&ctx));
                if let Err(e) = listen_for_pasted_pictures(event_clipboard.late_offers()) {
                    log::error!("pasting pictures is unavailable: {e}");
                }
                let region = wordcraft_ui_egui::i18n::system_region();
                let lang = wordcraft_ui_egui::i18n::Lang::from_pref(&Prefs::default().language);
                let spec = InstallSpec::new(craft::host::target::ShellInfo::current(), Arc::new(NoWindows))
                    .app_id("wordcraft")
                    .system(SystemReader::start(waker(&ctx)))
                    .clipboard(Clipboard::new(event_clipboard));
                if let Err(e) = embed::install(&ctx, spec, &wordcraft_ui_egui::ui_fonts(lang)) {
                    log::error!("wordcraft-embed: the UI runtime did not install: {e:?}");
                }
                // Files: the browser's pickers; saves go to the page's onSave, or download.
                let browser = Arc::new(BrowserFiles::new(waker(&ctx)));
                let files: Arc<dyn Files> = Arc::new(EmbedFiles::new(browser, creator_shared.key));
                let host = Arc::new(
                    Host::builder(wordcraft_ui_egui::APP).i18n(wordcraft_ui_egui::i18n::catalogs()).files(files).lang(lang.craft_lang()).build(),
                );
                let (intake, sender) = FileIntake::new(Wake::new(waker(&ctx)));
                *creator_shared.intake.borrow_mut() = Some(sender);
                let doc = if opts.sample { wordcraft_engine::sample::sample_document() } else { wordcraft_engine::blank_document(&region) };
                let mut session = Session::new(doc);
                session.system_region = region;
                let services = Services {
                    print: Some(Spool::new(host.jobs_shared().clone())),
                    intake: Some(intake),
                    on_dirty: guard.clone().map(|dirty| Box::new(move |d: bool| dirty.set(d)) as Box<dyn Fn(bool)>),
                    ..Default::default()
                };
                let mut app = WordApp::new(session, services).with_host(host);
                // AutoSave writes only through the host's onSave (never to browser storage).
                app.autosave = opts.persist && opts.auto_save;
                if let Some(name) = &opts.user_name {
                    app.session.author = name.clone();
                }
                if let Some(p) = &opts.prefs
                    && let Err(e) = apply_prefs(&mut app, p)
                {
                    log::warn!("prefs: {e}");
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
    /// Selection handles, and the selection reported to the host when it changed.
    fn touch_frame(&self, app: &mut WordApp, ctx: &egui::Context) {
        let Ok(mut touch) = self.shared.touch.try_borrow_mut() else { return };
        paint_marks(app, ctx, &self.shared.marks.borrow());
        touch.paint(app, ctx);
        // Following someone: keep their caret in view, until this person scrolls, clicks or types.
        if touch.user_input {
            self.shared.follow.borrow_mut().take();
        }
        let following = self.shared.follow.borrow().clone();
        if let Some(name) = &following
            && let Some(delta) = self.follow_delta(app, name)
        {
            touch.scroll_by(delta);
            ctx.request_repaint();
        }
        if self.shared.on_selection.borrow().is_none() {
            return;
        }
        let marks = self.shared.marks.borrow();
        let under: Vec<&str> = marks_at(&marks, &app.session.sel.focus);
        let extra = json!({"marks": under, "following": following});
        drop(marks);
        let Some(info) = touch.report(app, Some(ctx.content_rect()), &extra) else { return };
        drop(touch);
        let shared = self.shared.clone();
        defer(move || {
            let cb = shared.on_selection.borrow().clone();
            if let (Some(cb), Ok(v)) = (cb, js_sys::JSON::parse(&info))
                && let Err(e) = cb.call1(&JsValue::NULL, &v)
            {
                log::error!("wordcraft selection handler threw: {e:?}");
            }
        });
    }

    /// How far to scroll so the followed person's caret sits in the middle third of the page.
    fn follow_delta(&self, app: &mut WordApp, name: &str) -> Option<egui::Vec2> {
        let head = self.shared.collab.try_borrow().ok()?.as_ref()?.peer_head(name)?;
        let layout = app.session.layout();
        let c = layout.caret_on(&head, app.session.page_hint)?;
        let at = wordcraft_ui_egui::canvas::page_to_screen(app, c.page, c.x, c.top)?;
        let area = app.canvas.canvas_rect()?;
        let band = (area.top() + area.height() / 3.0)..(area.bottom() - area.height() / 3.0);
        if band.contains(&at.y) {
            return None;
        }
        // Positive scroll moves the content down: bring `at` to the centre.
        Some(egui::vec2(0.0, area.center().y - at.y))
    }

    /// Events from WordCraft's UI meant for the page, such as the AI button being clicked.
    fn host_events(&self, app: &mut WordApp) {
        if app.embed.host_events.is_empty() {
            return;
        }
        let events = std::mem::take(&mut app.embed.host_events);
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
        if app.embed.font_requests.is_empty() && app.embed.font_previews.is_empty() {
            return;
        }
        let mut wanted: Vec<(String, bool)> = std::mem::take(&mut app.embed.font_requests).into_iter().map(|f| (f, false)).collect();
        wanted.extend(std::mem::take(&mut app.embed.font_previews).into_iter().map(|f| (f, true)));
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
        app.embed.collaborators = st.collaborators();
        let clip = app.canvas.canvas_rect().unwrap_or_else(|| ui.max_rect());
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
        // AutoSave runs inside `logic`; saves handed over meanwhile are tagged as AutoSaves.
        self.shared.in_logic.set(true);
        self.with_app(|app| app.logic(ctx));
        self.shared.in_logic.set(false);
    }

    /// Dropped files are read asynchronously into the intake (browsers can't read them at once),
    /// touch gestures become pointer input, then the UI runtime gets the frame's input.
    fn raw_input_hook(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput) {
        let sender = self.shared.intake.borrow().clone();
        for f in std::mem::take(&mut raw.dropped_files) {
            let Some(sender) = sender.clone() else { continue };
            wasm_bindgen_futures::spawn_local(async move {
                let name = f.path().file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "dropped".into());
                match f.bytes_async().await {
                    Ok(bytes) => sender.dropped(vec![DroppedFile { path: None, name, bytes: Some(Arc::from(bytes)) }]),
                    Err(e) => log::error!("couldn't read dropped file {name}: {e}"),
                }
            });
        }
        let shared = self.shared.clone();
        self.with_app(|app| {
            if let Ok(mut touch) = shared.touch.try_borrow_mut() {
                touch.input(ctx, raw, app);
            }
            embed::before_input(ctx, |out| app.frame_input(out));
        });
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let Ok(mut guard) = self.shared.app.try_borrow_mut() else { return };
        let Some(app) = guard.as_mut() else { return };
        fit_web_layout(app);
        app.ui(ui);
        point_autosave(&self.shared, app);
        self.collab_frame(app, ui);
        self.touch_frame(app, ui.ctx());
        self.font_requests(app);
        self.host_events(app);
        self.note_changes(app);
    }
}

/// The host's marks: squiggles under the text (writing checks) or highlights (originality).
fn paint_marks(app: &mut WordApp, ctx: &egui::Context, marks: &[Mark]) {
    if marks.is_empty() {
        return;
    }
    let Some(clip) = app.canvas.canvas_rect() else { return };
    let painter = ctx.layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::unique("wordcraft-host-marks"))).with_clip_rect(clip);
    let layout = app.session.layout();
    let hint = app.session.page_hint;
    for m in marks {
        let color = egui::Color32::from_rgb(m.color[0], m.color[1], m.color[2]);
        for (page, r) in layout.selection_rects(&app.session.doc, &m.start, &m.end, hint) {
            let (Some(a), Some(b)) = (
                wordcraft_ui_egui::canvas::page_to_screen(app, page, r.x, r.y),
                wordcraft_ui_egui::canvas::page_to_screen(app, page, r.x + r.w, r.y + r.h),
            ) else {
                continue;
            };
            let rect = egui::Rect::from_two_pos(a, b);
            if !rect.intersects(clip) {
                continue;
            }
            if m.squiggle {
                // A wavy line along the bottom of the text, as spelling marks are drawn.
                let y = rect.bottom() - 1.0;
                let mut pts = Vec::new();
                let mut x = rect.left();
                let mut up = true;
                while x <= rect.right() {
                    pts.push(egui::pos2(x, if up { y - 1.5 } else { y + 0.5 }));
                    x += 2.5;
                    up = !up;
                }
                if pts.len() > 1 {
                    painter.add(egui::Shape::line(pts, egui::Stroke::new(1.3, color)));
                }
            } else {
                painter.rect_filled(rect, 0.0, color.gamma_multiply(0.28));
            }
        }
    }
}

/// Web Layout (and Draft and Outline) as wide as the window, as in Word: on a phone that is Mobile
/// View, the text reflowed to the screen. Upstream lays them out 800pt wide whatever the window.
fn fit_web_layout(app: &mut WordApp) {
    use wordcraft_layout::ViewMode;
    if app.session.view.mode == ViewMode::Print {
        return;
    }
    let Some(area) = app.canvas.canvas_rect() else { return };
    // The canvas keeps 14 points for its scroll bar and an 18-point gap each side of the page.
    let scale = app.session.view.zoom.clamp(0.1, 5.0) * wordcraft_ui_egui::canvas::PX_PER_PT;
    let width = ((area.width() - 14.0 - 36.0) / scale).max(144.0).round();
    if width.is_finite() && (app.session.view.web_width - width).abs() >= 1.0 {
        app.session.view.web_width = width;
    }
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

    /// Run one of the host's own comment commands. Unlike `execute`, the commands the host turned
    /// off (`disabledCommands`) don't apply: a host that turns off WordCraft's comment buttons
    /// still writes comments through its own panel. Viewing mode and Restrict Editing still do.
    #[wasm_bindgen(js_name = executeHost)]
    pub fn execute_host(&self, id: &str, params: Option<String>) -> Result<String, JsValue> {
        const HOST: [&str; 8] = [
            "review.newComment",
            "review.reply",
            "review.editComment",
            "review.deleteComment",
            "review.resolveComment",
            "select.range",
            "format.state",
            "view.state",
        ];
        if !HOST.contains(&id) {
            return Err(err(format!("{id} is not a host command")));
        }
        let params: Value = match params.as_deref() {
            None | Some("") => json!({}),
            Some(s) => serde_json::from_str(s).map_err(|e| err(format!("params: {e}")))?,
        };
        self.with_app(|app| {
            let off = std::mem::take(&mut app.session.disabled_commands);
            let out = app.run(id, params);
            app.session.disabled_commands = off;
            out
        })
        .map(|v| v.to_string())
    }

    /// The paragraph at the caret for a host toolbar: `{align, bullets, numbering, collapsed}`.
    /// `align` is as seen on the page (`left`, `center`, `right`, `justify`).
    #[wasm_bindgen(js_name = paraState)]
    pub fn para_state(&self) -> Result<String, JsValue> {
        use wordcraft_doc::props::Align;
        self.with_app(|app| {
            let s = &app.session;
            let rp = s.doc.para_at(&s.sel.focus).map(|p| s.doc.styles.resolve_para(&p.props));
            let align = match rp.as_ref().map(|r| r.align.visual(r.bidi)).unwrap_or_default() {
                Align::Left => "left",
                Align::Center => "center",
                Align::Right => "right",
                Align::Justify | Align::Distribute => "justify",
            };
            let lists = wordcraft_engine::cmd::para::list_buttons(&s.doc, rp.as_ref().and_then(|r| r.numbering));
            Ok(json!({"align": align, "bullets": lists.bullets, "numbering": lists.numbering, "collapsed": s.sel.anchor == s.sel.focus}).to_string())
        })
    }

    /// Why command `id` can't run now, or an empty string when it can (turned off, Viewing mode,
    /// or the command's own state).
    #[wasm_bindgen(js_name = whyNot)]
    pub fn why_not(&self, id: &str) -> Result<String, JsValue> {
        self.with_app(|app| {
            let s = &app.session;
            let Some(spec) = s.registry.get(id) else { return Ok("unknown command".into()) };
            Ok(s.host_block(id, spec.mutates).or_else(|| (spec.enabled)(s)).unwrap_or_default().to_string())
        })
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
        self.with_app(|app| prefs_json(app).map(|v| v.to_string()))
    }

    /// Merge the given JSON object into the UI preferences.
    #[wasm_bindgen(js_name = setPrefs)]
    pub fn set_prefs(&self, patch: &str) -> Result<(), JsValue> {
        let patch: Value = serde_json::from_str(patch).map_err(|e| err(format!("prefs: {e}")))?;
        self.with_app(|app| apply_prefs(app, &patch))
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
            app.embed.collaborators.clear();
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
            app.embed.cloud_fonts = list;
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
        // Into the font database documents lay out with, and the catalog the font box lists.
        let catalog = craft::font_manager::Catalog::global().add_bytes(bytes.clone(), craft::font_manager::Source::User, &Default::default());
        if let Err(e) = catalog {
            log::warn!("the font box won't list an added font: {e}");
        }
        let n = wordcraft_fonts::FontDb::global().add_document_fonts(vec![(bytes, String::new())]);
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
            app.embed.ai_button = on;
            Ok(())
        })
    }

    /// Let the page keep the version history: File › Info gets Version History and clicking the
    /// title opens it, both by sending `"versions"` to the host event handler.
    #[wasm_bindgen(js_name = setVersionHistory)]
    pub fn set_version_history(&self, on: bool) -> Result<(), JsValue> {
        self.with_app(|app| {
            app.embed.host_versions = on;
            Ok(())
        })
    }

    /// `cb(event)` for events from WordCraft's UI meant for the page: `"ai"` (the AI button) and
    /// `"versions"` (Version History).
    #[wasm_bindgen(js_name = setOnHostEvent)]
    pub fn set_on_host_event(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_host_event.borrow_mut() = cb;
    }

    /// Touch gestures on the page (on by default): drag to scroll, tap for the caret, long-press
    /// to select a word, handles to change the selection, pinch to zoom.
    #[wasm_bindgen(js_name = setTouch)]
    pub fn set_touch(&self, on: bool) {
        if let Ok(mut t) = self.shared.touch.try_borrow_mut() {
            t.on = on;
            if !on {
                t.reset();
            }
        }
        self.shared.repaint();
    }

    /// `cb(info)` when the selection, where it sits on screen, or the contextual tabs change.
    /// `info` is `selectionInfo()` as an object.
    #[wasm_bindgen(js_name = setOnSelection)]
    pub fn set_on_selection(&self, cb: Option<js_sys::Function>) {
        *self.shared.on_selection.borrow_mut() = cb;
        if let Ok(mut t) = self.shared.touch.try_borrow_mut() {
            // Report the current state to the new listener.
            t.forget_report();
        }
        self.shared.repaint();
    }

    /// Every body paragraph, tables included, as JSON: `[{path, text, style, styleName,
    /// heading}]`. Offsets elsewhere (`selectText`, `setMarks`, comment anchors) count UTF-16
    /// code units in this `text`.
    pub fn paragraphs(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(paragraphs_json(&app.session.doc).to_string()))
    }

    /// Every comment as JSON: `[{id, parent, author, initials, date, resolved, text, quote,
    /// anchor: {path, start, end} | null}]`.
    pub fn comments(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(comments_json(&app.session.doc).to_string()))
    }

    /// Select `start..end` (UTF-16 offsets) of the paragraph at `path` (JSON array) and scroll to it.
    #[wasm_bindgen(js_name = selectText)]
    pub fn select_text(&self, path: &str, start: u32, end: u32) -> Result<(), JsValue> {
        let path: Vec<u32> = serde_json::from_str(path).map_err(|e| err(format!("path: {e}")))?;
        self.with_app(|app| {
            let a = pos_at(&app.session.doc, &path, start as usize).ok_or("no paragraph at that path")?;
            let b = pos_at(&app.session.doc, &path, end as usize).ok_or("no paragraph at that path")?;
            // The host's own call: commands it turned off for people don't apply.
            let off = std::mem::take(&mut app.session.disabled_commands);
            let out = app.run("select.range", json!({"anchor": a, "focus": b}));
            app.session.disabled_commands = off;
            out?;
            app.canvas.scroll_to_caret = true;
            Ok(())
        })
    }

    /// The selection as the panels count it: `{anchor: {path, offset} | null, focus: …}`
    /// (UTF-16 offsets in the paragraph's text; null outside the body).
    pub fn caret(&self) -> Result<String, JsValue> {
        self.with_app(|app| {
            let doc = &app.session.doc;
            let sel = &app.session.sel;
            Ok(json!({"anchor": body_offset(doc, &sel.anchor), "focus": body_offset(doc, &sel.focus)}).to_string())
        })
    }

    /// The selected picture, chart or shape: `{kind, alt, title}`, or `null` (read only).
    #[wasm_bindgen(js_name = selectedObject)]
    pub fn selected_object(&self) -> Result<String, JsValue> {
        self.with_app(|app| Ok(selected_object(&app.session.doc, &app.session.sel.anchor, &app.session.sel.focus).to_string()))
    }

    /// Marks over the text: `[{id, path, start, end, color: "#rrggbb", style: "squiggle" |
    /// "highlight"}]` (UTF-16 offsets in the paragraph's text). An empty list clears them.
    #[wasm_bindgen(js_name = setMarks)]
    pub fn set_marks(&self, json: &str) -> Result<(), JsValue> {
        let v: Value = serde_json::from_str(json).map_err(|e| err(format!("marks: {e}")))?;
        let marks = self.with_app(|app| Ok(parse_marks(&app.session.doc, &v)))?;
        *self.shared.marks.borrow_mut() = marks;
        self.shared.repaint();
        Ok(())
    }

    /// Follow a collaborator by name (their caret stays in view until this person scrolls,
    /// clicks or types), or stop with `null`.
    #[wasm_bindgen(js_name = followPeer)]
    pub fn follow_peer(&self, name: Option<String>) {
        *self.shared.follow.borrow_mut() = name;
        self.shared.repaint();
    }

    /// The selection as JSON: `collapsed`, `rect` (the visible part, in CSS pixels from the
    /// editor's corner), `contextual` tabs, `touch` (made by touch), `selected` (a touch
    /// selection just finished), `scrolling` and `scrolled`.
    #[wasm_bindgen(js_name = selectionInfo)]
    pub fn selection_info(&self) -> Result<String, JsValue> {
        let shared = self.shared.clone();
        let screen = self.shared.ctx.borrow().as_ref().map(egui::Context::content_rect);
        self.with_app(|app| {
            let marks = shared.marks.borrow();
            let extra = json!({"marks": marks_at(&marks, &app.session.sel.focus), "following": *shared.follow.borrow()});
            shared.touch.try_borrow().map(|t| t.info(app, screen, &extra).to_string()).map_err(|_| "busy".to_string())
        })
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
        *self.shared.on_selection.borrow_mut() = None;
        if let Ok(mut c) = self.shared.collab.try_borrow_mut() {
            *c = None;
        }
        if let Ok(mut app) = self.shared.app.try_borrow_mut() {
            *app = None;
        }
        *self.shared.intake.borrow_mut() = None;
        EDITORS.with(|e| e.borrow_mut().remove(&self.shared.key));
        *self.shared.ctx.borrow_mut() = None;
        if let (Some(listener), Some(window)) = (self.shared.unload_listener.borrow_mut().take(), web_sys::window()) {
            window.remove_event_listener_with_callback("beforeunload", listener.as_ref().unchecked_ref()).ok();
        }
    }
}

/// The editor's preferences as the page reads and writes them: the saved preferences and the host's
/// switches ([`Embed`]) in one camelCase object.
fn prefs_json(app: &WordApp) -> Result<Value, String> {
    let mut base = serde_json::to_value(app.prefs()).map_err(|e| e.to_string())?;
    let embed = serde_json::to_value(&app.embed).map_err(|e| e.to_string())?;
    merge_json(&mut base, &embed);
    Ok(base)
}

/// Merge `patch` into the preferences and the host's switches. Upstream's `apply_prefs` opens on
/// Home (as Word does at launch); a live change keeps the tab showing, or moves to the one asked for.
fn apply_prefs(app: &mut WordApp, patch: &Value) -> Result<(), String> {
    let mut base = prefs_json(app)?;
    merge_json(&mut base, patch);
    let prefs: Prefs = serde_json::from_value(base.clone()).map_err(|e| e.to_string())?;
    let embed: Embed = serde_json::from_value(base).map_err(|e| e.to_string())?;
    let tab = patch.get("tab").and_then(Value::as_str).map_or_else(|| app.ui.tab.clone(), str::to_string);
    let backstage = patch.get("backstage").and_then(Value::as_bool).unwrap_or(app.ui.backstage);
    app.apply_prefs(prefs);
    app.embed.apply(embed);
    app.ui.tab = tab;
    app.ui.backstage = backstage;
    Ok(())
}

/// A wake that asks `ctx` for a frame; callable from any task.
fn waker(ctx: &egui::Context) -> impl Fn() + Send + Sync + Clone + 'static {
    let ctx = ctx.clone();
    move || ctx.request_repaint()
}

/// The clipboard's copy path: eframe's own text copy is the browser's only write.
fn copy_out(ctx: &egui::Context, flavors: &[Flavor]) -> Result<usize, ClipboardError> {
    let (index, text) = flavors.iter().enumerate().find(|(_, f)| f.mime == TEXT).ok_or(ClipboardError::NoFormat)?;
    ctx.copy_text(String::from_utf8_lossy(&text.data).into_owned());
    Ok(index)
}

/// Largest picture pasted from the browser's clipboard (as `insert.picture` allows).
const MAX_PASTED_BYTES: f64 = (200u32 << 20) as f64;
/// Most pictures one paste inserts.
const MAX_PASTED_PICTURES: u32 = 20;

/// Pasting a picture: eframe's paste handler reads only text, so a clipboard holding just
/// pictures is read here and offered as a late paste (as upstream's web app does). A clipboard
/// with text is left to eframe.
fn listen_for_pasted_pictures(late: LateOffers) -> Result<(), String> {
    let document = web_sys::window().and_then(|w| w.document()).ok_or("no document")?;
    let late = Rc::new(late);
    let on_paste = Closure::<dyn FnMut(web_sys::ClipboardEvent)>::new(move |e: web_sys::ClipboardEvent| {
        let Some(data) = e.clipboard_data() else { return };
        if !data.get_data("text").unwrap_or_default().is_empty() {
            return;
        }
        let Some(files) = data.files() else { return };
        for i in 0..files.length().min(MAX_PASTED_PICTURES) {
            let Some(file) = files.get(i) else { continue };
            if !file.type_().starts_with("image/") || file.size() > MAX_PASTED_BYTES {
                continue;
            }
            let late = late.clone();
            let mime = file.type_();
            wasm_bindgen_futures::spawn_local(async move {
                match wasm_bindgen_futures::JsFuture::from(file.array_buffer()).await {
                    Ok(buf) => late.offer(vec![Flavor::new(mime, js_sys::Uint8Array::new(&buf).to_vec())]),
                    Err(e) => log::error!("couldn't read the pasted picture: {e:?}"),
                }
            });
        }
    });
    document.add_event_listener_with_callback("paste", on_paste.as_ref().unchecked_ref()).map_err(|e| format!("{e:?}"))?;
    // The listener lives as long as the page.
    on_paste.forget();
    Ok(())
}

/// The name a save goes by when it has none.
const DEFAULT_NAME: &str = "Document.docx";

/// The editor's files: the browser's pickers for opening, and every save (File › Save, Save As,
/// Export, AutoSave) handed to the page's `onSave` when it has one, otherwise downloaded.
struct EmbedFiles {
    inner: Arc<BrowserFiles>,
    /// The editor this belongs to ([`EDITORS`]).
    key: u64,
    /// Save answers by the id the inner files issued for them.
    answers: Mutex<HashMap<u64, Picked>>,
}

impl EmbedFiles {
    fn new(inner: Arc<BrowserFiles>, key: u64) -> Self {
        Self { inner, key, answers: Mutex::new(HashMap::new()) }
    }

    /// Hand `bytes` to the editor's `onSave`; `false` when it has none (the browser downloads).
    fn deliver(&self, name: &str, bytes: &[u8]) -> bool {
        let Some(shared) = EDITORS.with(|e| e.borrow().get(&self.key).and_then(std::rc::Weak::upgrade)) else { return false };
        if shared.on_save.borrow().is_none() {
            return false;
        }
        let name = Path::new(name).file_name().map_or_else(|| name.to_string(), |n| n.to_string_lossy().to_string());
        let data = js_sys::Uint8Array::from(bytes);
        // AutoSave runs inside `logic`.
        let reason = if shared.in_logic.get() { "autosave" } else { "save" };
        defer(move || {
            let cb = shared.on_save.borrow().clone();
            if let Some(cb) = cb {
                let file = js_sys::Object::new();
                js_sys::Reflect::set(&file, &"name".into(), &name.as_str().into()).ok();
                js_sys::Reflect::set(&file, &"mimeType".into(), &mime_for(&name).into()).ok();
                js_sys::Reflect::set(&file, &"bytes".into(), &data).ok();
                js_sys::Reflect::set(&file, &"reason".into(), &reason.into()).ok();
                if let Err(e) = cb.call1(&JsValue::NULL, &file) {
                    log::error!("wordcraft onSave handler threw: {e:?}");
                }
            }
        });
        true
    }
}

impl Files for EmbedFiles {
    fn pick(&self, request: PickRequest) -> PickId {
        self.inner.pick(request)
    }

    fn take_answer(&self, id: PickId) -> Option<Picked> {
        if let Some(answer) = self.answers.lock().unwrap_or_else(|e| e.into_inner()).remove(&id.0) {
            return Some(answer);
        }
        self.inner.take_answer(id)
    }

    fn forget(&self, id: PickId) {
        if self.answers.lock().unwrap_or_else(|e| e.into_inner()).remove(&id.0).is_none() {
            self.inner.forget(id);
        }
    }

    fn pending_pick(&self) -> Option<PendingPick> {
        self.inner.pending_pick()
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>, FileError> {
        self.inner.read(path)
    }

    fn write(&self, path: &Path, bytes: &[u8], intent: WriteIntent) -> Result<bool, FileError> {
        self.inner.write(path, bytes, intent)
    }

    fn last_folder(&self, purpose: &str) -> Option<PathBuf> {
        self.inner.last_folder(purpose)
    }

    fn save(&self, request: PickRequest, bytes: Vec<u8>) -> PickId {
        let name = request.file_name.clone().unwrap_or_else(|| DEFAULT_NAME.to_string());
        if !self.deliver(&name, &bytes) {
            return self.inner.save(request, bytes);
        }
        // A Save As (or a first save) makes the document this file; any other save keeps its file.
        let answer = if request.save_as { Picked::Saved { path: PathBuf::from(&name), file_type: None } } else { Picked::Downloaded(name) };
        // The inner files own the id space: a folder pick is answered at once with no picker, so
        // it only yields an id, which is released and reused for this answer (as upstream does).
        let id = self.inner.pick(PickRequest::folder("embed-save"));
        self.inner.forget(id);
        self.answers.lock().unwrap_or_else(|e| e.into_inner()).insert(id.0, answer);
        id
    }

    fn can_pick(&self) -> bool {
        self.inner.can_pick()
    }

    fn browser_saves(&self) -> bool {
        true
    }
}
