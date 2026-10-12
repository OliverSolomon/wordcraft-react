//! Touch gestures on the page, as on a phone or tablet.
//!
//! eframe turns the first finger into a mouse: a press where it lands and a drag as it moves. On
//! the page that drag selects text, so a finger could never scroll. This layer sits in
//! `raw_input_hook` and, for gestures that start on the page, replaces those mouse events:
//!
//! - a drag scrolls the page 1:1 and flings on release;
//! - a tap places the caret (it is passed on as a click, so double-tap still selects a word);
//! - a long press selects the word under the finger, and moving on extends the selection;
//! - the selection's two handles can be dragged to change either end;
//! - two fingers pinch to zoom (egui's own multi-touch zoom, which the canvas already follows).
//!
//! Gestures that start anywhere else (dialogs, menus, the mini toolbar) are left untouched, and a
//! mouse or a pen is never affected. [`Recognizer`] is the pure state machine; `apply` in
//! `web.rs` turns its [`Effect`]s into editor actions.

use egui::{Event, Pos2, TouchPhase, Vec2};

/// How far (points) a finger may wander before a press becomes a scroll.
pub const SLOP: f32 = 10.0;
/// How long (seconds) a still finger takes to become a long press.
pub const LONG_PRESS: f64 = 0.45;
/// Fling friction: velocity falls by e every 1/FRICTION seconds.
const FRICTION: f32 = 4.0;
/// Below this speed (points per second) a fling stops.
const MIN_FLING: f32 = 40.0;
/// Fastest fling (points per second).
const MAX_FLING: f32 = 8000.0;

/// Who a finger landing at a point belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Owner {
    /// The page: this layer handles the gesture.
    Page,
    /// One of the selection handles (0 = start, 1 = end).
    Handle(usize),
    /// Anything else: egui handles it as a mouse.
    Other,
}

/// What a gesture asks the editor to do.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    /// Place the caret here (a press and release, so egui counts double-taps).
    Tap(Pos2),
    /// Scroll the page by this much (positive = content moves down/right); `at` keeps the hover.
    Scroll { delta: Vec2, at: Pos2 },
    /// Select the word at this point.
    LongPress(Pos2),
    /// Move the selection's end that is under the finger (after a long press, or a handle drag).
    Extend { handle: Option<usize>, at: Pos2 },
    /// Two fingers: keep egui's pointer at their midpoint so pinch-zoom lands on the page.
    Hover(Pos2),
    /// A selection gesture ended (show the floatie).
    Selected,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Gesture {
    Idle,
    /// Down on the page, not yet a tap, scroll or long press.
    Pending,
    Scroll,
    LongPress,
    Handle(usize),
    /// Two or more fingers.
    Pinch,
    /// Started somewhere else: egui gets the events as they are.
    Passthrough,
}

/// Turns touch events into page gestures.
#[derive(Debug)]
pub struct Recognizer {
    gesture: Gesture,
    fingers: Vec<(egui::TouchId, Pos2)>,
    start: Pos2,
    start_time: f64,
    last: Pos2,
    last_time: f64,
    velocity: Vec2,
    fling: Vec2,
    /// Total distance scrolled by touch (points), for shy chrome in the host.
    pub scrolled: f32,
}

impl Default for Recognizer {
    fn default() -> Self {
        Self {
            gesture: Gesture::Idle,
            fingers: Vec::new(),
            start: Pos2::ZERO,
            start_time: 0.0,
            last: Pos2::ZERO,
            last_time: 0.0,
            velocity: Vec2::ZERO,
            fling: Vec2::ZERO,
            scrolled: 0.0,
        }
    }
}

impl Recognizer {
    /// Is a page gesture or fling under way (so pointer events from touch must be held back)?
    pub fn owns_pointer(&self) -> bool {
        !matches!(self.gesture, Gesture::Idle | Gesture::Passthrough)
    }

    /// When the host needs another frame (seconds from `now`): at once while a fling moves, or
    /// when a still finger turns into a long press.
    pub fn wants_frames(&self, now: f64) -> Option<f64> {
        if self.fling != Vec2::ZERO {
            return Some(0.0);
        }
        (self.gesture == Gesture::Pending).then(|| (LONG_PRESS - (now - self.start_time)).max(0.0))
    }

    /// Is the page moving under a finger or a fling?
    pub fn scrolling(&self) -> bool {
        self.gesture == Gesture::Scroll || self.fling != Vec2::ZERO
    }

