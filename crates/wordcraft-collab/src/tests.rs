//! Two (or three) simulated people editing through the CRDT with real WordCraft commands.

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;
use wordcraft_engine::{Selection, Session};

use super::*;

fn clock() -> Arc<dyn Clock> {
    // Each call is a second apart, so every edit is its own undo step.
    let t = Arc::new(AtomicU64::new(0));
    Arc::new(move || t.fetch_add(1000, Ordering::Relaxed))
}

/// One person: an editing session plus their replica of the shared document.
struct Person {
    s: Session,
    c: Collab,
}

impl Person {
    fn first(id: u64, doc: Document) -> Person {
        let mut c = Collab::new(id, clock());
        c.seed(&doc);
        Person { s: Session::new(doc), c }
    }

    fn join(id: u64, from: &Person) -> Person {
        let mut c = Collab::new(id, clock());
        let (doc, _) = c.apply_remote(&from.c.encode_state(), &[]).unwrap();
        Person { s: Session::new(doc), c }
    }

    fn at(&mut self, block: usize, off: usize) {
        self.s.sel = Selection::caret(Pos::body(block, off));
    }

    fn select(&mut self, block: usize, from: usize, to: usize) {
        self.s.sel = Selection { anchor: Pos::body(block, from), focus: Pos::body(block, to) };
    }

    fn run(&mut self, id: &str, params: Value) {
        self.s.run(id, &params).unwrap();
        self.c.push_local(&self.s.doc);
    }

    fn receive(&mut self, updates: &[Vec<u8>]) {
        for u in updates {
            let sel = [self.s.sel.anchor.clone(), self.s.sel.focus.clone()];
            let (doc, mapped) = self.c.apply_remote(u, &sel).unwrap();
            self.s.doc = doc;
            self.s.sel = Selection { anchor: mapped[0].clone(), focus: mapped[1].clone() };
        }
    }

    fn undo(&mut self) {
        let sel = [self.s.sel.anchor.clone(), self.s.sel.focus.clone()];
        let (doc, _) = self.c.undo(&sel).unwrap().unwrap();
        self.s.doc = doc;
    }

    fn text(&self, block: usize) -> String {
        self.s.doc.body[block].as_para().map(|p| p.text.clone()).unwrap_or_default()
    }

    fn body_texts(&self) -> Vec<String> {
        self.s.doc.body.iter().map(|b| b.as_para().map(|p| p.text.clone()).unwrap_or_else(|| "<table>".into())).collect()
    }
}

/// Deliver everything each person has sent to everyone else.
fn sync(people: &mut [&mut Person]) {
    let outgoing: Vec<Vec<Vec<u8>>> = people.iter().map(|p| p.c.take_updates()).collect();
    for (i, p) in people.iter_mut().enumerate() {
        for (j, ups) in outgoing.iter().enumerate() {
            if i != j {
                p.receive(ups);
            }
        }
    }
    // Merging can't produce new local updates, but drain anyway.
    for p in people.iter() {
        assert!(p.c.take_updates().is_empty(), "applying remote updates must not echo");
    }
}

fn simple(texts: &[&str]) -> Document {
    let mut d = Document::new();
    d.body = texts
        .iter()
        .map(|t| {
            let mut p = Paragraph::new();
            p.text = t.to_string();
            p.runs = vec![Run { len: t.len(), props: CharProps::default() }];
            Arc::new(Block::Para(p))
        })
        .collect();
    d
}

fn assert_converged(a: &Person, b: &Person) {
    assert_eq!(a.s.doc.body, b.s.doc.body, "bodies differ");
    assert_eq!(a.s.doc.parts, b.s.doc.parts, "parts differ");
    assert_eq!(a.s.doc.comments, b.s.doc.comments, "comments differ");
}

