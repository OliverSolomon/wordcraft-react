//! Real-time co-editing for WordCraft documents.
//!
//! A [`Collab`] keeps a WordCraft [`Document`] and a Yjs-compatible CRDT document ([`yrs`]) in
//! step, so any Yjs provider (y-websocket, Hocuspocus, Liveblocks, PartyKit, WebRTC...) can sync
//! WordCraft between people the way Word's co-authoring does:
//!
//! - **Character-level merging.** Each paragraph is a shared text whose characters carry their
//!   formatting. Two people typing in the same paragraph both keep their words.
//! - **Property-level formatting merges.** Character and paragraph formatting are stored one
//!   property per attribute, so one person making a word bold while another makes it italic ends
//!   up bold italic, rather than one change winning.
//! - **Structure.** Paragraph splits and joins, tables (rows, cells, nested blocks), headers,
//!   footers, notes and text boxes, comments, pictures and document settings are all shared.
//! - **Per-person undo.** [`Collab::undo`] takes back only this person's own changes, as Word does.
//! - **Cursors that follow edits.** Positions are encoded as Yjs relative positions, so a remote
//!   caret stays on its word while others type around it.
//!
//! The flow, from the editor's side:
//! 1. [`Collab::new`], then either [`Collab::seed`] (first person, from the open document) or
//!    [`Collab::apply_remote`] with the shared state and [`Collab::document`].
//! 2. After every local edit, [`Collab::push_local`] with the edited document.
//! 3. Send what [`Collab::take_updates`] returns to the provider; feed what arrives into
//!    [`Collab::apply_remote`], which returns the merged document and the remapped selection.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![forbid(unsafe_code)]

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use wordcraft_doc::para::{InlineObject, OBJ, Paragraph, Run, next_rev};
use wordcraft_doc::props::CharProps;
use wordcraft_doc::table::{Cell, Row, Table};
use wordcraft_doc::{Block, Blocks, Document, Part, Path, Pos, StoryRef};
use yrs::sync::time::Clock;
use yrs::types::Attrs;
use yrs::types::text::{Diff, YChange};
use yrs::undo::{Options as UndoOptions, UndoManager};
use yrs::updates::decoder::Decode as _;
use yrs::updates::encoder::Encode as _;
use yrs::{
    Any, Array as _, ArrayPrelim, ArrayRef, Assoc, BranchID, Doc, IndexedSequence as _, Map as _, MapPrelim, MapRef, Options, Origin, Out, ReadTxn,
    StickyIndex, Text as _, TextPrelim, TextRef, Transact as _, TransactionMut, Update,
};

/// Version of the shared-document layout, stored in `meta.schema`.
pub const SCHEMA: i64 = 1;

const ORIGIN_LOCAL: &str = "wordcraft:local";
const ORIGIN_REMOTE: &str = "wordcraft:remote";
const ORIGIN_SEED: &str = "wordcraft:seed";

/// Document fields with their own shared structure (everything else is one value per key in
/// `meta`, last writer wins).
const STRUCTURED: &[&str] = &["body", "parts", "comments"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollabError {
    /// An update from a peer could not be decoded or applied.
    BadUpdate(String),
    /// The shared document doesn't describe a WordCraft document this version understands.
    BadDocument(String),
}

impl std::fmt::Display for CollabError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CollabError::BadUpdate(e) => write!(f, "couldn't apply a collaboration update: {e}"),
            CollabError::BadDocument(e) => write!(f, "the shared document isn't a WordCraft document: {e}"),
        }
    }
}

impl std::error::Error for CollabError {}

/// A WordCraft document shared through a Yjs-compatible CRDT.
/// The document's root shared types (looked up once: yrs can't create or look up roots while a
/// transaction is open).
#[derive(Clone)]
struct Roots {
    body: ArrayRef,
    parts: MapRef,
    meta: MapRef,
    comments: MapRef,
    media: MapRef,
    passthrough: MapRef,
}

pub struct Collab {
    ydoc: Doc,
    roots: Roots,
    undo: UndoManager<()>,
    /// The document as last written to or read from the CRDT.
    shadow: Document,
    outbox: Arc<Mutex<Vec<Vec<u8>>>>,
}

/// A position in the shared document that survives other people's edits (a Yjs relative position).
pub type Anchor = Vec<u8>;

