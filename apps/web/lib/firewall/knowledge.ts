/**
 * A small, explicit reference-knowledge store used as NLI premises when the
 * retrieval microservice is unavailable. These are stable, well-known facts
 * (not model-generated "correct answers"). Every entry cites a public source
 * so the UI can show provenance instead of an anonymous assertion.
 *
 * When the real retrieval service is running, its facts take priority and this
 * store is only a supplement.
 */

import type { FactDetail } from "./types";

export interface ReferenceFact extends FactDetail {
  topic: string;
  /** Curated high-signal entity terms. Generic words and bare years are excluded. */
  keywords: string[];
}

export const REFERENCE_FACTS: ReferenceFact[] = [
  {
    id: "moon-landing-1969",
    topic: "Apollo 11",
    fact: "Apollo 11 landed the first humans on the Moon on 20 July 1969.",
    source: "NASA — Apollo 11 Mission Overview",
    keywords: ["apollo", "moon", "lunar", "landing", "armstrong"],
  },
  {
    id: "berlin-wall-1989",
    topic: "Berlin Wall",
    fact: "The Berlin Wall fell on 9 November 1989, opening the border between East and West Berlin.",
    source: "US State Department — The Fall of the Berlin Wall",
    keywords: ["berlin", "wall", "border", "fell", "collapse"],
  },
  {
    id: "paris-peace-accords-1973",
    topic: "Paris Peace Accords",
    fact: "The Paris Peace Accords were signed on 27 January 1973, ending direct U.S. military involvement in the Vietnam War.",
    source: "U.S. Department of State, Office of the Historian — The Paris Peace Accords, 1973",
    keywords: ["paris", "peace", "accords", "vietnam", "vietnamese", "military"],
  },
  {
    id: "wwii-end-1945",
    topic: "World War II",
    fact: "World War II in Europe ended with Germany's unconditional surrender in May 1945.",
    source: "US National Archives — Germany Surrenders, May 1945",
    keywords: ["germany", "german", "surrender", "nazi", "unconditional"],
  },
  {
    id: "earth-sun",
    topic: "Astronomy",
    fact: "Earth orbits the Sun once approximately every 365.25 days.",
    source: "NASA — Earth's Orbit",
    keywords: ["earth", "sun", "orbit", "orbits"],
  },
  {
    id: "water-boiling",
    topic: "Physics",
    fact: "At standard atmospheric pressure (1 atm), pure water boils at 100 degrees Celsius.",
    source: "NIST — Standard Temperature and Pressure",
    keywords: ["water", "boils", "boiling", "celsius", "atmospheric"],
  },
  {
    id: "light-speed",
    topic: "Physics",
    fact: "The speed of light in a vacuum is approximately 299,792,458 metres per second.",
    source: "NIST — Speed of Light",
    keywords: ["light", "vacuum", "metres", "photons"],
  },
  {
    id: "largest-planet",
    topic: "Astronomy",
    fact: "Jupiter is the largest planet in the Solar System.",
    source: "NASA — Jupiter Facts",
    keywords: ["jupiter", "planet", "solar"],
  },
  {
    id: "python-creator",
    topic: "Programming",
    fact: "The Python programming language was created by Guido van Rossum and first released in 1991.",
    source: "Python Software Foundation — History of Python",
    keywords: ["python", "guido", "rossum"],
  },
  {
    id: "html-meaning",
    topic: "Programming",
    fact: "HTML stands for HyperText Markup Language and is the standard markup language for web pages.",
    source: "MDN Web Docs — HTML",
    keywords: ["html", "hypertext", "markup"],
  },
  {
    id: "gold-atomic-number",
    topic: "Chemistry",
    fact: "Gold has the chemical symbol Au and atomic number 79.",
    source: "Royal Society of Chemistry — Gold",
    keywords: ["gold", "atomic", "periodic"],
  },
  {
    id: "covid-who",
    topic: "Health",
    fact: "The World Health Organization declared COVID-19 a global pandemic in March 2020.",
    source: "WHO — Director-General's opening remarks, 11 March 2020",
    keywords: ["covid", "pandemic", "coronavirus"],
  },
  {
    id: "titanic-1912",
    topic: "History",
    fact: "The RMS Titanic sank in the North Atlantic in April 1912 after striking an iceberg.",
    source: "Encyclopaedia Britannica — Titanic",
    keywords: ["titanic", "iceberg", "atlantic", "rms"],
  },
  {
    id: "einstein-relativity",
    topic: "Physics",
    fact: "Albert Einstein published the special theory of relativity in 1905 and the general theory in 1915.",
    source: "Encyclopaedia Britannica — Relativity",
    keywords: ["einstein", "relativity"],
  },
  {
    id: "electric-charge",
    topic: "Physics",
    fact: "Like electric charges repel each other, while opposite charges attract.",
    source: "NASA — Coulomb's Law",
    keywords: ["electric", "charge", "repel", "attract", "coulomb"],
  },
  {
    id: "neon-noble-gas",
    topic: "Chemistry",
    fact: "Neon is a noble gas with atomic number 10 and is chemically inert under standard conditions.",
    source: "Royal Society of Chemistry — Neon",
    keywords: ["neon", "noble", "inert"],
  },
];

