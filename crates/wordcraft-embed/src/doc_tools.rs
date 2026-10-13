//! Reading the document for the host's panels (comments, writing checks, document chat), and
//! marks the host lays over the text (checker underlines, originality highlights).
//!
//! Text goes to JavaScript as each paragraph's plain text, with offsets in UTF-16 code units (a
//! JavaScript string's indices). Inline objects (comment anchors, bookmarks, fields) sit in the
//! paragraph as U+FFFC; in the plain text they read as their own text (a field's result) or as
//! nothing. [`PlainMap`] turns a plain-text offset back into a position in the paragraph.

use serde_json::{Value, json};
use wordcraft_doc::para::{InlineObject, OBJ, Paragraph};
use wordcraft_doc::{Block, Blocks, Document, Path, Pos, StoryRef};

/// Every paragraph of the body, tables included, with its path, in reading order.
pub fn paragraphs(doc: &Document) -> Vec<(Path, &Paragraph)> {
    fn walk<'a>(blocks: &'a Blocks, prefix: &[u32], out: &mut Vec<(Path, &'a Paragraph)>) {
        for (i, b) in blocks.iter().enumerate() {
            let mut path = prefix.to_vec();
            path.push(i as u32);
            match &**b {
                Block::Para(p) => out.push((Path(path), p)),
                Block::Table(t) => {
                    for (r, row) in t.rows.iter().enumerate() {
                        for (c, cell) in row.cells.iter().enumerate() {
                            let mut inner = path.clone();
                            inner.extend([r as u32, c as u32]);
                            walk(&cell.blocks, &inner, out);
                        }
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(&doc.body, &[], &mut out);
    out
}

/// A paragraph's plain text and, for every UTF-16 offset in it (and one past the end), the byte
/// offset in the paragraph it stands for.
pub struct PlainMap {
    pub text: String,
    offsets: Vec<usize>,
}

impl PlainMap {
    pub fn new(p: &Paragraph) -> PlainMap {
        let mut text = String::with_capacity(p.text.len());
        let mut offsets = Vec::with_capacity(p.text.len() + 1);
        let mut k = 0;
        for (byte, c) in p.text.char_indices() {
            if c == OBJ {
                let shown = p.objects.get(k).map(InlineObject::plain_text).unwrap_or("");
                for u in shown.chars() {
                    text.push(u);
                    offsets.extend(std::iter::repeat_n(byte, u.len_utf16()));
                }
                k += 1;
            } else {
                text.push(c);
                offsets.extend(std::iter::repeat_n(byte, c.len_utf16()));
            }
        }
        offsets.push(p.text.len());
        PlainMap { text, offsets }
    }

    /// The paragraph byte offset for UTF-16 offset `u` (clamped to the paragraph).
    pub fn byte(&self, u: usize) -> usize {
        self.offsets.get(u).or(self.offsets.last()).copied().unwrap_or(0)
    }

    /// The UTF-16 offset for paragraph byte offset `b` (the first that maps at or after it).
    pub fn utf16(&self, b: usize) -> usize {
        self.offsets.iter().position(|&o| o >= b).unwrap_or(self.offsets.len().saturating_sub(1))
    }
}

/// The paragraph at `path` in the body.
pub fn para_at<'a>(doc: &'a Document, path: &[u32]) -> Option<&'a Paragraph> {
    doc.para_at(&Pos::new(StoryRef::Body, Path(path.to_vec()), 0))
}

/// The body position for UTF-16 offset `u` in the paragraph at `path`.
pub fn pos_at(doc: &Document, path: &[u32], u: usize) -> Option<Pos> {
    let p = para_at(doc, path)?;
    Some(Pos::new(StoryRef::Body, Path(path.to_vec()), PlainMap::new(p).byte(u)))
}

/// `[{path, text, style, styleName, heading}]` for every body paragraph (`heading`: the outline
/// level 1 to 9 of a heading style, else 0).
pub fn paragraphs_json(doc: &Document) -> Value {
    let list: Vec<Value> = paragraphs(doc)
        .into_iter()
        .map(|(path, p)| {
            let style = p.props.style.clone().unwrap_or_else(|| "Normal".into());
            let name = doc.styles.get(&style).map(|s| s.name.clone()).unwrap_or_else(|| style.clone());
            json!({"path": path.0, "text": PlainMap::new(p).text, "style": style, "styleName": name, "heading": heading_level(&name)})
        })
        .collect();
    Value::Array(list)
}

fn heading_level(style_name: &str) -> u8 {
    let n = style_name.trim().to_ascii_lowercase();
    if n == "title" {
        return 1;
    }
    n.strip_prefix("heading ").and_then(|d| d.trim().parse::<u8>().ok()).filter(|d| (1..=9).contains(d)).unwrap_or(0)
}

/// Where each comment's range starts and ends: `id -> (start, end)` body positions.
fn comment_anchors(doc: &Document) -> std::collections::BTreeMap<u32, (Option<Pos>, Option<Pos>)> {
    let mut out: std::collections::BTreeMap<u32, (Option<Pos>, Option<Pos>)> = Default::default();
    for (path, p) in paragraphs(doc) {
        for off in p.object_offsets() {
            let pos = || Pos::new(StoryRef::Body, path.clone(), off);
            match p.object_at(off) {
                Some(InlineObject::CommentStart { id }) => out.entry(*id).or_default().0 = Some(pos()),
                Some(InlineObject::CommentEnd { id }) => out.entry(*id).or_default().1 = Some(pos()),
                _ => {}
            }
        }
    }
    out
}

/// The text between two body positions, joined across paragraphs with spaces (at most `max` chars).
fn text_between(doc: &Document, a: &Pos, b: &Pos, max: usize) -> String {
    let mut out = String::new();
    let mut on = false;
    for (path, p) in paragraphs(doc) {
        let from = if path == a.path {
            on = true;
            a.off
        } else {
            0
        };
        if !on {
            continue;
        }
        let to = if path == b.path { b.off } else { p.text.len() };
        if let Some(slice) = p.text.get(from.min(to)..to) {
            if !out.is_empty() {
                out.push(' ');
            }
            out.extend(slice.chars().filter(|c| *c != OBJ));
        }
        if path == b.path || out.chars().count() > max {
            break;
        }
    }
    out.chars().take(max).collect()
}

/// Every comment: `[{id, parent, author, initials, date, resolved, text, quote, anchor}]`, where
/// `anchor` is `{path, start, end}` in the paragraph's plain text (UTF-16), or null for a reply.
pub fn comments_json(doc: &Document) -> Value {
    let anchors = comment_anchors(doc);
    let list: Vec<Value> = doc
        .comments
        .iter()
        .map(|(id, c)| {
            let text = doc.plain_text(StoryRef::Part(c.part)).trim_end().to_string();
            let (start, end) = anchors.get(id).cloned().unwrap_or((None, None));
            let anchor = start.as_ref().and_then(|s| {
                let p = para_at(doc, &s.path.0)?;
                let map = PlainMap::new(p);
                let end_u = match &end {
                    Some(e) if e.path == s.path => map.utf16(e.off),
                    _ => map.text.encode_utf16().count(),
                };
                Some(json!({"path": s.path.0, "start": map.utf16(s.off), "end": end_u}))
            });
            let quote = match (&start, &end) {
                (Some(s), Some(e)) => text_between(doc, s, e, 200),
                _ => String::new(),
            };
            json!({
                "id": id,
                "parent": c.parent,
                "author": c.author,
                "initials": c.initials,
                "date": c.date,
                "resolved": c.resolved,
                "text": text,
                "quote": quote,
                "anchor": anchor,
            })
        })
        .collect();
    Value::Array(list)
}

/// A mark the host lays over the text: a squiggle (writing checks) or a highlight (originality).
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub id: String,
    pub start: Pos,
    pub end: Pos,
    pub color: [u8; 3],
    pub squiggle: bool,
}

/// Parse `[{id, path, start, end, color: "#rrggbb", style: "squiggle" | "highlight"}]` against
/// the document (offsets are UTF-16, in the paragraph's plain text). Bad entries are skipped.
pub fn parse_marks(doc: &Document, v: &Value) -> Vec<Mark> {
    let Some(list) = v.as_array() else { return Vec::new() };
    list.iter()
        .take(5000)
        .filter_map(|m| {
            let path: Vec<u32> = m.get("path")?.as_array()?.iter().map(|x| x.as_u64().map(|n| n as u32)).collect::<Option<_>>()?;
            let start = m.get("start")?.as_u64()? as usize;
            let end = m.get("end")?.as_u64()? as usize;
            let p = para_at(doc, &path)?;
            let map = PlainMap::new(p);
            let pos = |u: usize| Pos::new(StoryRef::Body, Path(path.clone()), map.byte(u));
            let color = crate::parse_hex(m.get("color").and_then(Value::as_str)).unwrap_or([0xd9, 0x30, 0x25]);
            Some(Mark {
                id: m.get("id").map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string())).unwrap_or_default(),
                start: pos(start.min(end)),
                end: pos(end.max(start)),
                color,
                squiggle: m.get("style").and_then(Value::as_str) != Some("highlight"),
            })
        })
        .collect()
}

