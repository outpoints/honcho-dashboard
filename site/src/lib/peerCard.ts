/**
 * Honcho's peer card format (3.1+): every entry Honcho writes starts with one of
 * four prefixes, usually followed by `Key: value`:
 *
 *   IDENTITY: Name: Alice          ATTRIBUTE: Location: NYC
 *   RELATIONSHIP: Maintainer: vee  INSTRUCTION: Never push to main without review
 *
 * Honcho caps its own cards at 40 entries of 200 characters, but `PUT /card`
 * stores any list as written, so older or hand-edited cards can carry lines
 * with no prefix. Those are kept and shown as unstructured, never dropped.
 */

export const CARD_KINDS = ["identity", "attribute", "relationship", "instruction"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Limits Honcho applies when it writes a card itself. */
export const HONCHO_CARD_MAX_ENTRIES = 40;
export const HONCHO_CARD_MAX_ENTRY_LENGTH = 200;

export interface CardEntry {
  kind: CardKind | null;
  /** The `Key` in `PREFIX: Key: value`, or null when the body is a plain statement. */
  key: string | null;
  value: string;
  line: string;
}

export interface CardGroup {
  key: string | null;
  values: string[];
}

export interface StructuredCard {
  /** IDENTITY entries grouped by key (Name, Kind, Aliases, …). */
  identity: CardGroup[];
  attributes: CardGroup[];
  relationships: CardGroup[];
  /** Standing rules, kept whole: they are sentences, not key/value pairs. */
  instructions: string[];
  /** Lines without one of the four prefixes. */
  unstructured: string[];
  total: number;
}

const PREFIX = /^(IDENTITY|ATTRIBUTE|RELATIONSHIP|INSTRUCTION):\s+(.*)$/;
// A key is a short label before ": " — not a sentence, a URL scheme, or code.
const KEYED = /^([^:`\n]{1,40}?):\s+(\S.*)$/;

export function parseCardLine(line: string): CardEntry {
  const text = line.trim();
  const match = PREFIX.exec(text);
  if (!match) return { kind: null, key: null, value: text, line };
  const kind = match[1].toLowerCase() as CardKind;
  const body = match[2].trim();
  if (kind !== "instruction") {
    const keyed = KEYED.exec(body);
    if (keyed && !/[.!?](\s|$)/.test(keyed[1])) return { kind, key: keyed[1].trim(), value: keyed[2].trim(), line };
  }
  return { kind, key: null, value: body, line };
}

/** Group values under their key, case-insensitively, in first-seen order. */
function group(entries: CardEntry[]): CardGroup[] {
  const groups: CardGroup[] = [];
  const byKey = new Map<string, CardGroup>();
  for (const entry of entries) {
    const id = entry.key ? entry.key.toLowerCase() : `\u0000${groups.length}`;
    const existing = entry.key ? byKey.get(id) : undefined;
    if (existing) {
      if (!existing.values.includes(entry.value)) existing.values.push(entry.value);
      continue;
    }
    const created = { key: entry.key, values: [entry.value] };
    if (entry.key) byKey.set(id, created);
    groups.push(created);
  }
  return groups;
}

export function structureCard(lines: string[]): StructuredCard {
  const entries = lines.filter((l) => l.trim()).map(parseCardLine);
  const of = (kind: CardKind) => entries.filter((e) => e.kind === kind);
  return {
    identity: group(of("identity")),
    attributes: group(of("attribute")),
    relationships: group(of("relationship")),
    instructions: of("instruction").map((e) => e.value),
    unstructured: entries.filter((e) => e.kind === null).map((e) => e.value),
    total: entries.length,
  };
}

/** The display name from `IDENTITY: Name: …`, if the card has one. */
export function cardName(card: StructuredCard): string | null {
  return card.identity.find((g) => g.key?.toLowerCase() === "name")?.values[0] ?? null;
}

/** Values short enough to read inline, separated by dots, instead of one per line. */
export function readsInline(values: string[]): boolean {
  return values.length > 1 && values.every((v) => v.length <= 28) && values.join(" · ").length <= 120;
}

/** What Honcho's own card writer would reject in a hand-edited card. */
export function cardWarnings(lines: string[]): string[] {
  const kept = lines.map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];
  const unprefixed = kept.filter((l) => !PREFIX.test(l)).length;
  if (unprefixed) {
    warnings.push(`${unprefixed} line${unprefixed === 1 ? " has" : "s have"} no IDENTITY / ATTRIBUTE / RELATIONSHIP / INSTRUCTION prefix. Honcho saves ${unprefixed === 1 ? "it" : "them"} as written, but its next card update may rewrite or drop ${unprefixed === 1 ? "it" : "them"}.`);
  }
  const long = kept.filter((l) => l.length > HONCHO_CARD_MAX_ENTRY_LENGTH).length;
  if (long) warnings.push(`${long} line${long === 1 ? " is" : "s are"} over ${HONCHO_CARD_MAX_ENTRY_LENGTH} characters, the most Honcho writes per entry.`);
  if (kept.length > HONCHO_CARD_MAX_ENTRIES) warnings.push(`${kept.length} entries; Honcho keeps its own cards to ${HONCHO_CARD_MAX_ENTRIES}.`);
  return warnings;
}