impl Collab {
    /// `client_id` must be unique among the people editing (a random u53 is fine); `clock` gives
    /// milliseconds for grouping undo steps (browsers have no `SystemTime`).
    pub fn new(client_id: u64, clock: Arc<dyn Clock>) -> Collab {
        let mut opts = Options::with_client_id(yrs::block::ClientID::new((client_id & ((1 << 53) - 1)).max(1)));
        opts.offset_kind = yrs::OffsetKind::Bytes;
        let ydoc = Doc::with_options(opts);
        // Root types exist before any transaction so lookups never need a write.
        let body = ydoc.get_or_insert_array("body");
        let parts = ydoc.get_or_insert_map("parts");
        let meta = ydoc.get_or_insert_map("meta");
        let comments = ydoc.get_or_insert_map("comments");
        let media = ydoc.get_or_insert_map("media");
        let passthrough = ydoc.get_or_insert_map("passthrough");

        let mut undo = UndoManager::with_options(UndoOptions {
            capture_timeout_millis: 500,
            tracked_origins: std::collections::HashSet::from([Origin::from(ORIGIN_LOCAL)]),
            capture_transaction: None,
            timestamp: clock,
            init_undo_stack: Vec::new(),
            init_redo_stack: Vec::new(),
        });
        undo.expand_scope(&ydoc, &body);
        undo.expand_scope(&ydoc, &parts);
        undo.expand_scope(&ydoc, &meta);
        undo.expand_scope(&ydoc, &comments);
        undo.expand_scope(&ydoc, &media);
        undo.expand_scope(&ydoc, &passthrough);

        let outbox: Arc<Mutex<Vec<Vec<u8>>>> = Arc::default();
        let sink = outbox.clone();
        let remote = Origin::from(ORIGIN_REMOTE);
        let observed = ydoc.observe_update_v1("wordcraft", move |txn: &TransactionMut, e: &yrs::UpdateEvent| {
            if txn.origin() != Some(&remote) {
                sink.lock().unwrap_or_else(|p| p.into_inner()).push(e.update.clone());
            }
        });
        if let Err(e) = observed {
            log::error!("collab: can't observe updates: {e}");
        }
        let roots = Roots { body, parts, meta, comments, media, passthrough };
        Collab { ydoc, roots, undo, shadow: Document::new(), outbox }
    }

    /// Whether nobody has put a document into the shared state yet.
    pub fn is_empty(&self) -> bool {
        let txn = self.ydoc.transact();
        self.roots.body.len(&txn) == 0 && self.roots.meta.get(&txn, "schema").is_none()
    }

    /// Put `doc` into an empty shared state (the first person to open the document does this).
    /// Not undoable.
    pub fn seed(&mut self, doc: &Document) {
        let mut txn = self.ydoc.transact_mut_with(ORIGIN_SEED);
        let empty = Document { body: Vec::new(), ..Document::new() };
        write_document(&mut txn, &self.roots, &empty, doc);
        self.roots.meta.insert(&mut txn, "schema", Any::from(SCHEMA as f64));
        drop(txn);
        self.shadow = doc.clone();
    }

    /// The document as the shared state describes it now.
    pub fn document(&self) -> &Document {
        &self.shadow
    }

    /// Record a local edit: write the difference between the last shared document and `doc`.
    pub fn push_local(&mut self, doc: &Document) {
        if docs_identical(&self.shadow, doc) {
            return;
        }
        let mut txn = self.ydoc.transact_mut_with(ORIGIN_LOCAL);
        write_document(&mut txn, &self.roots, &self.shadow, doc);
        drop(txn);
        self.shadow = doc.clone();
    }

    /// Apply an update from a peer (or the provider's initial state). Returns the merged document
    /// and `sel` remapped onto it.
    pub fn apply_remote(&mut self, update: &[u8], sel: &[Pos]) -> Result<(Document, Vec<Pos>), CollabError> {
        let anchors: Vec<Option<StickyIndex>> = sel.iter().map(|p| self.sticky(p)).collect();
        let update = Update::decode_v1(update).map_err(|e| CollabError::BadUpdate(e.to_string()))?;
        {
            let mut txn = self.ydoc.transact_mut_with(ORIGIN_REMOTE);
            txn.apply_update(update).map_err(|e| CollabError::BadUpdate(e.to_string()))?;
        }
        self.rebuild(&anchors, sel)
    }

    /// Undo this person's last change (others' changes stay). `None` when there is nothing to undo.
    pub fn undo(&mut self, sel: &[Pos]) -> Option<Result<(Document, Vec<Pos>), CollabError>> {
        let anchors: Vec<Option<StickyIndex>> = sel.iter().map(|p| self.sticky(p)).collect();
        if !self.undo.undo_blocking() {
            return None;
        }
        Some(self.rebuild(&anchors, sel))
    }

    /// Redo this person's last undone change.
    pub fn redo(&mut self, sel: &[Pos]) -> Option<Result<(Document, Vec<Pos>), CollabError>> {
        let anchors: Vec<Option<StickyIndex>> = sel.iter().map(|p| self.sticky(p)).collect();
        if !self.undo.redo_blocking() {
            return None;
        }
        Some(self.rebuild(&anchors, sel))
    }

    pub fn can_undo(&self) -> bool {
        self.undo.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.undo.can_redo()
    }