const FACTS_BY_TEXT = new Map(REFERENCE_FACTS.map((fact) => [fact.fact, fact]));

/** Broad categories are too weak to select a fact on their own. */
const BROAD_TOPICS = new Set([
  "astronomy", "chemistry", "health", "history", "physics", "programming",
]);

const YEAR_ONLY = /^\d{4}$/;

/** Look up a curated fact by its exact text (used for provenance mapping). */
export function findReferenceFactByText(fact: string): ReferenceFact | undefined {
  return FACTS_BY_TEXT.get(fact.trim());
}

/**
 * Build source-attributed details. Curated facts keep their curated source;
 * facts supplied by the retrieval service are labelled as such rather than
 * being falsely attributed to an institution in this store.
 */
export function toFactDetails(facts: string[], startIndex = 0): FactDetail[] {
  return facts.map((fact, offset) => {
    const curated = findReferenceFactByText(fact);
    return {
      id: `F${startIndex + offset + 1}`,
      fact,
      source: curated?.source ?? "Knowledge microservice",
    };
  });
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{3,}|\b(?:1[0-9]{3}|20[0-2][0-9])\b/g) ?? [];
}

/**
 * A fact is admitted only when the question OR answer contains:
 *  - its exact topic phrase,
 *  - every significant topic word (so "Vietnam War" cannot match "World War II"), or
 *  - one of its curated high-signal entity keywords.
 * A bare shared year is only a tie-breaker after one of those gates has passed.
 */
function scoreFact(entry: ReferenceFact, question: string, answer: string): number {
  const query = `${question} ${answer}`.toLowerCase();
  const queryWords = new Set(tokenize(query));
  const topic = entry.topic.toLowerCase();
  const topicWords = tokenize(topic).filter((word) => !YEAR_ONLY.test(word));

  const exactTopic = query.includes(topic);
  const allTopicWords = topicWords.length > 0 && topicWords.every((word) => queryWords.has(word));
  const topicAllowed = (exactTopic || allTopicWords) && !BROAD_TOPICS.has(topic);

  const keywordHits = entry.keywords.filter((keyword) =>
    keyword.includes(" ") ? query.includes(keyword) : queryWords.has(keyword)
  ).length;

  if (!topicAllowed && keywordHits === 0) return 0;

  const yearOverlap = tokenize(entry.fact).some((word) => YEAR_ONLY.test(word) && queryWords.has(word));
  const topicScore = topicAllowed ? (exactTopic ? 8 : 0) + 6 : 0;
  return topicScore + keywordHits * 3 + (yearOverlap ? 1 : 0);
}

/** Pick only facts whose topic or entity is present in the question or answer. */
export function selectReferenceFacts(question: string, answer: string, max = 4): ReferenceFact[] {
  return REFERENCE_FACTS.map((entry) => ({
    entry,
    score: scoreFact(entry, question, answer),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((item) => item.entry);
}