    /// Process one frame's events at time `now`. Returns the events egui should still see and
    /// the effects to apply. `owner` says who a finger landing at a point belongs to.
    pub fn process(&mut self, events: Vec<Event>, now: f64, owner: &dyn Fn(Pos2) -> Owner) -> (Vec<Event>, Vec<Effect>) {
        let mut effects = Vec::new();
        let has_touch = events.iter().any(|e| matches!(e, Event::Touch { .. }));
        // A mouse press or a key stops a fling; a mouse never starts a gesture.
        if events.iter().any(|e| matches!(e, Event::Key { pressed: true, .. }))
            || (!has_touch && events.iter().any(|e| matches!(e, Event::PointerButton { pressed: true, .. })))
        {
            self.fling = Vec2::ZERO;
        }
        if !has_touch {
            return (events, effects);
        }
        // Touch first, so the batch's pointer events can be judged by the gesture they belong to.
        let mut owned = self.owns_pointer();
        for e in &events {
            if let Event::Touch { id, phase, pos, .. } = *e {
                owned |= self.touch(id, phase, pos, now, owner, &mut effects);
            }
        }
        let forwarded = events
            .into_iter()
            .filter(|e| !(owned && matches!(e, Event::PointerButton { .. } | Event::PointerMoved(_) | Event::PointerGone)))
            .collect();
        (forwarded, effects)
    }

    /// One finger event. Returns whether the gesture it belongs to is ours.
    fn touch(&mut self, id: egui::TouchId, phase: TouchPhase, pos: Pos2, now: f64, owner: &dyn Fn(Pos2) -> Owner, effects: &mut Vec<Effect>) -> bool {
        match phase {
            TouchPhase::Start => {
                self.fingers.retain(|(f, _)| *f != id);
                self.fingers.push((id, pos));
                if self.fingers.len() == 1 {
                    self.fling = Vec2::ZERO;
                    self.start = pos;
                    self.start_time = now;
                    self.last = pos;
                    self.last_time = now;
                    self.velocity = Vec2::ZERO;
                    self.gesture = match owner(pos) {
                        Owner::Page => Gesture::Pending,
                        Owner::Handle(h) => Gesture::Handle(h),
                        Owner::Other => Gesture::Passthrough,
                    };
                } else if self.gesture != Gesture::Passthrough {
                    self.gesture = Gesture::Pinch;
                    effects.push(Effect::Hover(self.midpoint()));
                }
            }
            TouchPhase::Move => {
                if let Some(f) = self.fingers.iter_mut().find(|(f, _)| *f == id) {
                    f.1 = pos;
                }
                // Only the first finger drives one-finger gestures.
                let first = self.fingers.first().is_some_and(|(f, _)| *f == id);
                match self.gesture {
                    Gesture::Pinch => effects.push(Effect::Hover(self.midpoint())),
                    Gesture::Pending if first && (pos - self.start).length() > SLOP => {
                        self.gesture = Gesture::Scroll;
                        // Scroll the whole way from where the finger landed.
                        self.last = self.start;
                        self.scroll_to(pos, now, effects);
                    }
                    Gesture::Scroll if first => self.scroll_to(pos, now, effects),
                    Gesture::LongPress if first => effects.push(Effect::Extend { handle: None, at: pos }),
                    Gesture::Handle(h) if first => effects.push(Effect::Extend { handle: Some(h), at: pos }),
                    _ => {}
                }
            }
            TouchPhase::End | TouchPhase::Cancel => {
                self.fingers.retain(|(f, _)| *f != id);
                if self.fingers.is_empty() {
                    let cancelled = phase == TouchPhase::Cancel;
                    match self.gesture {
                        Gesture::Pending if !cancelled => effects.push(Effect::Tap(self.start)),
                        Gesture::Scroll => {
                            // A finger that stopped before lifting doesn't fling.
                            let stale = now - self.last_time > 0.1;
                            let v = if stale { Vec2::ZERO } else { self.velocity };
                            self.fling = if v.length() >= MIN_FLING { v * (MAX_FLING / v.length()).min(1.0) } else { Vec2::ZERO };
                        }
                        Gesture::LongPress | Gesture::Handle(_) => effects.push(Effect::Selected),
                        _ => {}
                    }
                    let was_ours = self.owns_pointer();
                    self.gesture = Gesture::Idle;
                    return was_ours;
                }
            }
        }
        self.owns_pointer()
    }

    fn midpoint(&self) -> Pos2 {
        let n = self.fingers.len().max(1) as f32;
        let sum = self.fingers.iter().fold(Vec2::ZERO, |s, (_, p)| s + p.to_vec2());
        (sum / n).to_pos2()
    }

    fn scroll_to(&mut self, pos: Pos2, now: f64, effects: &mut Vec<Effect>) {
        let delta = pos - self.last;
        let dt = (now - self.last_time) as f32;
        if dt > 0.0 {
            // Smooth the velocity a little, so one jittery sample doesn't decide the fling.
            let v = delta / dt;
            self.velocity = if self.velocity == Vec2::ZERO { v } else { self.velocity * 0.3 + v * 0.7 };
        }
        self.last = pos;
        self.last_time = now;
        if delta != Vec2::ZERO {
            self.scrolled += delta.y;
            effects.push(Effect::Scroll { delta, at: pos });
        }
    }