    /// Updates produced locally since the last call, for the provider (Yjs update v1 encoding).
    pub fn take_updates(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.outbox.lock().unwrap_or_else(|p| p.into_inner()))
    }

    /// The whole shared state as one Yjs update.
    pub fn encode_state(&self) -> Vec<u8> {
        self.ydoc.transact().encode_state_as_update_v1(&yrs::StateVector::default())
    }

    /// A position that follows edits, encoded like `Y.encodeRelativePosition` (for awareness).
    pub fn anchor(&self, pos: &Pos) -> Option<Anchor> {
        self.sticky(pos).map(|s| s.encode_v1())
    }

    /// Where an [`Anchor`] is now, if its paragraph still exists.
    pub fn resolve(&self, anchor: &[u8]) -> Option<Pos> {
        let sticky = StickyIndex::decode_v1(anchor).ok()?;
        let index = self.locations();
        resolve_sticky(&self.ydoc, &sticky, &index, &self.shadow)
    }

    fn sticky(&self, pos: &Pos) -> Option<StickyIndex> {
        let txn = self.ydoc.transact();
        let text = text_at(&self.roots, &txn, pos.story, &pos.path)?;
        let para = paragraph_at(&self.shadow, pos.story, &pos.path)?;
        let y = byte_to_y(&para.text, pos.off);
        text.sticky_index(&txn, y, Assoc::After)
    }

    /// Paragraph text id → its place in the document, for resolving positions.
    fn locations(&self) -> HashMap<BranchID, (StoryRef, Path)> {
        let txn = self.ydoc.transact();
        let mut out = HashMap::new();
        index_blocks(&txn, &self.roots.body, StoryRef::Body, &mut Vec::new(), &mut out);
        for (k, v) in self.roots.parts.iter(&txn) {
            if let (Ok(id), Ok(m)) = (k.parse::<u32>(), v.cast::<MapRef>())
                && let Some(blocks) = get_array(&txn, &m, "blocks")
            {
                index_blocks(&txn, &blocks, StoryRef::Part(id), &mut Vec::new(), &mut out);
            }
        }
        out
    }

    /// Read the shared state back into a document, reusing unchanged blocks, and remap `sel`.
    fn rebuild(&mut self, anchors: &[Option<StickyIndex>], sel: &[Pos]) -> Result<(Document, Vec<Pos>), CollabError> {
        let mut doc = {
            let txn = self.ydoc.transact();
            read_document(&self.roots, &txn)?
        };
        reuse_blocks(&mut doc.body, &self.shadow.body);
        for (id, part) in doc.parts.iter_mut() {
            if let Some(old) = self.shadow.parts.get(id) {
                reuse_blocks(&mut part.blocks, &old.blocks);
            }
        }
        self.shadow = doc.clone();
        let index = self.locations();
        let mapped = anchors
            .iter()
            .zip(sel)
            .map(|(a, fallback)| a.as_ref().and_then(|s| resolve_sticky(&self.ydoc, s, &index, &doc)).unwrap_or_else(|| clamp_pos(&doc, fallback)))
            .collect();
        Ok((doc, mapped))
    }
}

// ------------------------------------------------------------------------------------------------
// Positions

/// Paragraph byte offset → index in the shared text (an inline object is 3 bytes in WordCraft's
/// text but one embed in the CRDT).
pub fn byte_to_y(text: &str, off: usize) -> u32 {
    let mut y = 0usize;
    for (i, c) in text.char_indices() {
        if i >= off {
            break;
        }
        y += if c == OBJ { 1 } else { c.len_utf8() };
    }
    u32::try_from(y).unwrap_or(u32::MAX)
}

/// Inverse of [`byte_to_y`], landing on a character boundary.
pub fn y_to_byte(text: &str, y: u32) -> usize {
    let mut acc = 0u32;
    for (i, c) in text.char_indices() {
        if acc >= y {
            return i;
        }
        acc += if c == OBJ { 1 } else { c.len_utf8() as u32 };
    }
    text.len()
}

fn paragraph_at<'a>(doc: &'a Document, story: StoryRef, path: &Path) -> Option<&'a Paragraph> {
    let blocks = match story {
        StoryRef::Body => &doc.body,
        StoryRef::Part(id) => &doc.parts.get(&id)?.blocks,
    };
    block_at(blocks, &path.0)?.as_para()
}

fn block_at<'a>(blocks: &'a Blocks, path: &[u32]) -> Option<&'a Block> {
    let (&first, rest) = path.split_first()?;
    let block = blocks.get(first as usize)?;
    if rest.is_empty() {
        return Some(block);
    }
    let (&r, rest) = rest.split_first()?;
    let (&c, rest) = rest.split_first()?;
    let cell = block.as_table()?.rows.get(r as usize)?.cells.get(c as usize)?;
    block_at(&cell.blocks, rest)
}

fn clamp_pos(doc: &Document, p: &Pos) -> Pos {
    if let Some(para) = paragraph_at(doc, p.story, &p.path) {
        let mut off = p.off.min(para.text.len());
        while off > 0 && !para.text.is_char_boundary(off) {
            off -= 1;
        }
        return Pos { story: p.story, path: p.path.clone(), off };
    }
    Pos::body(0, 0)
}

fn resolve_sticky(ydoc: &Doc, sticky: &StickyIndex, index: &HashMap<BranchID, (StoryRef, Path)>, doc: &Document) -> Option<Pos> {
    let txn = ydoc.transact();
    let off = sticky.get_offset(&txn)?;
    let (story, path) = index.get(&off.branch.id())?.clone();
    let para = paragraph_at(doc, story, &path)?;
    Some(Pos { story, path, off: y_to_byte(&para.text, off.index) })
}

fn index_blocks<T: ReadTxn>(txn: &T, arr: &ArrayRef, story: StoryRef, prefix: &mut Vec<u32>, out: &mut HashMap<BranchID, (StoryRef, Path)>) {
    for (i, v) in arr.iter(txn).enumerate() {
        let Ok(m) = v.cast::<MapRef>() else { continue };
        prefix.push(i as u32);
        match get_str(txn, &m, "t").as_deref() {
            Some("tbl") => {
                if let Some(rows) = get_array(txn, &m, "rows") {
                    for (ri, row) in rows.iter(txn).enumerate() {
                        let Some(cells) = row.cast::<MapRef>().ok().and_then(|r| get_array(txn, &r, "cells")) else { continue };
                        for (ci, cell) in cells.iter(txn).enumerate() {
                            if let Some(blocks) = cell.cast::<MapRef>().ok().and_then(|c| get_array(txn, &c, "blocks")) {
                                prefix.push(ri as u32);
                                prefix.push(ci as u32);
                                index_blocks(txn, &blocks, story, prefix, out);
                                prefix.pop();
                                prefix.pop();
                            }
                        }
                    }
                }
            }
            _ => {
                if let Some(text) = get_text(txn, &m, "text") {
                    let branch: &yrs::branch::Branch = text.as_ref();
                    out.insert(branch.id(), (story, Path(prefix.clone())));
                }
            }
        }
        prefix.pop();
    }
}

