//! Real-time co-editing inside the editor: keeps the open document in step with a
//! Yjs-compatible shared document ([`wordcraft_collab::Collab`]), hands Undo and Redo to it so
//! they take back only this person's changes, and draws other people's cursors and selections
//! on the page, as Word's co-authoring does.
//!
//! The JavaScript side (packages/wordcraft-react/src/collab.ts) moves updates and cursors
//! between this and a `Y.Doc` + awareness, so any Yjs provider works.

use std::sync::Arc;

use egui::{Color32, FontId, Pos2, Rect, Stroke, Vec2};
use wordcraft_collab::Collab;
use wordcraft_doc::Pos;
use wordcraft_engine::Selection;
use wordcraft_ui_egui::{Collaborator, WordApp};

/// Another person in the document.
pub(crate) struct Peer {
    pub name: String,
    pub color: [u8; 3],
    /// Encoded Yjs relative positions of their selection (anchor, head).
    pub anchor: Option<Vec<u8>>,
    pub head: Option<Vec<u8>>,
}

pub(crate) struct CollabState {
    pub c: Collab,
    pub peers: Vec<Peer>,
    /// Session revision already in the shared document.
    pub synced_rev: u64,
    /// The selection last announced to others.
    pub announced: Option<(Pos, Pos)>,
}

/// Clock for grouping undo steps (browsers have no `SystemTime`).
pub(crate) fn clock() -> Arc<dyn yrs::sync::time::Clock> {
    Arc::new(|| js_sys::Date::now() as u64)
}

impl CollabState {
    pub fn new(client_id: u64) -> CollabState {
        CollabState { c: Collab::new(client_id, clock()), peers: Vec::new(), synced_rev: 0, announced: None }
    }

    /// Put a merged document into the session, keeping the caret where it was in the text.
    pub fn install(app: &mut WordApp, doc: wordcraft_doc::Document, sel: Vec<Pos>) {
        app.session.doc = doc;
        if let [anchor, focus] = sel.as_slice() {
            app.session.sel = Selection { anchor: anchor.clone(), focus: focus.clone() };
        }
        app.session.clamp_selection();
        app.session.touch();
    }

    fn selection(app: &WordApp) -> [Pos; 2] {
        [app.session.sel.anchor.clone(), app.session.sel.focus.clone()]
    }

    /// Apply an update from someone else.
    pub fn apply(&mut self, app: &mut WordApp, update: &[u8]) -> Result<(), String> {
        let (doc, sel) = self.c.apply_remote(update, &Self::selection(app)).map_err(|e| e.to_string())?;
        Self::install(app, doc, sel);
        self.synced_rev = app.session.rev();
        Ok(())
    }

    /// After each frame: carry out queued Undo/Redo, share local edits, refresh the toolbar's
    /// undo state. Returns the updates to send.
    pub fn after_frame(&mut self, app: &mut WordApp) -> Vec<Vec<u8>> {
        let requests = std::mem::take(&mut app.session.history_requests);
        for redo in requests {
            // Anything typed this frame goes in first, so Undo sees it.
            self.share_local(app);
            let sel = Self::selection(app);
            let r = if redo { self.c.redo(&sel) } else { self.c.undo(&sel) };
            match r {
                Some(Ok((doc, sel))) => {
                    Self::install(app, doc, sel);
                    app.session.dirty = true;
                    self.synced_rev = app.session.rev();
                }
                Some(Err(e)) => log::error!("collab: {e}"),
                None => {}
            }
        }
        self.share_local(app);
        app.session.external_can = (self.c.can_undo(), self.c.can_redo());
        self.c.take_updates()
    }

    fn share_local(&mut self, app: &WordApp) {
        let rev = app.session.rev();
        if rev != self.synced_rev {
            self.c.push_local(&app.session.doc);
            self.synced_rev = rev;
        }
    }