#[test]
fn sample_document_round_trips_through_the_crdt() {
    let doc = wordcraft_engine::sample::sample_document();
    let a = Person::first(1, doc.clone());
    let b = Person::join(2, &a);
    assert_eq!(b.s.doc.body, doc.body);
    assert_eq!(b.s.doc.parts, doc.parts);
    assert_eq!(b.s.doc.styles, doc.styles);
    assert_eq!(b.s.doc.media.len(), doc.media.len());
    // And the shared state round-trips through the Yjs encoding.
    let mut c = Collab::new(3, clock());
    let (again, _) = c.apply_remote(&a.c.encode_state(), &[]).unwrap();
    assert_eq!(again.body, doc.body);
}

#[test]
fn concurrent_typing_in_one_paragraph_keeps_both() {
    let mut a = Person::first(1, simple(&["The studio opens at nine."]));
    let mut b = Person::join(2, &a);
    a.at(0, 0);
    a.run("text.insert", json!({"text": "Note: "}));
    b.at(0, "The studio opens at nine".len());
    b.run("text.insert", json!({"text": " on weekdays"}));
    sync(&mut [&mut a, &mut b]);
    assert_eq!(a.text(0), "Note: The studio opens at nine on weekdays.");
    assert_converged(&a, &b);
}

#[test]
fn concurrent_bold_and_italic_on_the_same_word_both_apply() {
    let mut a = Person::first(1, simple(&["shared studio space"]));
    let mut b = Person::join(2, &a);
    a.select(0, 7, 13);
    a.run("format.bold", json!({}));
    b.select(0, 7, 13);
    b.run("format.italic", json!({}));
    sync(&mut [&mut a, &mut b]);
    assert_converged(&a, &b);
    let p = a.s.doc.body[0].as_para().unwrap();
    let mut at = 0;
    let props = p.runs.iter().find(|r| {
        let hit = at == 7;
        at += r.len;
        hit
    });
    let props = &props.expect("a run starts at the word").props;
    assert_eq!(props.bold, Some(true), "bold kept: {:?}", p.runs);
    assert_eq!(props.italic, Some(true), "italic kept: {:?}", p.runs);
}

#[test]
fn split_paragraph_while_someone_types_in_it() {
    let mut a = Person::first(1, simple(&["First half. Second half."]));
    let mut b = Person::join(2, &a);
    a.at(0, "First half.".len());
    a.run("text.newParagraph", json!({}));
    b.at(0, "First half. Second".len());
    b.run("text.insert", json!({"text": " and final"}));
    sync(&mut [&mut a, &mut b]);
    assert_converged(&a, &b);
    let all = a.body_texts().join("|");
    assert!(all.contains("First half."), "{all}");
    // B's words survive even though A moved the text they were typed into.
    assert!(all.contains("and final"), "{all}");
    assert!(a.s.doc.body.len() >= 2, "split survived: {all}");
}

#[test]
fn different_paragraphs_and_new_paragraphs_merge() {
    let mut a = Person::first(1, simple(&["One", "Two", "Three"]));
    let mut b = Person::join(2, &a);
    a.at(0, 3);
    a.run("text.insert", json!({"text": "!"}));
    b.at(2, 5);
    b.run("text.newParagraph", json!({}));
    b.run("text.insert", json!({"text": "Four"}));
    sync(&mut [&mut a, &mut b]);
    assert_converged(&a, &b);
    assert_eq!(a.body_texts(), vec!["One!", "Two", "Three", "Four"]);
}

#[test]
fn undo_takes_back_only_my_change() {
    let mut a = Person::first(1, simple(&["alpha"]));
    let mut b = Person::join(2, &a);
    a.at(0, 5);
    a.run("text.insert", json!({"text": " beta"}));
    sync(&mut [&mut a, &mut b]);
    b.at(0, 0);
    b.run("text.insert", json!({"text": "gamma "}));
    sync(&mut [&mut a, &mut b]);
    assert_eq!(a.text(0), "gamma alpha beta");
    a.undo();
    sync(&mut [&mut a, &mut b]);
    assert_eq!(a.text(0), "gamma alpha", "A's undo removes only A's text");
    assert_converged(&a, &b);
}