fn text_at<T: ReadTxn>(roots: &Roots, txn: &T, story: StoryRef, path: &Path) -> Option<TextRef> {
    let mut arr = match story {
        StoryRef::Body => roots.body.clone(),
        StoryRef::Part(id) => {
            let part = roots.parts.get(txn, &id.to_string())?.cast::<MapRef>().ok()?;
            get_array(txn, &part, "blocks")?
        }
    };
    let mut rest: &[u32] = &path.0;
    loop {
        let (&b, tail) = rest.split_first()?;
        let block = arr.get(txn, b)?.cast::<MapRef>().ok()?;
        if tail.is_empty() {
            return get_text(txn, &block, "text");
        }
        let (&r, tail) = tail.split_first()?;
        let (&c, tail) = tail.split_first()?;
        let row = get_array(txn, &block, "rows")?.get(txn, r)?.cast::<MapRef>().ok()?;
        let cell = get_array(txn, &row, "cells")?.get(txn, c)?.cast::<MapRef>().ok()?;
        arr = get_array(txn, &cell, "blocks")?;
        rest = tail;
    }
}

// ------------------------------------------------------------------------------------------------
// Small accessors

fn get_array<T: ReadTxn>(txn: &T, m: &MapRef, key: &str) -> Option<ArrayRef> {
    m.get(txn, key)?.cast::<ArrayRef>().ok()
}

fn get_text<T: ReadTxn>(txn: &T, m: &MapRef, key: &str) -> Option<TextRef> {
    m.get(txn, key)?.cast::<TextRef>().ok()
}

fn get_str<T: ReadTxn>(txn: &T, m: &MapRef, key: &str) -> Option<String> {
    match m.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn get_json<T: ReadTxn>(txn: &T, m: &MapRef, key: &str) -> Option<Value> {
    serde_json::from_str(&get_str(txn, m, key)?).ok()
}

fn to_json<S: serde::Serialize>(v: &S) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn json_str(v: &Value) -> Any {
    Any::from(v.to_string())
}

/// `Value::Object` entries, or nothing.
fn entries(v: &Value) -> BTreeMap<String, Value> {
    v.as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
}

/// Set `prefix + key` for every key of `new` that differs from `old`, and remove the ones `new`
/// dropped (one shared entry per property, so concurrent changes to different properties merge).
fn sync_keyed(txn: &mut TransactionMut, m: &MapRef, prefix: &str, old: &Value, new: &Value) {
    let (old, new) = (entries(old), entries(new));
    for (k, v) in &new {
        if old.get(k) != Some(v) {
            m.insert(txn, format!("{prefix}{k}"), json_str(v));
        }
    }
    for k in old.keys() {
        if !new.contains_key(k) {
            m.remove(txn, &format!("{prefix}{k}"));
        }
    }
}

fn read_keyed<T: ReadTxn>(txn: &T, m: &MapRef, prefix: &str) -> Value {
    let mut out = serde_json::Map::new();
    for (k, v) in m.iter(txn) {
        if let (Some(key), Out::Any(Any::String(s))) = (k.strip_prefix(prefix), &v)
            && let Ok(val) = serde_json::from_str::<Value>(s)
        {
            out.insert(key.to_string(), val);
        }
    }
    Value::Object(out)
}

// ------------------------------------------------------------------------------------------------
// Writing: document → shared state (as a diff against the previous document)

fn docs_identical(a: &Document, b: &Document) -> bool {
    blocks_identical(&a.body, &b.body)
        && a.parts.len() == b.parts.len()
        && a.parts.iter().zip(&b.parts).all(|((ka, pa), (kb, pb))| ka == kb && pa.kind == pb.kind && blocks_identical(&pa.blocks, &pb.blocks))
        && a.comments == b.comments
        && a.media.len() == b.media.len()
        && a.media.keys().eq(b.media.keys())
        && meta_of(a) == meta_of(b)
}

fn blocks_identical(a: &Blocks, b: &Blocks) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| Arc::ptr_eq(x, y) || x == y)
}

/// The document's fields that are shared as one value each.
fn meta_of(doc: &Document) -> BTreeMap<String, Value> {
    let mut m = entries(&to_json(doc));
    for k in STRUCTURED {
        m.remove(*k);
    }
    m
}