    /// The local selection as encoded relative positions, when it moved since last announced.
    pub fn cursor_change(&mut self, app: &WordApp) -> Option<Option<(Vec<u8>, Vec<u8>)>> {
        let now = (app.session.sel.anchor.clone(), app.session.sel.focus.clone());
        if self.announced.as_ref() == Some(&now) {
            return None;
        }
        self.announced = Some(now.clone());
        Some(self.c.anchor(&now.0).zip(self.c.anchor(&now.1)))
    }

    /// Title bar avatars for the people here.
    pub fn collaborators(&self) -> Vec<Collaborator> {
        self.peers.iter().map(|p| Collaborator { name: p.name.clone(), color: p.color }).collect()
    }

    /// Draw everyone else's caret, selection and name flag on the pages.
    pub fn paint(&self, app: &mut WordApp, painter: &egui::Painter) {
        if self.peers.is_empty() {
            return;
        }
        let layout = app.session.layout();
        let hint = app.session.page_hint;
        for peer in &self.peers {
            let resolve = |b: &Option<Vec<u8>>| b.as_deref().and_then(|b| self.c.resolve(b));
            let (Some(head), anchor) = (resolve(&peer.head), resolve(&peer.anchor)) else { continue };
            let color = Color32::from_rgb(peer.color[0], peer.color[1], peer.color[2]);
            // Selection highlight.
            if let Some(anchor) = anchor.filter(|a| *a != head) {
                for (page, r) in layout.selection_rects(&app.session.doc, &anchor, &head, hint) {
                    let (Some(a), Some(b)) = (
                        wordcraft_ui_egui::canvas::page_to_screen(app, page, r.x, r.y),
                        wordcraft_ui_egui::canvas::page_to_screen(app, page, r.x + r.w, r.y + r.h),
                    ) else {
                        continue;
                    };
                    painter.rect_filled(Rect::from_two_pos(a, b), 0.0, color.gamma_multiply(0.22));
                }
            }
            // Caret and name flag.
            let Some(c) = layout.caret_on(&head, hint) else { continue };
            let (Some(top), Some(bottom)) = (
                wordcraft_ui_egui::canvas::page_to_screen(app, c.page, c.x, c.top),
                wordcraft_ui_egui::canvas::page_to_screen(app, c.page, c.x, c.top + c.height),
            ) else {
                continue;
            };
            painter.line_segment([top, bottom], Stroke::new(2.0, color));
            let font = FontId::proportional(11.0);
            let galley = painter.layout_no_wrap(peer.name.clone(), font, Color32::WHITE);
            let size = galley.size() + Vec2::new(8.0, 3.0);
            let flag = Rect::from_min_size(Pos2::new(top.x - 1.0, top.y - size.y), size);
            painter.rect_filled(flag, egui::CornerRadius { nw: 3, ne: 3, se: 3, sw: 0 }, color);
            painter.galley(flag.left_top() + Vec2::new(4.0, 1.5), galley, Color32::WHITE);
        }
    }
}

/// `#rrggbb` (or `rrggbb`) → RGB; a stable colour from the name otherwise.
pub(crate) fn parse_color(s: Option<&str>, name: &str) -> [u8; 3] {
    if let Some(hex) = s.map(|s| s.trim().trim_start_matches('#'))
        && hex.len() == 6
        && let Ok(v) = u32::from_str_radix(hex, 16)
    {
        return [(v >> 16) as u8, (v >> 8) as u8, v as u8];
    }
    // Word-like palette, picked by name.
    const PALETTE: [[u8; 3]; 8] = [
        [0xC2, 0x41, 0x0C],
        [0x2B, 0x57, 0x9A],
        [0x10, 0x7C, 0x41],
        [0x86, 0x3B, 0xB0],
        [0xB4, 0x2B, 0x5A],
        [0x00, 0x6E, 0x8C],
        [0x8A, 0x5A, 0x00],
        [0x5C, 0x2D, 0x91],
    ];
    let h = name.bytes().fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
    PALETTE[(h as usize) % PALETTE.len()]
}