    /// Time passing without touch events: a still finger becomes a long press, and a fling
    /// coasts. `dt` is the frame time in seconds.
    pub fn tick(&mut self, now: f64, dt: f32) -> Vec<Effect> {
        let mut effects = Vec::new();
        if self.gesture == Gesture::Pending && now - self.start_time >= LONG_PRESS {
            self.gesture = Gesture::LongPress;
            effects.push(Effect::LongPress(self.start));
        }
        if self.fling != Vec2::ZERO && dt.is_finite() && dt > 0.0 {
            let dt = dt.min(0.1);
            let delta = self.fling * dt;
            self.fling *= (-FRICTION * dt).exp();
            if self.fling.length() < MIN_FLING {
                self.fling = Vec2::ZERO;
            }
            self.scrolled += delta.y;
            effects.push(Effect::Scroll { delta, at: self.last });
        }
        effects
    }

    /// Stop any fling (the page hit its end, or another document opened).
    pub fn stop(&mut self) {
        self.fling = Vec2::ZERO;
    }
}

/// Split a scroll into wheel events the canvas applies 1:1 (it eases larger browser deltas in,
/// as it does for mouse-wheel notches).
pub fn wheel_events(delta: Vec2) -> Vec<Event> {
    const STEP: f32 = 7.0;
    let n = (delta.length() / STEP).ceil().max(1.0) as usize;
    let part = delta / n as f32;
    (0..n)
        .map(|_| Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: part, phase: TouchPhase::Move, modifiers: egui::Modifiers::NONE })
        .collect()
}

