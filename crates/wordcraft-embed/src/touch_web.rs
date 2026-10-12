//! Applies [`crate::touch`] gestures to the editor, paints the selection handles and reports the
//! selection to the host (for a phone layout's floatie and contextual tabs).

use egui::{Color32, Event, LayerId, Order, Pos2, Rect, Stroke, Vec2, vec2};
use serde_json::{Value, json};
use wordcraft_doc::Pos;
use wordcraft_ui_egui::WordApp;
use wordcraft_ui_egui::canvas::{caret_screen, page_to_screen, pos_from_screen};

use crate::touch::{Effect, Owner, Recognizer, click_events, wheel_events};

/// Handle knob radius and the square a finger can grab it by (points).
const KNOB: f32 = 9.0;
const GRAB: f32 = 44.0;
/// Rectangles a long selection reports at most (the floatie needs only the visible part).
const MAX_RECTS: usize = 600;

pub struct TouchState {
    /// Gestures on (the host can turn them off, e.g. for a pen-only kiosk).
    pub on: bool,
    rec: Recognizer,
    /// Where each handle can be grabbed (start, end), from the last frame.
    handles: [Option<Rect>; 2],
    /// From the knob's centre up to the middle of its line, per handle.
    lift: [f32; 2],
    /// Show handles: the selection was made or changed by touch.
    show_handles: bool,
    /// The selection end that stays put while a long press or a handle drag moves the other.
    fixed: Option<Pos>,
    /// A touch selection gesture has finished (the host shows its floatie).
    selected: bool,
    last_time: Option<f64>,
    last_report: String,
}

impl Default for TouchState {
    fn default() -> Self {
        Self {
            on: true,
            rec: Recognizer::default(),
            handles: [None; 2],
            lift: [0.0; 2],
            show_handles: false,
            fixed: None,
            selected: false,
            last_time: None,
            last_report: String::new(),
        }
    }
}

fn ordered(app: &WordApp) -> (Pos, Pos) {
    let s = &app.session.sel;
    if s.anchor <= s.focus { (s.anchor.clone(), s.focus.clone()) } else { (s.focus.clone(), s.anchor.clone()) }
}

fn select(app: &mut WordApp, anchor: &Pos, focus: &Pos) {
    let params = json!({"anchor": anchor, "focus": focus});
    if let Err(e) = app.run("select.range", params) {
        log::warn!("touch selection: {e}");
    }
}

impl TouchState {
    /// Before each frame: turn this frame's touch events into page gestures.
    pub fn input(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput, app: &mut WordApp) {
        if !self.on {
            return;
        }
        let now = raw.time.unwrap_or(0.0);
        let dt = self.last_time.map_or(0.0, |t| (now - t) as f32);
        self.last_time = Some(now);
        let has_touch = raw.events.iter().any(|e| matches!(e, Event::Touch { .. }));
        // A mouse click or typing puts the handles away, as on a phone with a keyboard attached.
        if !has_touch && raw.events.iter().any(|e| matches!(e, Event::PointerButton { pressed: true, .. } | Event::Text(_))) {
            self.show_handles = false;
            self.selected = false;
        }
        let canvas = app.canvas.canvas_rect;
        let handles = self.handles;
        let owner = |p: Pos2| -> Owner {
            if let Some(i) = handles.iter().position(|h| h.is_some_and(|r| r.contains(p))) {
                return Owner::Handle(i);
            }
            // The page, unless a window, menu or toolbar lies over it there.
            let on_page = canvas.is_some_and(|r| r.contains(p)) && ctx.layer_id_at(p).is_none_or(|l| l.order == Order::Background);
            if on_page { Owner::Page } else { Owner::Other }
        };
        let events = std::mem::take(&mut raw.events);
        let (forwarded, mut effects) = self.rec.process(events, now, &owner);
        raw.events = forwarded;
        effects.extend(self.rec.tick(now, dt));
        for e in effects {
            self.apply(e, app, &mut raw.events);
        }
        if let Some(after) = self.rec.wants_frames(now) {
            ctx.request_repaint_after(std::time::Duration::from_secs_f64(after));
        }
    }

    fn apply(&mut self, effect: Effect, app: &mut WordApp, events: &mut Vec<Event>) {
        match effect {
            Effect::Tap(at) => {
                events.extend(click_events(at));
                self.show_handles = false;
                self.selected = false;
                self.fixed = None;
            }
            Effect::Scroll { delta, at } => {
                events.push(Event::PointerMoved(at));
                events.extend(wheel_events(delta));
            }
            Effect::Hover(at) => events.push(Event::PointerMoved(at)),
            Effect::LongPress(at) => {
                let Some(pos) = pos_from_screen(app, at) else { return };
                select(app, &pos, &pos);
                if let Err(e) = app.run("select.word", json!({})) {
                    log::warn!("touch selection: {e}");
                }
                self.fixed = Some(ordered(app).0);
                self.show_handles = true;
                self.selected = false;
            }
            Effect::Extend { handle, at } => {
                // A handle hangs below its line: aim at the text the knob belongs to.
                let at = match handle {
                    Some(h) => at - vec2(0.0, self.lift[h.min(1)]),
                    None => at,
                };
                if self.fixed.is_none() {
                    let (start, end) = ordered(app);
                    self.fixed = Some(if handle == Some(0) { end } else { start });
                }
                let Some(pos) = pos_from_screen(app, at) else { return };
                if let Some(fixed) = self.fixed.clone() {
                    select(app, &fixed, &pos);
                }
                self.show_handles = true;
                self.selected = false;
            }
            Effect::Selected => {
                self.fixed = None;
                let s = &app.session.sel;
                self.selected = s.anchor != s.focus;
                self.show_handles = self.selected;
            }
        }
    }