fn write_document(txn: &mut TransactionMut, roots: &Roots, old: &Document, new: &Document) {
    sync_blocks(txn, &roots.body, &old.body, &new.body);

    let parts = &roots.parts;
    for (id, part) in &new.parts {
        let key = id.to_string();
        let existing = parts.get(txn, &key).and_then(|v| v.cast::<MapRef>().ok());
        match (old.parts.get(id), existing) {
            (Some(o), Some(m)) => {
                if o.kind != part.kind {
                    m.insert(txn, "kind", json_str(&to_json(&part.kind)));
                }
                if let Some(arr) = get_array(txn, &m, "blocks") {
                    sync_blocks(txn, &arr, &o.blocks, &part.blocks);
                }
            }
            _ => {
                let m = parts.insert(txn, key, MapPrelim::default());
                write_part(txn, &m, part);
            }
        }
    }
    for id in old.parts.keys() {
        if !new.parts.contains_key(id) {
            parts.remove(txn, &id.to_string());
        }
    }

    let comments = &roots.comments;
    for (id, c) in &new.comments {
        if old.comments.get(id) != Some(c) {
            comments.insert(txn, id.to_string(), json_str(&to_json(c)));
        }
    }
    for id in old.comments.keys() {
        if !new.comments.contains_key(id) {
            comments.remove(txn, &id.to_string());
        }
    }

    let meta = &roots.meta;
    let (om, nm) = (meta_of(old), meta_of(new));
    for (k, v) in &nm {
        if om.get(k) != Some(v) {
            meta.insert(txn, k.as_str(), json_str(v));
        }
    }

    for (map, (o, n)) in [(&roots.media, (&old.media, &new.media)), (&roots.passthrough, (&old.passthrough, &new.passthrough))] {
        for (k, bytes) in n {
            if o.get(k).is_none_or(|ob| !Arc::ptr_eq(ob, bytes) && ob != bytes) {
                map.insert(txn, k.as_str(), Any::Buffer(Arc::from(bytes.as_slice())));
            }
        }
        for k in o.keys() {
            if !n.contains_key(k) {
                map.remove(txn, k);
            }
        }
    }
}

fn write_part(txn: &mut TransactionMut, m: &MapRef, part: &Part) {
    m.insert(txn, "kind", json_str(&to_json(&part.kind)));
    let arr = m.insert(txn, "blocks", ArrayPrelim::default());
    for (i, b) in part.blocks.iter().enumerate() {
        insert_block(txn, &arr, i as u32, b);
    }
}

fn same_block(a: &Arc<Block>, b: &Arc<Block>) -> bool {
    Arc::ptr_eq(a, b) || a == b
}

/// Make the shared array `arr` (which mirrors `old`) describe `new`, touching as little as
/// possible: the common start and end stay, blocks in between are edited in place pairwise (a
/// paragraph split keeps its first half in place), and the rest are inserted or removed.
fn sync_blocks(txn: &mut TransactionMut, arr: &ArrayRef, old: &[Arc<Block>], new: &[Arc<Block>]) {
    let (ol, nl) = (old.len(), new.len());
    let mut pre = 0;
    while pre < ol && pre < nl && same_block(&old[pre], &new[pre]) {
        pre += 1;
    }
    let mut suf = 0;
    while suf < ol - pre && suf < nl - pre && same_block(&old[ol - 1 - suf], &new[nl - 1 - suf]) {
        suf += 1;
    }
    let (mo, mn) = (ol - pre - suf, nl - pre - suf);
    let paired = mo.min(mn);
    for j in 0..paired {
        let idx = (pre + j) as u32;
        let (o, n) = (&old[pre + j], &new[pre + j]);
        let target = arr.get(txn, idx).and_then(|v| v.cast::<MapRef>().ok());
        match (o.as_ref(), n.as_ref(), target) {
            (Block::Para(op), Block::Para(np), Some(m)) => update_para(txn, &m, op, np),
            (Block::Table(ot), Block::Table(nt), Some(m)) => update_table(txn, &m, ot, nt),
            _ => {
                arr.remove(txn, idx);
                insert_block(txn, arr, idx, n);
            }
        }
    }
    let at = (pre + paired) as u32;
    if mo > mn {
        arr.remove_range(txn, at, (mo - mn) as u32);
    } else {
        for (k, b) in new[pre + paired..pre + mn].iter().enumerate() {
            insert_block(txn, arr, at + k as u32, b);
        }
    }
}

fn insert_block(txn: &mut TransactionMut, arr: &ArrayRef, idx: u32, b: &Block) {
    let m = arr.insert(txn, idx, MapPrelim::default());
    match b {
        Block::Para(p) => {
            m.insert(txn, "t", "p");
            let empty = Paragraph {
                text: String::new(),
                runs: Vec::new(),
                props: Default::default(),
                mark: Default::default(),
                objects: Vec::new(),
                section: None,
                rev: 0,
            };
            write_para_props(txn, &m, &empty, p, true);
            let text = m.insert(txn, "text", TextPrelim::new(""));
            insert_units(txn, &text, 0, &units(p));
        }
        Block::Table(t) => {
            m.insert(txn, "t", "tbl");
            m.insert(txn, "props", json_str(&to_json(&t.props)));
            m.insert(txn, "grid", json_str(&to_json(&t.grid)));
            let rows = m.insert(txn, "rows", ArrayPrelim::default());
            for (ri, r) in t.rows.iter().enumerate() {
                insert_row(txn, &rows, ri as u32, r);
            }
        }
    }
}

fn insert_row(txn: &mut TransactionMut, rows: &ArrayRef, idx: u32, r: &Row) {
    let rm = rows.insert(txn, idx, MapPrelim::default());
    rm.insert(txn, "props", json_str(&to_json(&r.props)));
    let cells = rm.insert(txn, "cells", ArrayPrelim::default());
    for (ci, c) in r.cells.iter().enumerate() {
        insert_cell(txn, &cells, ci as u32, c);
    }
}

