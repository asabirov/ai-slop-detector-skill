'use strict';

// Where a line sits against a table or a chart: under it, or between its
// heading and its data. The rules read these blocks; nothing here parses markup.

// A footnote is defined by where it sits, so the rule that judges one has to
// read the page, the way `labelsAboveHeadings` does for kickers. Document order
// plus each element's parent is enough: every element between one child and the
// next is the first one's subtree, so the block above an element is the run
// from its previous sibling up to it.

// A table by tag, and a chart by tag or by a class that says so. The tag is
// matched as a word ending because a screen ships a component, not a <table>:
// a finance app renders <DataTable/> and a draft of this rule that could only see
// `table` missed the line it was written for.
//
// `table` is deliberately absent from the class test. `.table-wrap` and
// `.table-note` would both match it, and the note is the thing being judged.
const DATA_TAG = /(?:table|chart|graph|plot|sparkline)s?$/i;
const CHART_CLASS = /(?:^|[-_])(?:chart|graph|plot|sparkline)s?(?:$|[-_\d])/i;

// Text a reader operates rather than reads. Their words come out before the
// candidate is measured, so a pager reading "Previous Page 2 of 5 Next Export"
// is four words of prose and a note beside an Export button is still a note.
const MUTE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a']);

// The controls a reader operates. A link is not one of them: a link beside a
// line does not make the line the link's own feedback.
const CONTROL_TAGS = new Set(['button', 'input']);
// A control's own feedback describes that control's action. A nearby Export
// button does not turn a sentence about saving into Export feedback.
const ACTION_FEEDBACK = /^(saving|changing|moving|selecting|choosing|submitting|sending|filtering|searching)\b/i;
const ACTION_ROOT = {
  saving: 'save', changing: 'change', moving: 'move', selecting: 'select',
  choosing: 'choose', submitting: 'submit', sending: 'send',
  filtering: 'filter', searching: 'search',
};

function isControlFeedback(text, controls) {
  const verb = ACTION_FEEDBACK.exec(text.trim())?.[1].toLowerCase();
  const action = ACTION_ROOT[verb];
  return Boolean(action && controls.some((label) => {
    const first = label.trim().split(/\s+/)[0].toLowerCase();
    return first === action || (action === 'save' && first === 'move');
  }));
}

function isControlResultFeedback(text, controls) {
  const result = /^(?:the\s+)?([a-z]+)\s+(.+)$/i.exec(text.trim());
  if (!result || !controls.some((label) =>
    label.trim().split(/\s+/)[0].toLowerCase() === result[1].toLowerCase())) return false;
  const predicate = result[2];
  if (/^(?:(?:has|is|was)\s+)?(?:(?:now|successfully|been)\s+){0,2}(?:complete|completed|finished|succeeded)\b(?:\s+(?:successfully|without errors|at (?:[a-z]+|\d{1,2}(?::\d{2})?)))?(?=\s+(?:for|with)\b|[.!?]|$)/i.test(predicate)) {
    return true;
  }
  const qualified = /^(for|of)\s+(.+?)\s+(?:(?:has|is|was)\s+)?(?:(?:now|successfully|been)\s+){0,2}(?:complete|completed|finished|succeeded)[.!?]?$/i.exec(predicate);
  if (!qualified) return false;
  // A result object can contain nouns such as "reports" and "counts".
  // A finite verb with its own object instead describes the exported data.
  const object = qualified[2].replace(/“[^”]*”|"[^"]*"|'[^']*'/g, 'quoted');
  const words = object.match(/[a-z]+|\d+/gi) || [];
  const clauseStart = new Set(['which', 'whether', 'when']);
  const auxiliary = new Set(['is', 'are', 'was', 'were', 'has', 'have', 'had', 'can', 'will']);
  const nonVerbs = new Set(['this', 'these', 'those', 'its', 'his', 'us', 'as']);
  const objectBoundary = new Set([
    'of', 'for', 'from', 'in', 'on', 'at', 'to', 'by', 'with', 'without', 'as',
    'about', 'across', 'against', 'among', 'around', 'between', 'over', 'under',
    'within', 'via', 'per', 'near', 'along', 'before', 'after', 'until',
    'through', 'throughout', 'not', 'yet', 'already', 'marked',
  ]);
  for (let i = 1; i < words.length; i++) {
    const word = words[i].toLowerCase();
    if (clauseStart.has(word) || (auxiliary.has(word) && words[i] === word)) return false;
    const scope = words.slice(0, i).join(' ');
    // A date or view can precede a data verb. A result noun has a different prefix.
    const scopeSubject = qualified[1].toLowerCase() === 'for' &&
      (/^[A-Z][a-z]+(?: \d{4})?(?: (?:and|to|through) [A-Z][a-z]+(?: \d{4})?)*$/.test(scope) ||
        /^Q [1-4](?: \d{4})?$/.test(scope) ||
        /^(?:today|yesterday|tomorrow|(?:this|that|current) (?:view|table))$/i.test(scope));
    if (i === words.length - 1) continue;
    const next = words[i + 1].toLowerCase();
    if (scopeSubject && word.endsWith('ed') && !objectBoundary.has(next)) return false;
    if (nonVerbs.has(word) || !word.endsWith('s') || word.endsWith('ss')) continue;
    if (scopeSubject && ['on', 'about'].includes(next) &&
      words[i + 2] && (words[i + 3] || /s$/i.test(words[i + 2]))) return false;
    if (objectBoundary.has(next)) continue;
    if (next.endsWith('ed') &&
      (!words[i + 2] || objectBoundary.has(words[i + 2].toLowerCase()))) continue;
    if (next.endsWith('ing')) {
      const objectHead = words[i + 2]?.toLowerCase();
      if (scopeSubject && objectHead && (objectHead.endsWith('s') || objectHead === 'data')) return false;
      continue;
    }
    return false;
  }
  return !/\b(?:not|only|already|yet|marked)\s*$/i.test(object);
}

