// SM-2 spaced repetition algorithm
export function sm2Update(card, quality) {
  // quality: 0=blackout, 1=wrong, 2=wrong but remembered, 3=correct hard, 4=correct, 5=perfect
  let { easeFactor = 2.5, interval = 1, repetitions = 0 } = card;

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions++;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return { easeFactor, interval, repetitions, nextReview: nextReview.toISOString() };
}

export function isDue(card) {
  if (!card.nextReview) return true;
  return new Date(card.nextReview) <= new Date();
}

export function getDueCards(notes) {
  const due = [];
  for (const note of notes) {
    for (const fc of (note.flashcards || [])) {
      if (isDue(fc)) due.push({ ...fc, noteTitle: note.title, noteId: note.id });
    }
  }
  return due;
}