fn insert_cell(txn: &mut TransactionMut, cells: &ArrayRef, idx: u32, c: &Cell) {
    let cm = cells.insert(txn, idx, MapPrelim::default());
    cm.insert(txn, "props", json_str(&to_json(&c.props)));
    let blocks = cm.insert(txn, "blocks", ArrayPrelim::default());
    for (bi, b) in c.blocks.iter().enumerate() {
        insert_block(txn, &blocks, bi as u32, b);
    }
}

fn update_table(txn: &mut TransactionMut, m: &MapRef, old: &Table, new: &Table) {
    if old.props != new.props {
        m.insert(txn, "props", json_str(&to_json(&new.props)));
    }
    if old.grid != new.grid {
        m.insert(txn, "grid", json_str(&to_json(&new.grid)));
    }
    let Some(rows) = get_array(txn, m, "rows") else { return };
    let (ol, nl) = (old.rows.len(), new.rows.len());
    let mut pre = 0;
    while pre < ol && pre < nl && old.rows[pre] == new.rows[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < ol - pre && suf < nl - pre && old.rows[ol - 1 - suf] == new.rows[nl - 1 - suf] {
        suf += 1;
    }
    let (mo, mn) = (ol - pre - suf, nl - pre - suf);
    let paired = mo.min(mn);
    for j in 0..paired {
        let (o, n) = (&old.rows[pre + j], &new.rows[pre + j]);
        let Some(rm) = rows.get(txn, (pre + j) as u32).and_then(|v| v.cast::<MapRef>().ok()) else { continue };
        if o.props != n.props {
            rm.insert(txn, "props", json_str(&to_json(&n.props)));
        }
        let Some(cells) = get_array(txn, &rm, "cells") else { continue };
        let common = o.cells.len().min(n.cells.len());
        for c in 0..common {
            let (oc, nc) = (&o.cells[c], &n.cells[c]);
            if oc == nc {
                continue;
            }
            let Some(cm) = cells.get(txn, c as u32).and_then(|v| v.cast::<MapRef>().ok()) else { continue };
            if oc.props != nc.props {
                cm.insert(txn, "props", json_str(&to_json(&nc.props)));
            }
            if let Some(blocks) = get_array(txn, &cm, "blocks") {
                sync_blocks(txn, &blocks, &oc.blocks, &nc.blocks);
            }
        }
        if o.cells.len() > common {
            cells.remove_range(txn, common as u32, (o.cells.len() - common) as u32);
        }
        for (k, c) in n.cells.iter().enumerate().skip(common) {
            insert_cell(txn, &cells, k as u32, c);
        }
    }
    let at = (pre + paired) as u32;
    if mo > mn {
        rows.remove_range(txn, at, (mo - mn) as u32);
    } else {
        for (k, r) in new.rows[pre + paired..pre + mn].iter().enumerate() {
            insert_row(txn, &rows, at + k as u32, r);
        }
    }
}

fn write_para_props(txn: &mut TransactionMut, m: &MapRef, old: &Paragraph, new: &Paragraph, fresh: bool) {
    sync_keyed(txn, m, "p:", &to_json(&old.props), &to_json(&new.props));
    if fresh || old.mark != new.mark {
        m.insert(txn, "mark", json_str(&to_json(&new.mark)));
    }
    if fresh || old.section != new.section {
        match &new.section {
            Some(s) => {
                m.insert(txn, "section", json_str(&to_json(s)));
            }
            None => {
                m.remove(txn, "section");
            }
        }
    }
}

/// One character or inline object of a paragraph, with its formatting.
#[derive(Clone, Debug, PartialEq)]
enum Unit<'a> {
    Char(char, &'a CharProps),
    Obj(&'a InlineObject, &'a CharProps),
}

impl Unit<'_> {
    fn same_content(&self, o: &Unit) -> bool {
        match (self, o) {
            (Unit::Char(a, _), Unit::Char(b, _)) => a == b,
            (Unit::Obj(a, _), Unit::Obj(b, _)) => a == b,
            _ => false,
        }
    }
    fn props(&self) -> &CharProps {
        match self {
            Unit::Char(_, p) | Unit::Obj(_, p) => p,
        }
    }
    fn y_len(&self) -> u32 {
        match self {
            Unit::Char(c, _) => c.len_utf8() as u32,
            Unit::Obj(..) => 1,
        }
    }
}

static NO_PROPS: std::sync::LazyLock<CharProps> = std::sync::LazyLock::new(CharProps::default);

fn units(p: &Paragraph) -> Vec<Unit<'_>> {
    let mut out = Vec::with_capacity(p.text.len());
    let mut run_i = 0usize;
    let mut run_end = p.runs.first().map_or(usize::MAX, |r| r.len);
    let mut obj_i = 0usize;
    for (i, c) in p.text.char_indices() {
        while i >= run_end && run_i + 1 < p.runs.len() {
            run_i += 1;
            run_end += p.runs[run_i].len;
        }
        let props = p.runs.get(run_i).map_or(&*NO_PROPS, |r| &r.props);
        if c == OBJ {
            match p.objects.get(obj_i) {
                Some(o) => out.push(Unit::Obj(o, props)),
                None => out.push(Unit::Char(c, props)),
            }
            obj_i += 1;
        } else {
            out.push(Unit::Char(c, props));
        }
    }
    out
}