/// A press and release at `at`: a click, as egui sees one.
pub fn click_events(at: Pos2) -> [Event; 3] {
    let button = |pressed| Event::PointerButton { pos: at, button: egui::PointerButton::Primary, pressed, modifiers: egui::Modifiers::NONE };
    [Event::PointerMoved(at), button(true), button(false)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(id: u64, phase: TouchPhase, x: f32, y: f32) -> Event {
        Event::Touch { device_id: egui::TouchDeviceId(0), id: egui::TouchId(id), phase, pos: Pos2::new(x, y), force: None }
    }
    fn press(x: f32, y: f32, pressed: bool) -> Event {
        Event::PointerButton { pos: Pos2::new(x, y), button: egui::PointerButton::Primary, pressed, modifiers: egui::Modifiers::NONE }
    }
    fn page(_: Pos2) -> Owner {
        Owner::Page
    }

    #[test]
    fn a_tap_becomes_a_click_and_its_mouse_events_are_held_back() {
        let mut r = Recognizer::default();
        let (fwd, fx) = r.process(vec![press(50.0, 60.0, true), touch(1, TouchPhase::Start, 50.0, 60.0)], 1.0, &page);
        assert!(fwd.iter().all(|e| matches!(e, Event::Touch { .. })), "{fwd:?}");
        assert!(fx.is_empty());
        let (fwd, fx) = r.process(vec![press(50.0, 60.0, false), Event::PointerGone, touch(1, TouchPhase::End, 50.0, 60.0)], 1.1, &page);
        assert!(fwd.iter().all(|e| matches!(e, Event::Touch { .. })), "{fwd:?}");
        assert_eq!(fx, vec![Effect::Tap(Pos2::new(50.0, 60.0))]);
        assert!(!r.owns_pointer());
    }

    #[test]
    fn a_drag_scrolls_from_where_the_finger_landed_and_flings() {
        let mut r = Recognizer::default();
        r.process(vec![touch(1, TouchPhase::Start, 100.0, 400.0)], 1.0, &page);
        let (_, fx) = r.process(vec![Event::PointerMoved(Pos2::new(100.0, 395.0)), touch(1, TouchPhase::Move, 100.0, 395.0)], 1.016, &page);
        assert!(fx.is_empty(), "inside the slop: still a possible tap");
        let (fwd, fx) = r.process(vec![Event::PointerMoved(Pos2::new(100.0, 380.0)), touch(1, TouchPhase::Move, 100.0, 380.0)], 1.032, &page);
        assert!(!fwd.iter().any(|e| matches!(e, Event::PointerMoved(_))));
        assert_eq!(fx, vec![Effect::Scroll { delta: Vec2::new(0.0, -20.0), at: Pos2::new(100.0, 380.0) }]);
        let (_, fx) = r.process(vec![touch(1, TouchPhase::End, 100.0, 380.0)], 1.04, &page);
        assert!(fx.is_empty());
        let coast = r.tick(1.056, 0.016);
        assert!(matches!(coast.as_slice(), [Effect::Scroll { delta, .. }] if delta.y < 0.0), "{coast:?}");
        assert_eq!(r.wants_frames(1.056), Some(0.0));
        assert!(r.scrolling());
        // A tap stops the fling.
        r.process(vec![touch(2, TouchPhase::Start, 10.0, 10.0)], 1.1, &page);
        assert!(r.tick(1.116, 0.016).is_empty());
    }

    #[test]
    fn a_finger_that_stops_before_lifting_does_not_fling() {
        let mut r = Recognizer::default();
        r.process(vec![touch(1, TouchPhase::Start, 0.0, 300.0)], 1.0, &page);
        r.process(vec![touch(1, TouchPhase::Move, 0.0, 200.0)], 1.05, &page);
        r.process(vec![touch(1, TouchPhase::End, 0.0, 200.0)], 1.5, &page);
        assert!(r.tick(1.516, 0.016).is_empty());
    }

    #[test]
    fn a_still_finger_long_presses_then_extends() {
        let mut r = Recognizer::default();
        r.process(vec![touch(1, TouchPhase::Start, 40.0, 40.0)], 2.0, &page);
        assert!(r.tick(2.2, 0.016).is_empty());
        assert!((r.wants_frames(2.2).unwrap() - 0.25).abs() < 1e-9);
        assert_eq!(r.tick(2.46, 0.016), vec![Effect::LongPress(Pos2::new(40.0, 40.0))]);
        let (_, fx) = r.process(vec![touch(1, TouchPhase::Move, 90.0, 41.0)], 2.6, &page);
        assert_eq!(fx, vec![Effect::Extend { handle: None, at: Pos2::new(90.0, 41.0) }]);
        let (_, fx) = r.process(vec![touch(1, TouchPhase::End, 90.0, 41.0)], 2.7, &page);
        assert_eq!(fx, vec![Effect::Selected]);
    }

    #[test]
    fn handles_drag_their_own_end() {
        let mut r = Recognizer::default();
        let on_handle = |_: Pos2| Owner::Handle(1);
        r.process(vec![touch(1, TouchPhase::Start, 40.0, 40.0)], 1.0, &on_handle);
        let (_, fx) = r.process(vec![touch(1, TouchPhase::Move, 45.0, 40.0)], 1.1, &on_handle);
        assert_eq!(fx, vec![Effect::Extend { handle: Some(1), at: Pos2::new(45.0, 40.0) }]);
        assert!(r.tick(2.0, 0.016).is_empty(), "no long press on a handle");
    }

    #[test]
    fn gestures_elsewhere_and_the_mouse_are_left_alone() {
        let mut r = Recognizer::default();
        let other = |_: Pos2| Owner::Other;
        let (fwd, fx) = r.process(vec![press(5.0, 5.0, true), touch(1, TouchPhase::Start, 5.0, 5.0)], 1.0, &other);
        assert_eq!(fwd.len(), 2);
        assert!(fx.is_empty());
        r.process(vec![touch(1, TouchPhase::End, 5.0, 5.0)], 1.1, &other);
        let (fwd, fx) = r.process(vec![press(5.0, 5.0, true)], 2.0, &page);
        assert_eq!(fwd.len(), 1);
        assert!(fx.is_empty());
    }

    #[test]
    fn two_fingers_pinch_at_their_midpoint() {
        let mut r = Recognizer::default();
        r.process(vec![touch(1, TouchPhase::Start, 0.0, 0.0)], 1.0, &page);
        let (_, fx) = r.process(vec![touch(2, TouchPhase::Start, 100.0, 50.0)], 1.05, &page);
        assert_eq!(fx, vec![Effect::Hover(Pos2::new(50.0, 25.0))]);
        assert!(r.tick(2.0, 0.016).is_empty(), "no long press while pinching");
        r.process(vec![touch(2, TouchPhase::End, 100.0, 50.0)], 2.1, &page);
        let (_, fx) = r.process(vec![touch(1, TouchPhase::End, 0.0, 0.0)], 2.2, &page);
        assert!(fx.is_empty(), "lifting after a pinch is not a tap");
    }

    #[test]
    fn wheel_steps_stay_small_enough_to_scroll_one_to_one() {
        let ev = wheel_events(Vec2::new(0.0, -50.0));
        assert_eq!(ev.len(), 8);
        let total = ev.iter().fold(Vec2::ZERO, |s, e| match e {
            Event::MouseWheel { delta, .. } => {
                assert!(delta.length() < 8.0);
                s + *delta
            }
            _ => s,
        });
        assert!((total.y + 50.0).abs() < 1e-3);
    }
}