/// The marks the caret is in.
pub fn marks_at<'a>(marks: &'a [Mark], at: &Pos) -> Vec<&'a str> {
    marks.iter().filter(|m| m.start.path == at.path && m.start.off <= at.off && at.off <= m.end.off).map(|m| m.id.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(paras: &[&str]) -> Document {
        let mut d = Document::from_text(&paras.join("\n"));
        d.body.truncate(paras.len());
        d
    }

    #[test]
    fn plain_text_offsets_map_back_to_the_paragraph() {
        let d = doc(&["Caf\u{e9} \u{1F600} ok"]);
        let p = d.body[0].as_para().unwrap();
        let map = PlainMap::new(p);
        assert_eq!(map.text, "Caf\u{e9} \u{1F600} ok");
        // The emoji is two UTF-16 units; "ok" starts at unit 8.
        assert_eq!(map.byte(8), p.text.find("ok").unwrap());
        assert_eq!(map.utf16(p.text.find("ok").unwrap()), 8);
        assert_eq!(map.byte(999), p.text.len(), "past the end clamps to the end");
    }

    #[test]
    fn paragraphs_list_headings_and_text() {
        let d = doc(&["One", "Two"]);
        let v = paragraphs_json(&d);
        assert_eq!(v[1]["text"], "Two");
        assert_eq!(v[1]["path"], json!([1]));
        assert_eq!(heading_level("Heading 2"), 2);
        assert_eq!(heading_level("Normal"), 0);
    }

    #[test]
    fn marks_parse_and_find_the_caret() {
        let d = doc(&["The quick brown fox"]);
        let marks = parse_marks(&d, &json!([{"id": "a", "path": [0], "start": 4, "end": 9, "color": "#336699"}, {"path": "bad"}]));
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].color, [0x33, 0x66, 0x99]);
        assert_eq!(marks_at(&marks, &Pos::body(0, 6)), vec!["a"]);
        assert!(marks_at(&marks, &Pos::body(0, 12)).is_empty());
    }
}
