const BASE_TOPIC_RATING = 1200;
const BASE_ITEM_RATING_MEDIUM = 1300;

const BASE_KU = 40;
const MIN_KU = 12;

const BASE_KI = 12;
const MIN_KI = 4;

export { BASE_TOPIC_RATING, BASE_ITEM_RATING_MEDIUM };

export function normalizeTopic(value: unknown) {
  const topic = String(value ?? "").trim();
  return topic || "General";
}

export function normalizeOptionsCount(value: unknown) {
  const n = Number(value);
  return n === 6 ? 6 : 4;
}

export function baselineItemRating(authorDifficulty: unknown) {
  const normalized = String(authorDifficulty ?? "").trim().toLowerCase();

  if (normalized === "easy" || normalized === "ușor" || normalized === "usor") {
    return 1200;
  }

  if (
    normalized === "hard" ||
    normalized === "dificil" ||
    normalized === "greu"
  ) {
    return 1400;
  }

  return BASE_ITEM_RATING_MEDIUM;
}

export function eloExpected(studentRating: number, itemRating: number) {
  return 1 / (1 + 10 ** ((itemRating - studentRating) / 400));
}

export function guessingAwareExpected(studentRating: number, itemRating: number, optionsCount: number) {
  const guessFloor = 1 / normalizeOptionsCount(optionsCount);
  const elo = eloExpected(studentRating, itemRating);
  return guessFloor + (1 - guessFloor) * elo;
}

export function studentK(attempts: number) {
  const safeAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
  return Math.max(MIN_KU, BASE_KU / Math.sqrt(1 + safeAttempts));
}

export function itemK(attempts: number) {
  const safeAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
  return Math.max(MIN_KI, BASE_KI / Math.sqrt(1 + safeAttempts));
}
