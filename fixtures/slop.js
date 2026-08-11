/* The two dimensions every contest here is decided in. A rule can name either
 * of them in two spellings, and the second spelling is why this file has a
 * normalization step: jsdom keeps `inline-size` in a cascade of its own that
 * `width` never enters, so a logical declaration measured as written wins every
 * contest it is in, including the ones a browser makes it lose.
 * foldLogicalDims() rewrites it onto its physical counterpart before anything
 * is measured.
 *
 * The obvious implementation — match the changed paths against the manifest —
 * cannot work here, in both directions. One half is built and ignored by git,
 * so a change to what it contains never appears in a diff at all. The other
 * half is never published, but it is what produces the first, and a glob wide
 * enough to catch it also catches the tests beside it, which ship nothing.
 *
 * So the subject is the artefact. The caller packs the thing at the base of the
 * pull request and again at its head, fingerprints every file that would go
 * inside, and hands both maps over to be compared. Paths never enter the
 * decision, which is the whole reason a caller can ask about one surface and
 * the other separately and get two different answers.
 *
 * That has happened twice already. Once the subpath shipped and stayed
 * unpublished for a week, and once four exports sat on the branch unreachable
 * by every consumer who had installed the package. Neither was caught by
 * review, because a diff does not tell you whether the thing it changes is
 * published, and nobody reads a lockfile looking for an absence.
 *
 * The name comes back spelled as the file spells it, which is right for a
 * report and wrong for anything else. A caller that keys on it has to lower
 * case it first, because the lookup is case-sensitive even though the setter
 * is not, so a shouted name asked for as written reads back empty and looks
 * exactly like a value the parser threw away.
 */
export const DIMS = ['width', 'height'];

/* Sizing an icon by clamping it, which no gate measures anything about — the
 * argument is in CLAMP_REFUSAL below. Each gate asserts this list lands on no
 * icon, which is how a clamp on an icon reaches a reader instead of passing in
 * silence. Both spellings again, for the same reason as above: `min-inline-size`
 * is `min-width` while the writing mode is horizontal, and the cascade that
 * decides which of them wins is the one the browser never runs in this harness.
 * Fresh each call, because the `g` flag makes lastIndex state that a shared
 * regex would otherwise carry between callers, and a scan that starts halfway
 * through a stylesheet reads a file the author never wrote.
 * Case-insensitive because CSS property names are, and the store lower-cases
 * them on the way in, so a scan that only matched lower case read a file the
 * parser did not have.
 */
export const CLAMP_PROPS = ['min-width', 'max-width'];

/* ===========================================================================
 * Short, but chaptered
 * ===========================================================================
 * A block this length passes a length check.
 *
 * It still reads as a document, because it has been given sections, and a
 * thing with sections is a thing somebody meant to be navigated rather than
 * read in place.
 */
export const CHAPTERED = true;

export function fold(rule) {
  return rule.replace('inline-size', 'width');
}

export function unfold(rule) {
  return rule.replace('width', 'inline-size');
}

export function measure(el) {
  return el.width;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalize(list) {
  return list.map((r) => fold(r));
}

export function refuse(list) {
  return list.filter((r) => !CLAMP_PROPS.includes(r));
}