/// Formatting as shared attributes: one `c:<property>` attribute per character property.
fn attrs_of(props: &CharProps) -> Attrs {
    entries(&to_json(props)).into_iter().map(|(k, v)| (Arc::from(format!("c:{k}").as_str()), json_str(&v))).collect()
}

/// Attributes that turn `old` formatting into `new` (removed properties become null).
fn attr_change(old: &CharProps, new: &CharProps) -> Attrs {
    let (o, n) = (entries(&to_json(old)), entries(&to_json(new)));
    let mut a = Attrs::new();
    for (k, v) in &n {
        if o.get(k) != Some(v) {
            a.insert(Arc::from(format!("c:{k}").as_str()), json_str(v));
        }
    }
    for k in o.keys() {
        if !n.contains_key(k) {
            a.insert(Arc::from(format!("c:{k}").as_str()), Any::Null);
        }
    }
    a
}

fn insert_units(txn: &mut TransactionMut, text: &TextRef, mut at: u32, us: &[Unit]) {
    let mut i = 0;
    while i < us.len() {
        match &us[i] {
            Unit::Obj(o, props) => {
                let mut embed = HashMap::new();
                embed.insert("obj".to_string(), Any::from(to_json(o).to_string()));
                text.insert_embed_with_attributes(txn, at, Any::from(embed), attrs_of(props));
                at += 1;
                i += 1;
            }
            Unit::Char(_, props) => {
                let mut s = String::new();
                let mut j = i;
                while let Some(Unit::Char(c, p)) = us.get(j) {
                    if *p != *props {
                        break;
                    }
                    s.push(*c);
                    j += 1;
                }
                let len = s.len() as u32;
                text.insert_with_attributes(txn, at, &s, attrs_of(props));
                at += len;
                i = j;
            }
        }
    }
}

fn update_para(txn: &mut TransactionMut, m: &MapRef, old: &Paragraph, new: &Paragraph) {
    write_para_props(txn, m, old, new, false);
    let Some(text) = get_text(txn, m, "text") else { return };
    let (ou, nu) = (units(old), units(new));
    if ou == nu {
        return;
    }
    // Content: keep the common start and end, replace what's between.
    let (ol, nl) = (ou.len(), nu.len());
    let mut pre = 0;
    while pre < ol && pre < nl && ou[pre].same_content(&nu[pre]) {
        pre += 1;
    }
    let mut suf = 0;
    while suf < ol - pre && suf < nl - pre && ou[ol - 1 - suf].same_content(&nu[nl - 1 - suf]) {
        suf += 1;
    }
    // Formatting changes inside the kept start and end, as format operations (so they merge
    // with other people's edits to the same text).
    let format_ranges = |pairs: &mut dyn Iterator<Item = (u32, &Unit, &Unit)>, txn: &mut TransactionMut| {
        let mut pending: Option<(u32, u32, Attrs)> = None;
        for (y, o, n) in pairs {
            let change = if o.props() == n.props() { None } else { Some(attr_change(o.props(), n.props())) };
            match (&mut pending, change) {
                (Some((start, len, a)), Some(c)) if *start + *len == y && *a == c => *len += n.y_len(),
                (_, change) => {
                    if let Some((s, l, a)) = pending.take() {
                        text.format(txn, s, l, a);
                    }
                    pending = change.map(|c| (y, n.y_len(), c));
                }
            }
        }
        if let Some((s, l, a)) = pending {
            text.format(txn, s, l, a);
        }
    };
    let mut y = 0u32;
    let mut head = Vec::with_capacity(pre);
    for k in 0..pre {
        head.push((y, &ou[k], &nu[k]));
        y += nu[k].y_len();
    }
    format_ranges(&mut head.into_iter(), txn);
    let del_start: u32 = ou[..pre].iter().map(Unit::y_len).sum();
    let del_len: u32 = ou[pre..ol - suf].iter().map(Unit::y_len).sum();
    if del_len > 0 {
        text.remove_range(txn, del_start, del_len);
    }
    insert_units(txn, &text, del_start, &nu[pre..nl - suf]);
    let mut y = del_start + nu[pre..nl - suf].iter().map(Unit::y_len).sum::<u32>();
    let mut tail = Vec::with_capacity(suf);
    for k in 0..suf {
        let (o, n) = (&ou[ol - suf + k], &nu[nl - suf + k]);
        tail.push((y, o, n));
        y += n.y_len();
    }
    format_ranges(&mut tail.into_iter(), txn);
}

// ------------------------------------------------------------------------------------------------
// Reading: shared state → document