    /// After each frame: draw the selection handles (and remember where they can be grabbed).
    pub fn paint(&mut self, app: &mut WordApp, ctx: &egui::Context) {
        self.handles = [None; 2];
        let s = &app.session.sel;
        if !self.on || !self.show_handles || s.anchor == s.focus {
            return;
        }
        let Some(clip) = app.canvas.canvas_rect else { return };
        let color = wordcraft_ui_egui::theme::Tokens::get(ctx).accent;
        let painter = ctx.layer_painter(LayerId::new(Order::Foreground, egui::Id::new("wordcraft-touch-handles"))).with_clip_rect(clip);
        let (start, end) = ordered(app);
        let layout = app.session.layout();
        let hint = app.session.page_hint;
        for (i, pos) in [start, end].iter().enumerate() {
            let Some(c) = layout.caret_on(pos, hint) else { continue };
            let (Some(top), Some(bottom)) = (page_to_screen(app, c.page, c.x, c.top), page_to_screen(app, c.page, c.x, c.top + c.height)) else {
                continue;
            };
            if !clip.contains(bottom) {
                continue;
            }
            let knob = bottom + vec2(0.0, KNOB + 2.0);
            painter.line_segment([top, bottom + vec2(0.0, 2.0)], Stroke::new(2.0, color));
            painter.circle(knob, KNOB, color, Stroke::new(1.5, Color32::WHITE));
            self.handles[i] = Some(Rect::from_center_size(knob, Vec2::splat(GRAB)));
            self.lift[i] = knob.y - (top.y + bottom.y) / 2.0;
        }
    }

    /// The selection as the host sees it, in egui points from the editor's top-left corner.
    /// `screen` (the whole editor, in points) lets the host convert to CSS pixels.
    pub fn info(&self, app: &mut WordApp, screen: Option<Rect>) -> Value {
        let (start, end) = ordered(app);
        let collapsed = start == end;
        let canvas = app.canvas.canvas_rect;
        let mut rect: Option<Rect> = None;
        if collapsed {
            if let Some((p, h)) = caret_screen(app) {
                rect = Some(Rect::from_min_size(p, vec2(1.0, h)));
            }
        } else {
            let layout = app.session.layout();
            let rects = layout.selection_rects(&app.session.doc, &start, &end, app.session.page_hint);
            for (page, r) in rects.into_iter().take(MAX_RECTS) {
                let (Some(a), Some(b)) = (page_to_screen(app, page, r.x, r.y), page_to_screen(app, page, r.x + r.w, r.y + r.h)) else { continue };
                let mut on_screen = Rect::from_two_pos(a, b);
                if let Some(c) = canvas {
                    on_screen = on_screen.intersect(c);
                    if on_screen.width() <= 0.0 || on_screen.height() <= 0.0 {
                        continue;
                    }
                }
                rect = Some(rect.map_or(on_screen, |u| u.union(on_screen)));
            }
        }
        let visible = match (rect, canvas) {
            (Some(r), Some(c)) => c.intersects(r),
            (Some(_), None) => true,
            _ => false,
        };
        let r2j = |r: Rect| json!({"x": r.min.x, "y": r.min.y, "width": r.width(), "height": r.height()});
        json!({
            "collapsed": collapsed,
            "rect": rect.map(r2j),
            "visible": visible,
            "page": canvas.map(r2j),
            "contextual": wordcraft_ui_egui::ribbon::contextual_tabs(&app.session),
            "touch": self.show_handles,
            "selected": self.selected && !collapsed,
            "scrolling": self.rec.scrolling(),
            "scrolled": self.rec.scrolled,
            "screen": screen.map(r2j),
        })
    }

    /// The selection info when it changed since the last report.
    pub fn report(&mut self, app: &mut WordApp, screen: Option<Rect>) -> Option<String> {
        let now = self.info(app, screen).to_string();
        if now == self.last_report {
            return None;
        }
        self.last_report.clone_from(&now);
        Some(now)
    }

    /// Report the current state again, even if unchanged (a new listener).
    pub fn forget_report(&mut self) {
        self.last_report.clear();
    }

    /// Another document opened, or the host turned gestures off: drop any gesture state.
    pub fn reset(&mut self) {
        self.rec.stop();
        self.show_handles = false;
        self.selected = false;
        self.fixed = None;
        self.handles = [None; 2];
    }
}