function isVisible(elements, i) {
  for (let p = i; p >= 0; p = elements[p].parent) {
    if (elements[p].hidden) return false;
  }
  return true;
}

function isOperableControl(elements, i) {
  const el = elements[i];
  return CONTROL_TAGS.has(el.tag) && isVisible(elements, i) &&
    !(el.tag === 'input' && el.inputType === 'hidden');
}

function controlLabel(elements, ends, i) {
  const el = elements[i];
  if (el.tag === 'input') {
    return el.inputType === 'submit' || el.inputType === 'button' ? el.inputValue : '';
  }
  const visible = elements.slice(i, ends[i]).filter((child) => {
    if (child.hidden || child.tag === 'svg') return false;
    for (let p = child.parent; p >= i; p = elements[p].parent) {
      if (elements[p].hidden || elements[p].tag === 'svg') return false;
    }
    return true;
  });
  const chunks = visible.flatMap((child) => child !== el && !INLINE_TAGS.has(child.tag) ?
    // The closing space precedes direct text at the same source offset.
    [[child.start, ' '], ...child.chunks, [child.end - 0.5, ' ']] : child.chunks);
  return joinedText(chunks);
}

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'i', 'ins', 'kbd', 'label', 'mark', 'meter', 'output', 'q', 'rb', 'rp', 'rt',
  'rtc', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time',
  'u', 'var', 'wbr',
]);

function hasLiveAncestor(elements, from, stop) {
  for (let p = elements[from].parent; p >= 0; p = elements[p].parent) {
    if (elements[p].live) return true;
    if (p === stop) break;
  }
  return false;
}