fn read_document<T: ReadTxn>(roots: &Roots, txn: &T) -> Result<Document, CollabError> {
    let meta = &roots.meta;
    let mut obj = serde_json::Map::new();
    for (k, v) in meta.iter(txn) {
        if k == "schema" {
            continue;
        }
        if let Out::Any(Any::String(s)) = v
            && let Ok(val) = serde_json::from_str::<Value>(&s)
        {
            obj.insert(k.to_string(), val);
        }
    }
    obj.insert("body".into(), Value::Array(Vec::new()));
    obj.insert("parts".into(), Value::Object(Default::default()));
    obj.insert("comments".into(), Value::Object(Default::default()));
    let mut doc: Document = match serde_json::from_value(Value::Object(obj)) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("collab: document settings unreadable ({e}); using defaults");
            Document::new()
        }
    };
    doc.body = read_blocks(txn, &roots.body);
    doc.parts = BTreeMap::new();
    for (k, v) in roots.parts.iter(txn) {
        let (Ok(id), Ok(m)) = (k.parse::<u32>(), v.cast::<MapRef>()) else { continue };
        let kind = get_json(txn, &m, "kind").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let blocks = get_array(txn, &m, "blocks").map(|a| read_blocks(txn, &a)).unwrap_or_default();
        doc.parts.insert(id, Part { kind, blocks });
    }
    doc.comments = BTreeMap::new();
    for (k, v) in roots.comments.iter(txn) {
        if let (Ok(id), Out::Any(Any::String(s))) = (k.parse::<u32>(), v)
            && let Ok(c) = serde_json::from_str(&s)
        {
            doc.comments.insert(id, c);
        }
    }
    doc.media = read_bytes(txn, &roots.media);
    doc.passthrough = read_bytes(txn, &roots.passthrough);
    doc.ensure_nonempty();
    Ok(doc)
}

fn read_bytes<T: ReadTxn>(txn: &T, m: &MapRef) -> BTreeMap<String, Arc<Vec<u8>>> {
    m.iter(txn)
        .filter_map(|(k, v)| match v {
            Out::Any(Any::Buffer(b)) => Some((k.to_string(), Arc::new(b.to_vec()))),
            _ => None,
        })
        .collect()
}

fn read_blocks<T: ReadTxn>(txn: &T, arr: &ArrayRef) -> Blocks {
    arr.iter(txn).filter_map(|v| v.cast::<MapRef>().ok()).map(|m| Arc::new(read_block(txn, &m))).collect()
}

fn read_block<T: ReadTxn>(txn: &T, m: &MapRef) -> Block {
    if get_str(txn, m, "t").as_deref() == Some("tbl") {
        let props = get_json(txn, m, "props").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let grid = get_json(txn, m, "grid").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let rows = get_array(txn, m, "rows")
            .map(|rows| {
                rows.iter(txn)
                    .filter_map(|r| r.cast::<MapRef>().ok())
                    .map(|rm| Row {
                        props: get_json(txn, &rm, "props").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
                        cells: get_array(txn, &rm, "cells")
                            .map(|cells| {
                                cells
                                    .iter(txn)
                                    .filter_map(|c| c.cast::<MapRef>().ok())
                                    .map(|cm| {
                                        let mut blocks = get_array(txn, &cm, "blocks").map(|b| read_blocks(txn, &b)).unwrap_or_default();
                                        if blocks.is_empty() {
                                            blocks = Cell::empty().blocks;
                                        }
                                        Cell {
                                            props: get_json(txn, &cm, "props").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
                                            blocks,
                                        }
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        return Block::Table(Table { props, grid, rows });
    }
    Block::Para(read_para(txn, m))
}

fn read_para<T: ReadTxn>(txn: &T, m: &MapRef) -> Paragraph {
    let props = serde_json::from_value(read_keyed(txn, m, "p:")).unwrap_or_default();
    let mark = get_json(txn, m, "mark").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    let section = get_json(txn, m, "section").and_then(|v| serde_json::from_value(v).ok()).map(Box::new);
    let mut text = String::new();
    let mut runs: Vec<Run> = Vec::new();
    let mut objects = Vec::new();
    if let Some(t) = get_text(txn, m, "text") {
        let chunks: Vec<Diff<YChange>> = t.diff(txn, YChange::identity);
        for d in chunks {
            let props = props_of(d.attributes.as_deref());
            let piece = match d.insert {
                Out::Any(Any::String(s)) => s.to_string(),
                Out::Any(Any::Map(e)) => match e.get("obj") {
                    Some(Any::String(json)) => match serde_json::from_str::<InlineObject>(json) {
                        Ok(o) => {
                            objects.push(o);
                            OBJ.to_string()
                        }
                        Err(_) => continue,
                    },
                    _ => continue,
                },
                _ => continue,
            };
            if piece.is_empty() {
                continue;
            }
            match runs.last_mut() {
                Some(r) if r.props == props => r.len += piece.len(),
                _ => runs.push(Run { len: piece.len(), props }),
            }
            text.push_str(&piece);
        }
    }
    Paragraph { text, runs, props, mark, objects, section, rev: next_rev() }
}

fn props_of(attrs: Option<&Attrs>) -> CharProps {
    let Some(attrs) = attrs else { return CharProps::default() };
    let mut obj = serde_json::Map::new();
    for (k, v) in attrs {
        if let (Some(key), Any::String(s)) = (k.strip_prefix("c:"), v)
            && let Ok(val) = serde_json::from_str::<Value>(s)
        {
            obj.insert(key.to_string(), val);
        }
    }
    serde_json::from_value(Value::Object(obj)).unwrap_or_default()
}

/// Keep the previous `Arc` for blocks that didn't change, so layout caches stay warm.
fn reuse_blocks(new: &mut Blocks, old: &Blocks) {
    let (nl, ol) = (new.len(), old.len());
    for (i, block) in new.iter_mut().enumerate() {
        // Same index from the start, or same distance from the end (an insert or delete above).
        let candidates = [old.get(i), (nl - i <= ol).then(|| old.get(ol - (nl - i))).flatten()];
        if let Some(o) = candidates.into_iter().flatten().find(|o| ***o == **block) {
            *block = o.clone();
        }
    }
}

#[cfg(test)]
mod tests;