#[test]
fn caret_anchor_follows_remote_edits() {
    let mut a = Person::first(1, simple(&["hello world"]));
    let mut b = Person::join(2, &a);
    b.at(0, 6); // before "world"
    let anchor = b.c.anchor(&b.s.sel.focus).unwrap();
    a.at(0, 0);
    a.run("text.insert", json!({"text": "say "}));
    sync(&mut [&mut a, &mut b]);
    // B's own caret moved with the text...
    assert_eq!(b.s.sel.focus.off, 10);
    // ...and an anchor shared through awareness resolves to the same place on A's side.
    assert_eq!(a.c.resolve(&anchor), Some(Pos::body(0, 10)));
}

#[test]
fn caret_at_paragraph_end_and_start_can_be_shared() {
    let mut a = Person::first(1, simple(&["typing here"]));
    let mut b = Person::join(2, &a);
    let end = b.c.anchor(&Pos::body(0, 11)).expect("end of paragraph");
    let start = b.c.anchor(&Pos::body(0, 0)).expect("start of paragraph");
    a.at(0, 0);
    a.run("text.insert", json!({"text": "> "}));
    sync(&mut [&mut a, &mut b]);
    assert_eq!(a.c.resolve(&end), Some(Pos::body(0, 13)));
    assert_eq!(b.c.resolve(&end), Some(Pos::body(0, 13)));
    assert!(a.c.resolve(&start).is_some());
    // An empty paragraph too.
    let mut c = Person::first(3, simple(&[""]));
    assert!(c.c.anchor(&Pos::body(0, 0)).is_some());
    c.at(0, 0);
    c.run("text.insert", json!({"text": "x"}));
}

#[test]
fn tables_merge_cell_by_cell() {
    let mut a = Person::first(1, simple(&["before", "after"]));
    a.at(0, 6);
    a.run("insert.table", json!({"rows": 2, "cols": 2}));
    let mut b = Person::join(2, &a);
    assert_converged(&a, &b);
    let table_at = a.s.doc.body.iter().position(|bl| bl.as_table().is_some()).unwrap();
    a.s.sel = Selection::caret(Pos { story: StoryRef::Body, path: Path(vec![table_at as u32, 0, 0, 0]), off: 0 });
    a.run("text.insert", json!({"text": "A1"}));
    b.s.sel = Selection::caret(Pos { story: StoryRef::Body, path: Path(vec![table_at as u32, 1, 1, 0]), off: 0 });
    b.run("text.insert", json!({"text": "B2"}));
    sync(&mut [&mut a, &mut b]);
    assert_converged(&a, &b);
    let t = a.s.doc.body[table_at].as_table().unwrap();
    assert_eq!(t.rows[0].cells[0].blocks[0].as_para().unwrap().text, "A1");
    assert_eq!(t.rows[1].cells[1].blocks[0].as_para().unwrap().text, "B2");
}

#[test]
fn three_people_converge_after_interleaved_edits() {
    let mut a = Person::first(1, simple(&["abc", "def"]));
    let mut b = Person::join(2, &a);
    let mut c = Person::join(3, &a);
    a.at(0, 1);
    a.run("text.insert", json!({"text": "X"}));
    b.at(0, 2);
    b.run("text.insert", json!({"text": "Y"}));
    c.at(1, 0);
    c.run("text.backspace", json!({}));
    c.at(0, 3);
    c.run("text.insert", json!({"text": "Z"}));
    sync(&mut [&mut a, &mut b, &mut c]);
    assert_converged(&a, &b);
    assert_converged(&b, &c);
}

#[test]
fn positions_convert_between_bytes_and_crdt_units() {
    let t = format!("ab{OBJ}é c");
    assert_eq!(byte_to_y(&t, 2), 2);
    assert_eq!(byte_to_y(&t, 5), 3); // after the object (3 bytes in text, 1 embed)
    assert_eq!(y_to_byte(&t, 3), 5);
    assert_eq!(y_to_byte(&t, 99), t.len());
}