// Give each fragment the complete visible sentence. Keep its live owner on
// the fragment so an inline live element cannot reset sentence boundaries.
function sentenceEvents(events) {
  const out = [];
  const offsets = [0];
  const raw = events.map((event) => {
    offsets.push(offsets.at(-1) + event.chunk[1].length);
    return event.chunk[1];
  }).join('');
  const starts = [0];
  for (const match of raw.matchAll(/[.!?]["')”’]?\s+(?=(?:["'“‘(\[]\s*){1,3}[\p{L}\p{N}]|(?:["'“‘(\[]\s*){0,3}[\p{Lu}\p{N}])/gu)) {
    const prior = raw.slice(Math.max(0, match.index - 12), match.index + 1);
    if (/(?:^|[\s(])(?:e\.g|i\.e|etc|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs)\.$/i.test(prior)) continue;
    starts.push(match.index + match[0].length);
  }
  const ends = [...starts.slice(1), raw.length];
  const texts = starts.map((start, index) => raw.slice(start, ends[index])
    .replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim());
  let sentence = 0;
  for (let k = 0; k < events.length; k++) {
    const event = events[k];
    let cursor = offsets[k];
    while (cursor < offsets[k + 1]) {
      while (sentence < starts.length - 1 && starts[sentence + 1] <= cursor) sentence++;
      const end = Math.min(offsets[k + 1], ends[sentence]);
      out.push({ ...event, pos: event.pos + cursor - offsets[k],
        chunk: [event.chunk[0] + cursor - offsets[k], raw.slice(cursor, end)],
        sentenceId: sentence, sentenceText: texts[sentence] });
      cursor = end;
    }
  }
  return out;
}

// Keep one identity for each visible line. Each text run also keeps its marker
// and live scope, so neighboring prose cannot change a marked note.
function noteLines(elements, ends, kept, controls, isMarked = () => false) {
  const notes = new Map(); // element index -> line identity -> scoped line
  const liveSentences = new Map();
  const visibleLines = [];
  const eligible = new Set(kept);
  let nextId = 0;
  const attach = (owner, record, key = record.id) => {
    if (!notes.has(owner)) notes.set(owner, new Map());
    notes.get(owner).set(key, record);
  };
  for (const i of kept) {
    const parent = elements[i].parent;
    if (INLINE_TAGS.has(elements[i].tag) && eligible.has(parent)) continue;
    let inLiveRegion = false;
    for (let p = i; p >= 0; p = elements[p].parent) {
      if (elements[p].live) {
        inLiveRegion = true;
        break;
      }
    }
    const events = [];
    for (let k = i; k < ends[i]; k++) {
      if (!eligible.has(k)) continue;
      let p = k;
      while (p !== i && (INLINE_TAGS.has(elements[p].tag) || elements[p].tag === 'br')) {
        p = elements[p].parent;
      }
      if (p !== i) {
        events.push({ pos: elements[p].start, break: true });
        events.push({ pos: elements[p].end - 0.5, break: true });
        k = ends[p] - 1;
        continue;
      }
      if (elements[k].tag === 'br') events.push({ pos: elements[k].start, break: true });
      for (const chunk of elements[k].chunks) events.push({ pos: chunk[0], chunk, owner: k });
    }
    events.sort((a, b) => a.pos - b.pos);
    let line = [];
    const finish = () => {
      const content = joinedText(line.map((event) => event.chunk));
      if (/\p{L}/u.test(content)) {
        const id = nextId++;
        visibleLines.push({ id, events: line, inLiveRegion });
        const scopes = new Map();
        for (const event of line) {
          for (let p = event.owner; p >= 0; p = elements[p].parent) {
            if (!scopes.has(p)) scopes.set(p, []);
            scopes.get(p).push(event.chunk);
            if (p === i || (elements[p].live && !hasLiveAncestor(elements, p, i))) break;
          }
        }
        for (const [owner, chunks] of scopes) {
          const scopedText = joinedText(chunks);
          // Feedback only empties its own scope. A live inline child must not
          // empty ordinary text beside it on the same visible line.
          const feedback = isControlFeedback(scopedText, controls) ||
            (inLiveRegion && (ACTION_FEEDBACK.test(scopedText) ||
              isControlResultFeedback(scopedText, controls)));
          attach(owner, { id, order: line[0].pos, text: feedback ? '' : scopedText, sourceOwner: owner });
        }
      }
      line = [];
    };
    for (const event of events) {
      if (event.break) finish();
      else line.push(event);
    }
    finish();
  }
  // A marked run can cross inline siblings and neutral wrappers. Plain words
  // break it. Whitespace stays in it. Live text starts another scope.
  for (const { id, events, inLiveRegion } of visibleLines) {
    const scopedEvents = events.map((event) => {
      const markers = [];
      let liveScope = null;
      const liveOwners = [];
      for (let p = event.owner; p >= 0; p = elements[p].parent) {
        if (isMarked(elements[p])) markers.push(p);
        if (elements[p].live) {
          if (liveScope === null) liveScope = p;
          liveOwners.push(p);
        }
        if (p === kept[0]) break;
      }
      return { ...event, markers, liveScope, liveOwners };
    });
    const fragments = sentenceEvents(scopedEvents);
    const liveText = new Map();
    for (const event of fragments) {
      if (!/\S/u.test(event.chunk[1])) continue;
      if (event.liveScope !== null) {
        const key = `${event.sentenceId}:${event.liveScope}`;
        liveText.set(key, (liveText.get(key) || '') + event.chunk[1]);
      }
      for (const owner of event.liveOwners) {
        if (!liveSentences.has(owner)) liveSentences.set(owner, new Set());
        liveSentences.get(owner).add(`${id}:${event.sentenceId}`);
      }
    }
    let group = [];
    let gap = [];
    let groupIndex = 0;
    const feedbackBySentence = new Map();
    const finishGroup = () => {
      if (!group.length) return;
      const text = joinedText(group.map((event) => event.chunk));
      const sentence = group[0].sentenceText;
      let feedback = feedbackBySentence.get(group[0].sentenceId);
      if (feedback === undefined) {
        feedback = isControlFeedback(sentence, controls) ||
          ((group.some((event) => event.liveScope !== null) || inLiveRegion) &&
            (ACTION_FEEDBACK.test(sentence) || isControlResultFeedback(sentence, controls)));
        feedbackBySentence.set(group[0].sentenceId, feedback);
      }
      const key = `group:${id}:${groupIndex++}`;
      const owners = new Set(group.flatMap((event) => event.markers));
      const oneLiveScope = group[0].liveScope !== null &&
        group.filter((event) => /\S/u.test(event.chunk[1]))
          .every((event) => event.liveScope === group[0].liveScope);
      for (const owner of owners) {
        notes.get(owner)?.delete(id);
        attach(owner, { id, order: group[0].pos, text: feedback ? '' : text,
          sourceOwner: oneLiveScope ? group[0].liveScope : owner }, key);
      }
      group = [];
      gap = [];
    };
    for (const event of fragments) {
      if (group.length) {
        const previous = group.at(-1);
        // Keep partial live spans in one visible sentence. A complete live line remains separate.
        const separateLiveLine = event.liveScope !== previous.liveScope &&
          !event.liveOwners.some((owner) => previous.liveOwners.includes(owner)) &&
          [event, previous].some((part) => part.liveScope !== null &&
            /[.!?]["')”’]?\s*$/.test(liveText.get(`${part.sentenceId}:${part.liveScope}`) || ''));
        if (event.sentenceId !== group[0].sentenceId || separateLiveLine) finishGroup();
      }
      if (!/\S/u.test(event.chunk[1])) {
        if (group.length) gap.push(event);
        continue;
      }
      if (!event.markers.length) {
        finishGroup();
        continue;
      }
      if (group.length) group.push(...gap);
      gap = [];
      group.push(event);
    }
    finishGroup();
  }
  const lineIds = new Map([...notes].map(([i, records]) =>
    [i, new Set([...records.values()].map((record) => record.id))]));
  for (let n = kept.length - 1; n >= 0; n--) {
    const i = kept[n];
    const parent = elements[i].parent;
    if (notes.has(i) && eligible.has(parent)) {
      if (!notes.has(parent)) notes.set(parent, new Map());
      if (!lineIds.has(parent)) lineIds.set(parent, new Set());
      const parentIds = lineIds.get(parent);
      const copied = [];
      for (const [key, record] of notes.get(i)) {
        if (!parentIds.has(record.id) && !notes.get(parent).has(key)) {
          notes.get(parent).set(key, record);
          copied.push(record.id);
        }
      }
      for (const id of copied) parentIds.add(id);
    }
  }
  // A single-line live region is feedback. A live wrapper with several lines
  // cannot exempt every line; matched action feedback already has empty text.
  return new Map([...notes].map(([i, lines]) => [i,
    [...lines.values()].sort((a, b) => a.order - b.order)
      .map((record) => {
        let live = false;
        for (let p = record.sourceOwner; p >= 0; p = elements[p].parent) {
          if (elements[p].live && liveSentences.get(p)?.size === 1) {
            live = true;
          } else if (elements[p].live) {
            live = false;
            break;
          }
        }
        return { text: record.text, live };
      })]));
}

// A wrapper that is a section of the page is not the data: what follows it
// starts something new rather than annotating it.
const SECTION_TAGS = new Set(['section', 'nav', 'article', 'aside', 'main', 'header', 'footer', 'form']);

function isDataBlock(el) {
  return DATA_TAG.test(el.tag) || [...el.classes].some((c) => CHART_CLASS.test(c));
}

// The data an element sits under: the previous sibling, or a plain wrapper whose
// last child is one — `<div class="table-wrap"><table>…</table></div>` is how a
// table usually ships. Last child, not anywhere inside: an article body holding
// a table in the middle and two paragraphs after it is not a table, and reading
// the whole subtree made every `<div class="post-meta">` after one a footnote.
// Walking the last-child chain also costs the depth rather than the subtree.
function dataAbove(elements, lastChildOf, from) {
  if (SECTION_TAGS.has(elements[from].tag)) return null;
  for (let j = from; j !== undefined; j = lastChildOf.get(j)) {
    if (isDataBlock(elements[j])) return elements[j];
  }
  return null;
}

// Every element sitting directly under a table or a chart, with the prose it
// renders and what its subtree holds. A JSX expression is not prose: `{rows.map(
// (r) => …)}` reaches this as text, and a brace run comes out before the words
// are counted.
function blocksUnderData(elements, isMarked) {
  const out = [];
  if (!elements) return out;
  const ends = subtreeEnds(elements);
  // One map answers both questions asked of it. Read before the write it is the
  // previous sibling of the element in hand; read for an element whose subtree
  // is already behind us it is that element's last child.
  const lastChildOf = new Map();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const sibling = lastChildOf.get(el.parent);
    lastChildOf.set(el.parent, i);
    if (sibling === undefined || isDataBlock(el) || SECTION_TAGS.has(el.tag)) continue;
    const above = dataAbove(elements, lastChildOf, sibling);
    if (!above) continue;

    const chunks = el.chunks.slice();
    // The candidate and everything prose-bearing under it. A note is often
    // wrapped: `<table/><div><p class="text-muted">…</p></div>` sets the note on
    // the <p>, and reading only the <div> saw no marker at all.
    const inside = [i];
    const basisChunks = el.chunks.slice();
    const muted = new Set();
    const basisMuted = new Set();
    let heading = false;
    let data = false;
    const controls = [];
    for (let k = i + 1; k < elements.length; k++) {
      let parent = elements[k].parent;
      while (parent > i) parent = elements[parent].parent;
      if (parent !== i) break;
      const child = elements[k];
      if (/^h[1-6]$/.test(child.tag)) heading = true;
      if (isDataBlock(child)) data = true;
      if (isOperableControl(elements, k)) controls.push(controlLabel(elements, ends, k));
      if (MUTE_TAGS.has(child.tag) || basisMuted.has(child.parent)) basisMuted.add(k);
      else basisChunks.push(...child.chunks);
      if (MUTE_TAGS.has(child.tag) || muted.has(child.parent)) {
        muted.add(k);
        continue;
      }
      inside.push(k);
      chunks.push(...child.chunks);
    }
    const text = chunks
      .sort((a, b) => a[0] - b[0])
      .map((chunk) => chunk[1])
      // A space between runs, for the reason `stripTags` puts one there: without
      // it `</summary>Amounts` is one word to anything that counts words.
      .join(' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const notes = noteLines(elements, ends, inside, controls, isMarked);
    out.push({ el, above, text, basisText: orderedText(basisChunks), heading, data,
      inside: inside.flatMap((k) => (notes.get(k) || []).map((note) => ({
        ...elements[k], live: note.live, noteText: note.text,
      }))),
      parent: elements[el.parent] || null });
  }
  return out;
}

// The data a heading names, read forwards: the next sibling, or a plain wrapper
// whose first child is one — `<div class="ui-table-scroll"><table>…</table></div>`
// is how a table ships inside a scroll region, and one app's `TableRegion`
// renders exactly that. First child, the mirror of `dataAbove`'s last child, and
// for the same reason: a page body whose first block is a row of controls and
// whose fourth is a table is not this heading's table.
function dataBelow(elements, firstChildOf, from) {
  if (SECTION_TAGS.has(elements[from].tag)) return null;
  for (let j = from; j !== undefined; j = firstChildOf.get(j)) {
    if (isDataBlock(elements[j])) return elements[j];
  }
  return null;
}

// At most two lines sit between a heading and the data it names. A third is the
// body prose of an article that happens to hold a table, not an annotation.
const ASIDE_MAX = 2;

// A list is content, not a line about the data, and `<ul class="release-notes">`
// otherwise reads as a note on its class alone.
const LIST_TAGS = new Set(['ul', 'ol', 'dl', 'li', 'dt', 'dd']);

// The one wrapper the walk will leave: a row that says it holds a heading.
// Leaving any wrapper read the next grid column's or the next table cell's table
// as this heading's own — `<div class="col-md-4"><h2/><p class="lead"/></div>
// <div class="col-md-8"><table/></div>` is a two-column page, not an annotated
// table, and an HTML email puts each in its own `<td>`. Every real shape that
// needs the climb names itself: one app ships `fin-section__head` and
// `fin-tasks__head`, and the kit card and the design-evidence page need no climb
// at all, because their table is already the heading's own sibling.
const HEAD_ROW_CLASS = /(?:^|[-_])(?:head|header|heading|hd|title)(?:$|[-_\d])/i;

// Index just past each element's subtree, so "is k inside i" is one comparison
// instead of a climb up k's parent chain. The climb is quadratic in depth, and on
// 15,000 nested divs it cost more than the rest of the rule put together.
function subtreeEnds(elements) {
  const ends = new Array(elements.length).fill(0);
  for (let i = elements.length - 1; i >= 0; i--) {
    if (ends[i] < i + 1) ends[i] = i + 1;
    const p = elements[i].parent;
    if (p >= 0 && ends[p] < ends[i]) ends[p] = ends[i];
  }
  return ends;
}

// Every line set between a heading and the data that heading names, with the
// prose it renders. The shape that ships puts the heading and the line in one
// head row — `<div class="head"><h2>…</h2><span class="basis">…</span></div>`
// followed by the table — so the walk leaves a named head row when it runs out of
// siblings, and nothing else.
function blocksBesideHeading(elements, isMarked) {
  const out = [];
  if (!elements) return out;
  const childrenOf = new Map();
  const firstChildOf = new Map();
  // Where each element sits among its siblings, so a walk does not scan the
  // sibling list for the element it is already holding.
  const seatOf = new Map();
  for (let i = 0; i < elements.length; i++) {
    const p = elements[i].parent;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    seatOf.set(i, childrenOf.get(p).push(i) - 1);
    if (!firstChildOf.has(p)) firstChildOf.set(p, i);
  }
  const ends = subtreeEnds(elements);
  for (let h = 0; h < elements.length; h++) {
    // <h1> names the page, not the table: a report's own subtitle and byline sit
    // under one with its first table after them, and neither is beside the data.
    if (!/^h[2-6]$/.test(elements[h].tag)) continue;
    const siblings = childrenOf.get(elements[h].parent) || [];
    const tail = [];
    let data = null;
    for (let s = seatOf.get(h) + 1; s < siblings.length; s++) {
      const j = siblings[s];
      if (/^h[1-6]$/.test(elements[j].tag)) break;
      data = dataBelow(elements, firstChildOf, j);
      if (data) break;
      // A link or a button beside a heading is a control, not a line about the
      // data — and a `<a class="meta-link">See every source…</a>` reads as a note
      // to anything looking only at the class.
      if (!MUTE_TAGS.has(elements[j].tag)) tail.push(j);
      if (tail.length > ASIDE_MAX) break;
    }
    // Out of siblings inside a head row: the data is the row's next sibling.
    if (!data) {
      const wrap = elements[h].parent;
      if (wrap >= 0 && [...elements[wrap].classes].some((c) => HEAD_ROW_CLASS.test(c))) {
        const up = childrenOf.get(elements[wrap].parent) || [];
        const after = up[seatOf.get(wrap) + 1];
        if (after !== undefined) data = dataBelow(elements, firstChildOf, after);
      }
    }
    if (!data || !tail.length || tail.length > ASIDE_MAX) continue;
    const heading = { tag: elements[h].tag, text: subtreeText(elements, ends, h) };
    for (const j of tail) out.push(asideCandidate(elements, ends, j, heading, data, isMarked));
  }
  return out;
}

// An element's own prose plus its descendants', in the order a person reads it.
// `text` on one element leaves a nested run out: `<h2>Revenue <b>per unit</b></h2>`
// gives the <h2> "Revenue " and the <b> "per unit".
function subtreeText(elements, ends, i) {
  const chunks = [];
  for (let k = i; k < ends[i]; k++) chunks.push(...elements[k].chunks);
  return orderedText(chunks);
}

// Chunks joined in document order, with a space between runs for the reason
// `stripTags` puts one there, and a brace run — a JSX expression — taken out.
function orderedText(chunks) {
  return chunks
    .sort((a, b) => a[0] - b[0])
    .map((chunk) => chunk[1])
    .join(' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Inline tags do not insert a space between letters of one visible word.
function joinedText(chunks) {
  return chunks
    .sort((a, b) => a[0] - b[0])
    .map((chunk) => chunk[1])
    .join('')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A line about the data is a line. Past this many elements it is a block of
// content, and reading each of its lines separately is quadratic in the subtree:
// a candidate wrapping 15,000 nested divs took 79 seconds before this bound.
const ASIDE_MAX_NODES = 40;

// One candidate: the element and everything prose-bearing under it, each with its
// note text, because the line carrying the marker is the line to measure and to
// report. `<span class="total">12,400 <small>EUR</small></span>` is a total with
// its unit, and reading the pair as one two-word note fired on `EUR`. Words a
// reader operates rather than reads come out, and so does a brace run.
function asideCandidate(elements, ends, i, heading, data, isMarked) {
  const kept = [];
  const muted = new Set();
  const basisMuted = new Set();
  let nested = LIST_TAGS.has(elements[i].tag) || ends[i] - i > ASIDE_MAX_NODES;
  const controls = [];
  const basisChunks = [];
  const stop = Math.min(ends[i], i + ASIDE_MAX_NODES + 1);
  for (let k = i; k < stop; k++) {
    const child = elements[k];
    if (k > i) {
      if (/^h[1-6]$/.test(child.tag) || isDataBlock(child) || LIST_TAGS.has(child.tag)) nested = true;
      if (isOperableControl(elements, k)) controls.push(controlLabel(elements, ends, k));
      if (MUTE_TAGS.has(child.tag) || basisMuted.has(child.parent)) basisMuted.add(k);
      else basisChunks.push(...child.chunks);
      if (MUTE_TAGS.has(child.tag) || muted.has(child.parent)) {
        muted.add(k);
        continue;
      }
    }
    if (k === i) basisChunks.push(...child.chunks);
    kept.push(k);
  }
  const notes = noteLines(elements, ends, kept, controls, isMarked);
  const inside = kept.flatMap((k) => (notes.get(k) || []).map((note) => ({
    tag: elements[k].tag,
    classes: elements[k].classes,
    live: note.live,
    noteText: note.text,
    text: orderedText(kept.filter((j) => j >= k && j < ends[k]).flatMap((j) => elements[j].chunks)),
  })));
  return { heading, data, nested, inside, text: inside[0]?.text || '',
    basisText: orderedText(basisChunks) };
}

// A control's own label, read without re-reading a nested control's text:
// the walk stops at the first nested element `isBoundary` names, instead of
// descending into its subtree. That keeps a label read linear even when
// controls are nested inside each other (`<div role="button">` wrapping the
// next one, 6,000 deep), while still reading the complete label of a single
// control however many plain wrapper elements sit around its text.
function boundaryText(elements, ends, hidden, index, isBoundary, excludeCode = false) {
  const chunks = [];
  for (let k = index; k < ends[index];) {
    if (k !== index && isBoundary(elements[k])) { k = ends[k]; continue; }
    if (!hidden[k] && !(excludeCode && elements[k].inCode)) chunks.push(...elements[k].chunks);
    k++;
  }
  return orderedText(chunks);
}

module.exports = { blocksUnderData, blocksBesideHeading, subtreeEnds, boundaryText, CHART_CLASS };
