export const stops = [
  { title: 'A world of green.', eyebrow: 'THE ESTATE', description: 'A glimpse of the landscape that makes slowing down feel natural. Take a breath. Take your time.', photo: 'photo-1441974231531-c6227db76b6e', tags: ['Coffee country', 'Chikkamagaluru'] },
  { title: 'Your own quiet corner.', eyebrow: 'THE STAY', description: 'Rooms and villas for slow mornings and unhurried evenings. Find the space that feels like your kind of escape.', photo: 'photo-1510798831971-661eb04b3739', tags: ['Rooms', 'Villas'] },
  { title: 'Time, well spent.', eyebrow: 'THE LITTLE MOMENTS', description: 'A warm cup, a long conversation, and no reason to hurry. Sometimes the best part of being away is doing a little less.', photo: 'photo-1442512595331-e89e73853f31', tags: ['Slow mornings', 'Coffee estate'] },
  { title: 'Better, together.', eyebrow: 'THE GATHERINGS', description: 'A wedding to remember or a team gathering with a different outlook. Bring your people to the hills.', photo: 'photo-1519741497674-611481863552', tags: ['Weddings', 'Offsites'] },
];

// Keep slides adjacent across the last → first transition.
export function slideOffset(index: number, active: number, count: number) {
  return ((index - active + count + Math.floor(count / 2)) % count) - Math.floor(count / 2);
}

